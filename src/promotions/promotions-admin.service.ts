import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { paginate, type PaginationDto } from '../common/dto/pagination.dto';
import type {
  CreateCouponDto,
  CreatePromotionDto,
  GenerateCouponsDto,
  UpdatePromotionDto,
} from './dto/promotion.dto';

/** Caractères sans ambiguïté visuelle : ni O/0, ni I/1. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class PromotionsAdminService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreatePromotionDto) {
    return this.prisma.promotion.create({
      data: {
        code: dto.code.toUpperCase(),
        name: dto.name,
        description: dto.description,
        scope: dto.scope ?? 'CART',
        status: dto.status ?? 'DRAFT',
        conditions: (dto.conditions ?? {}) as Prisma.InputJsonValue,
        actions: dto.actions as Prisma.InputJsonValue,
        priority: dto.priority ?? 0,
        isExclusive: dto.isExclusive ?? false,
        isAutomatic: dto.isAutomatic ?? true,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        usageLimit: dto.usageLimit,
        perCustomerLimit: dto.perCustomerLimit,
        minimumCents: dto.minimumCents,
        customerGroups: dto.customerGroupIds?.length
          ? { create: dto.customerGroupIds.map((groupId) => ({ groupId })) }
          : undefined,
        translations: dto.translations?.length
          ? { create: dto.translations }
          : undefined,
      },
      include: { translations: true, customerGroups: true },
    });
  }

  update(id: string, dto: UpdatePromotionDto) {
    return this.prisma.promotion.update({
      where: { id },
      data: {
        name: dto.name,
        status: dto.status,
        conditions: dto.conditions as Prisma.InputJsonValue,
        actions: dto.actions as Prisma.InputJsonValue,
        priority: dto.priority,
        isExclusive: dto.isExclusive,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        minimumCents: dto.minimumCents,
      },
      include: { translations: true, customerGroups: true, coupons: true },
    });
  }

  async list(dto: PaginationDto) {
    const [items, total] = await Promise.all([
      this.prisma.promotion.findMany({
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip: dto.skip,
        take: dto.perPage,
        include: {
          translations: true,
          _count: { select: { coupons: true, redemptions: true } },
        },
      }),
      this.prisma.promotion.count(),
    ]);

    return paginate(items, total, dto);
  }

  findOne(id: string) {
    return this.prisma.promotion.findUniqueOrThrow({
      where: { id },
      include: {
        translations: true,
        customerGroups: { include: { group: true } },
        coupons: { take: 50, orderBy: { createdAt: 'desc' } },
        _count: { select: { coupons: true, redemptions: true } },
      },
    });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.promotion.delete({ where: { id } });
  }

  createCoupon(promotionId: string, dto: CreateCouponDto) {
    return this.prisma.coupon.create({
      data: {
        promotionId,
        code: dto.code.toUpperCase(),
        usageLimit: dto.usageLimit,
        assignedTo: dto.assignedTo,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });
  }

  /**
   * Génération en masse pour une campagne d'emailing ou un dédommagement.
   * Les codes sont tirés au hasard puis insérés en ignorant les collisions,
   * ce qui évite un aller-retour de vérification par code.
   */
  async generateCoupons(promotionId: string, dto: GenerateCouponsDto) {
    const prefix = dto.prefix ? `${dto.prefix.toUpperCase()}-` : '';
    const codes = new Set<string>();

    while (codes.size < dto.quantity) {
      codes.add(`${prefix}${this.randomCode(10)}`);
    }

    const created = await this.prisma.coupon.createMany({
      data: [...codes].map((code) => ({
        promotionId,
        code,
        usageLimit: dto.usageLimit ?? 1,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      })),
      skipDuplicates: true,
    });

    return {
      requested: dto.quantity,
      created: created.count,
      sample: [...codes].slice(0, 5),
    };
  }

  listCoupons(promotionId: string, dto: PaginationDto) {
    return this.prisma.coupon.findMany({
      where: { promotionId },
      orderBy: { createdAt: 'desc' },
      skip: dto.skip,
      take: dto.perPage,
    });
  }

  async deactivateCoupon(id: string) {
    return this.prisma.coupon.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /** Suivi de performance : montant consenti et nombre d'utilisations. */
  async stats(promotionId: string) {
    const [aggregate, promotion] = await Promise.all([
      this.prisma.promotionRedemption.aggregate({
        where: { promotionId },
        _sum: { amountCents: true },
        _count: true,
      }),
      this.prisma.promotion.findUniqueOrThrow({ where: { id: promotionId } }),
    ]);

    return {
      promotionId,
      code: promotion.code,
      redemptions: aggregate._count,
      discountGrantedCents: aggregate._sum.amountCents ?? 0,
      usageLimit: promotion.usageLimit,
      usageCount: promotion.usageCount,
    };
  }

  private randomCode(length: number): string {
    const bytes = randomBytes(length);
    let code = '';

    for (let index = 0; index < length; index += 1) {
      code += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
    }

    return code;
  }
}
