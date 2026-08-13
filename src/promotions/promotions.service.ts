import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RuleEngineService } from './rule-engine.service';
import { Prisma } from '../generated/prisma/client';
import type {
  AppliedPromotion,
  ConditionNode,
  EvaluationContext,
  PromotionAction,
} from './rule-engine.types';

export type DiscountResult = {
  applied: AppliedPromotion[];
  /** Remise cumulée par ligne de panier, pour recalculer la base taxable. */
  lineDiscounts: Map<string, number>;
  totalDiscountCents: number;
  freeShipping: boolean;
  /** Codes saisis mais inutilisables, avec le motif à afficher au client. */
  rejectedCodes: { code: string; reason: string }[];
};

@Injectable()
export class PromotionsService {
  private readonly logger = new Logger(PromotionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: RuleEngineService,
  ) {}

  /**
   * Calcule les remises applicables à un panier.
   *
   * Deux familles cohabitent : les promotions automatiques (soldes, offres du
   * moment) et celles déclenchées par un code. Elles sont classées par
   * priorité décroissante ; une promotion exclusive stoppe le cumul.
   */
  async computeDiscounts(
    context: EvaluationContext,
    couponCodes: string[] = [],
  ): Promise<DiscountResult> {
    const result: DiscountResult = {
      applied: [],
      lineDiscounts: new Map(),
      totalDiscountCents: 0,
      freeShipping: false,
      rejectedCodes: [],
    };

    if (context.lines.length === 0) {
      return result;
    }

    const now = new Date();

    const automatic = await this.prisma.promotion.findMany({
      where: {
        status: 'ACTIVE',
        isAutomatic: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      include: { customerGroups: true, translations: true },
      orderBy: { priority: 'desc' },
    });

    const coupons = await this.resolveCoupons(couponCodes, context, result);

    const candidates = [
      ...automatic.map((promotion) => ({ promotion, coupon: null })),
      ...coupons,
    ].sort((a, b) => b.promotion.priority - a.promotion.priority);

    for (const candidate of candidates) {
      const { promotion, coupon } = candidate;

      if (
        !this.isEligibleForGroup(
          promotion.customerGroups,
          context.customerGroupId,
        )
      ) {
        continue;
      }

      if (
        promotion.minimumCents &&
        context.subtotalCents < promotion.minimumCents
      ) {
        continue;
      }

      if (
        promotion.usageLimit !== null &&
        promotion.usageCount >= promotion.usageLimit
      ) {
        continue;
      }

      if (
        !this.engine.evaluate(promotion.conditions as ConditionNode, context)
      ) {
        continue;
      }

      const outcome = this.runActions(
        promotion.actions as PromotionAction[],
        context,
      );

      if (outcome.amountCents === 0 && !outcome.freeShipping) {
        continue;
      }

      result.applied.push({
        promotionId: promotion.id,
        code: coupon?.code ?? promotion.code,
        label: promotion.translations[0]?.label ?? promotion.name,
        scope: promotion.scope,
        amountCents: outcome.amountCents,
        freeShipping: outcome.freeShipping,
        lineDiscounts: outcome.lineDiscounts,
        couponId: coupon?.id ?? null,
      });

      for (const [cartItemId, amount] of outcome.lineDiscounts) {
        result.lineDiscounts.set(
          cartItemId,
          (result.lineDiscounts.get(cartItemId) ?? 0) + amount,
        );
      }

      result.totalDiscountCents += outcome.amountCents;
      result.freeShipping = result.freeShipping || outcome.freeShipping;

      if (promotion.isExclusive) {
        break;
      }
    }

    this.capToLineTotals(context, result);

    return result;
  }

  /** Vérifie un code avant de l'ajouter au panier, pour un retour immédiat. */
  async validateCoupon(code: string, context: EvaluationContext) {
    const result: DiscountResult = {
      applied: [],
      lineDiscounts: new Map(),
      totalDiscountCents: 0,
      freeShipping: false,
      rejectedCodes: [],
    };

    const resolved = await this.resolveCoupons([code], context, result);

    if (result.rejectedCodes.length > 0) {
      throw new BadRequestException(result.rejectedCodes[0].reason);
    }

    const promotion = resolved[0]?.promotion;

    if (
      !promotion ||
      !this.engine.evaluate(promotion.conditions as ConditionNode, context)
    ) {
      throw new BadRequestException(
        'Ce code ne s’applique pas à votre panier.',
      );
    }

    return { code: code.toUpperCase(), label: promotion.name };
  }

  /**
   * Enregistre l'usage des promotions au moment de la commande : compteurs
   * globaux, compteurs par coupon et trace nominative pour faire respecter la
   * limite par client.
   */
  async recordRedemptions(
    tx: Prisma.TransactionClient,
    orderId: string,
    userId: string | null,
    applied: AppliedPromotion[],
  ): Promise<void> {
    for (const promotion of applied) {
      await tx.promotionRedemption.create({
        data: {
          promotionId: promotion.promotionId,
          couponId: promotion.couponId,
          orderId,
          userId,
          amountCents: promotion.amountCents,
        },
      });

      await tx.promotion.update({
        where: { id: promotion.promotionId },
        data: { usageCount: { increment: 1 } },
      });

      if (promotion.couponId) {
        await tx.coupon.update({
          where: { id: promotion.couponId },
          data: { usageCount: { increment: 1 } },
        });
      }
    }
  }

  private runActions(actions: PromotionAction[], context: EvaluationContext) {
    const lineDiscounts = new Map<string, number>();
    let amountCents = 0;
    let freeShipping = false;

    for (const action of actions ?? []) {
      const outcome = this.engine.apply(action, context);

      for (const [cartItemId, amount] of outcome.lineDiscounts) {
        lineDiscounts.set(
          cartItemId,
          (lineDiscounts.get(cartItemId) ?? 0) + amount,
        );
      }

      amountCents += outcome.amountCents;
      freeShipping = freeShipping || outcome.freeShipping;
    }

    return { amountCents, lineDiscounts, freeShipping };
  }

  private async resolveCoupons(
    codes: string[],
    context: EvaluationContext,
    result: DiscountResult,
  ) {
    if (codes.length === 0) {
      return [];
    }

    const now = new Date();
    const normalized = codes
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);

    const coupons = await this.prisma.coupon.findMany({
      where: { code: { in: normalized } },
      include: {
        promotion: { include: { customerGroups: true, translations: true } },
      },
    });

    const resolved: {
      promotion: (typeof coupons)[number]['promotion'];
      coupon: (typeof coupons)[number];
    }[] = [];

    for (const code of normalized) {
      const coupon = coupons.find((candidate) => candidate.code === code);

      if (!coupon) {
        result.rejectedCodes.push({
          code,
          reason: 'Code promotionnel inconnu.',
        });
        continue;
      }

      if (!coupon.isActive || coupon.promotion.status !== 'ACTIVE') {
        result.rejectedCodes.push({
          code,
          reason: 'Ce code n’est plus actif.',
        });
        continue;
      }

      if (coupon.expiresAt && coupon.expiresAt < now) {
        result.rejectedCodes.push({ code, reason: 'Ce code a expiré.' });
        continue;
      }

      if (coupon.promotion.startsAt && coupon.promotion.startsAt > now) {
        result.rejectedCodes.push({
          code,
          reason: 'Cette offre n’a pas encore commencé.',
        });
        continue;
      }

      if (coupon.promotion.endsAt && coupon.promotion.endsAt < now) {
        result.rejectedCodes.push({
          code,
          reason: 'Cette offre est terminée.',
        });
        continue;
      }

      if (
        coupon.usageLimit !== null &&
        coupon.usageCount >= coupon.usageLimit
      ) {
        result.rejectedCodes.push({
          code,
          reason: 'Ce code a atteint sa limite d’utilisation.',
        });
        continue;
      }

      // Code nominatif : réservé au client à qui il a été attribué.
      if (coupon.assignedTo && coupon.assignedTo !== context.userId) {
        result.rejectedCodes.push({
          code,
          reason: 'Ce code ne vous est pas destiné.',
        });
        continue;
      }

      if (coupon.promotion.perCustomerLimit && context.userId) {
        const used = await this.prisma.promotionRedemption.count({
          where: { promotionId: coupon.promotionId, userId: context.userId },
        });

        if (used >= coupon.promotion.perCustomerLimit) {
          result.rejectedCodes.push({
            code,
            reason: 'Vous avez déjà utilisé cette offre.',
          });
          continue;
        }
      }

      resolved.push({ promotion: coupon.promotion, coupon });
    }

    return resolved;
  }

  private isEligibleForGroup(
    groups: { groupId: string }[],
    customerGroupId: string | null,
  ): boolean {
    if (groups.length === 0) {
      return true;
    }

    return (
      Boolean(customerGroupId) &&
      groups.some((group) => group.groupId === customerGroupId)
    );
  }

  /**
   * Garde-fou : le cumul de plusieurs promotions ne doit jamais rendre une
   * ligne négative. Sans ce plafond, deux offres de -60 % feraient un total
   * en dessous de zéro.
   */
  private capToLineTotals(
    context: EvaluationContext,
    result: DiscountResult,
  ): void {
    let corrected = 0;

    for (const line of context.lines) {
      const discount = result.lineDiscounts.get(line.cartItemId) ?? 0;
      const capped = Math.min(discount, line.lineTotalCents);

      if (capped !== discount) {
        result.lineDiscounts.set(line.cartItemId, capped);
      }

      corrected += capped;
    }

    if (corrected !== result.totalDiscountCents) {
      this.logger.debug(
        `Remise plafonnée : ${result.totalDiscountCents} → ${corrected} centimes.`,
      );
      result.totalDiscountCents = corrected;
    }
  }
}
