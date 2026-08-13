import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../pricing/settings.service';
import { paginate, type PaginationDto } from '../../common/dto/pagination.dto';
import { Prisma } from '../../generated/prisma/client';

@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async balance(userId: string) {
    const account = await this.prisma.loyaltyAccount.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    const pointValue = await this.settings.get<number>(
      'loyalty.pointValueCents',
      1,
    );

    return {
      points: account.points,
      tier: account.tier,
      // Contre-valeur indicative : c'est ce que le client comprend, pas le
      // nombre de points.
      estimatedValueCents: account.points * pointValue,
    };
  }

  async history(userId: string, dto: PaginationDto) {
    const account = await this.prisma.loyaltyAccount.findUnique({
      where: { userId },
    });

    if (!account) {
      return paginate([], 0, dto);
    }

    const where: Prisma.LoyaltyTransactionWhereInput = {
      accountId: account.id,
    };

    const [items, total] = await Promise.all([
      this.prisma.loyaltyTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: dto.skip,
        take: dto.perPage,
        include: { order: { select: { number: true } } },
      }),
      this.prisma.loyaltyTransaction.count({ where }),
    ]);

    return paginate(items, total, dto);
  }

  /**
   * Crédite les points d'une commande payée.
   *
   * Le calcul porte sur le montant hors frais de port et hors taxe : faire
   * gagner des points sur la TVA reviendrait à offrir une remise sur l'impôt,
   * et sur la livraison à récompenser le transporteur.
   */
  async earnFromOrder(
    tx: Prisma.TransactionClient,
    order: {
      id: string;
      userId: string | null;
      subtotalCents: number;
      discountCents: number;
      pricesIncludeTax: boolean;
      number: string;
      items: { taxCents: number }[];
    },
  ): Promise<void> {
    if (!order.userId) {
      return;
    }

    const enabled = await this.settings.get<boolean>('loyalty.enabled', false);

    if (!enabled) {
      return;
    }

    const pointsPerEuro = await this.settings.get<number>(
      'loyalty.pointsPerEuro',
      1,
    );
    const expiryMonths = await this.settings.get<number>(
      'loyalty.expiryMonths',
      24,
    );

    // Seule la taxe des articles est retranchée : `order.taxCents` inclut aussi
    // celle des frais de port, qui ne fait déjà pas partie du sous-total.
    const itemTaxCents = order.items.reduce(
      (sum, item) => sum + item.taxCents,
      0,
    );

    const eligibleCents =
      order.subtotalCents -
      order.discountCents -
      (order.pricesIncludeTax ? itemTaxCents : 0);

    const points = Math.floor(
      (Math.max(eligibleCents, 0) / 100) * pointsPerEuro,
    );

    if (points <= 0) {
      return;
    }

    const account = await tx.loyaltyAccount.upsert({
      where: { userId: order.userId },
      update: { points: { increment: points } },
      create: { userId: order.userId, points },
    });

    await tx.loyaltyTransaction.create({
      data: {
        accountId: account.id,
        orderId: order.id,
        type: 'EARN',
        points,
        reason: `Commande ${order.number}`,
        expiresAt: expiryMonths
          ? new Date(Date.now() + expiryMonths * 30 * 86_400_000)
          : null,
      },
    });

    this.logger.log(
      `${points} point(s) crédité(s) pour la commande ${order.number}.`,
    );
  }

  /** Ajustement manuel par le service client : geste commercial ou correction. */
  async adjust(userId: string, points: number, reason?: string) {
    const account = await this.prisma.loyaltyAccount.upsert({
      where: { userId },
      update: { points: { increment: points } },
      create: { userId, points: Math.max(points, 0) },
    });

    await this.prisma.loyaltyTransaction.create({
      data: {
        accountId: account.id,
        type: 'ADJUSTMENT',
        points,
        reason,
      },
    });

    return { points: account.points };
  }

  /**
   * Purge les points expirés. Sans expiration, le passif de fidélité gonfle
   * indéfiniment au bilan.
   */
  async expirePoints(): Promise<number> {
    const expired = await this.prisma.loyaltyTransaction.findMany({
      where: { type: 'EARN', expiresAt: { lt: new Date() } },
      include: { account: true },
    });

    let total = 0;

    for (const transaction of expired) {
      await this.prisma.$transaction([
        this.prisma.loyaltyAccount.update({
          where: { id: transaction.accountId },
          data: {
            points: {
              decrement: Math.min(
                transaction.points,
                transaction.account.points,
              ),
            },
          },
        }),
        this.prisma.loyaltyTransaction.create({
          data: {
            accountId: transaction.accountId,
            type: 'EXPIRE',
            points: -transaction.points,
            reason: 'Points expirés',
          },
        }),
        this.prisma.loyaltyTransaction.update({
          where: { id: transaction.id },
          data: { expiresAt: null },
        }),
      ]);

      total += transaction.points;
    }

    return total;
  }
}
