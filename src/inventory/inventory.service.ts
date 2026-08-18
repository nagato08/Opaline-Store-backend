import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../pricing/settings.service';
import { MailService } from '../mail/mail.service';
import { MailTemplate } from '../mail/mail.types';
import { Prisma } from '../generated/prisma/client';
import type { StockMovementType } from '../generated/prisma/enums';

export type StockRequest = {
  variantId: string;
  quantity: number;
};

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /** Quantité vendable = physique - déjà réservé - stock de sécurité. */
  async availableFor(variantIds: string[]): Promise<Map<string, number>> {
    const items = await this.prisma.inventoryItem.findMany({
      where: { variantId: { in: variantIds } },
    });

    const available = new Map<string, number>();

    for (const item of items) {
      const quantity = item.isTracked
        ? Number(item.onHand) - Number(item.reserved) - Number(item.safetyStock)
        : Number.MAX_SAFE_INTEGER;

      available.set(
        item.variantId,
        (available.get(item.variantId) ?? 0) + Math.max(quantity, 0),
      );
    }

    // Une variante sans ligne d'inventaire n'est pas suivie : elle reste vendable.
    for (const variantId of variantIds) {
      if (!available.has(variantId)) {
        available.set(variantId, Number.MAX_SAFE_INTEGER);
      }
    }

    return available;
  }

  /**
   * Réserve le stock d'une commande. Les lignes d'inventaire sont verrouillées
   * (`SELECT … FOR UPDATE`) le temps de la transaction : sans ce verrou, deux
   * commandes simultanées sur le dernier article passeraient toutes les deux.
   */
  async reserveForOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    requests: StockRequest[],
  ): Promise<void> {
    if (requests.length === 0) {
      return;
    }

    const minutes = await this.settings.get<number>(
      'checkout.reservationMinutes',
      20,
    );
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    const variantIds = requests.map((request) => request.variantId);

    const locked = await tx.$queryRaw<
      {
        id: string;
        variantId: string;
        locationId: string;
        onHand: Prisma.Decimal;
        reserved: Prisma.Decimal;
        safetyStock: Prisma.Decimal;
        isTracked: boolean;
        backorderPolicy: string;
      }[]
    >`
      SELECT id, "variantId", "locationId", "onHand", "reserved", "safetyStock",
             "isTracked", "backorderPolicy"
      FROM "InventoryItem"
      WHERE "variantId" = ANY(${variantIds}::text[])
      ORDER BY "variantId"
      FOR UPDATE
    `;

    const byVariant = new Map<string, (typeof locked)[number][]>();

    for (const item of locked) {
      const list = byVariant.get(item.variantId) ?? [];
      list.push(item);
      byVariant.set(item.variantId, list);
    }

    for (const request of requests) {
      const items = byVariant.get(request.variantId) ?? [];

      // Aucune ligne d'inventaire : variante non suivie, rien à réserver.
      if (items.length === 0) {
        continue;
      }

      let remaining = request.quantity;

      for (const item of items) {
        if (remaining <= 0) break;

        const available = item.isTracked
          ? Number(item.onHand) -
            Number(item.reserved) -
            Number(item.safetyStock)
          : remaining;

        const take =
          item.backorderPolicy === 'DENY'
            ? Math.min(available, remaining)
            : remaining;

        if (take <= 0) continue;

        await tx.inventoryItem.update({
          where: { id: item.id },
          data: { reserved: { increment: take } },
        });

        await tx.stockReservation.create({
          data: {
            variantId: request.variantId,
            locationId: item.locationId,
            orderId,
            quantity: take,
            expiresAt,
          },
        });

        remaining -= take;
      }

      if (remaining > 0) {
        const variant = await tx.variant.findUnique({
          where: { id: request.variantId },
          select: { sku: true },
        });

        throw new BadRequestException(
          `Stock insuffisant pour ${variant?.sku ?? request.variantId}.`,
        );
      }
    }
  }

  /**
   * Transforme les réservations d'une commande payée en sortie de stock
   * définitive, en consommant les lots par date limite la plus proche (FEFO)
   * pour les denrées périssables.
   */
  async commitReservations(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<void> {
    const reservations = await tx.stockReservation.findMany({
      where: { orderId, releasedAt: null },
    });

    for (const reservation of reservations) {
      const quantity = Number(reservation.quantity);

      await tx.inventoryItem.updateMany({
        where: {
          variantId: reservation.variantId,
          locationId: reservation.locationId,
        },
        data: {
          onHand: { decrement: quantity },
          reserved: { decrement: quantity },
        },
      });

      const lot = await tx.stockLot.findFirst({
        where: {
          variantId: reservation.variantId,
          locationId: reservation.locationId,
          isBlocked: false,
          quantity: { gt: 0 },
        },
        orderBy: [{ expiresAt: 'asc' }, { receivedAt: 'asc' }],
      });

      if (lot) {
        await tx.stockLot.update({
          where: { id: lot.id },
          data: {
            quantity: { decrement: Math.min(quantity, Number(lot.quantity)) },
          },
        });
      }

      await tx.stockMovement.create({
        data: {
          variantId: reservation.variantId,
          locationId: reservation.locationId,
          lotId: lot?.id,
          type: 'SALE',
          quantity: -quantity,
          reference: orderId,
        },
      });

      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: { releasedAt: new Date() },
      });
    }
  }

  /** Libère les réservations d'une commande annulée ou expirée. */
  async releaseReservations(
    tx: Prisma.TransactionClient,
    where: { orderId?: string; cartId?: string; expiredOnly?: boolean },
  ): Promise<number> {
    const reservations = await tx.stockReservation.findMany({
      where: {
        orderId: where.orderId,
        cartId: where.cartId,
        releasedAt: null,
        expiresAt: where.expiredOnly ? { lt: new Date() } : undefined,
      },
    });

    for (const reservation of reservations) {
      await tx.inventoryItem.updateMany({
        where: {
          variantId: reservation.variantId,
          locationId: reservation.locationId,
        },
        data: { reserved: { decrement: Number(reservation.quantity) } },
      });

      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: { releasedAt: new Date() },
      });
    }

    return reservations.length;
  }

  /** Purge planifiée des paniers abandonnés en cours de paiement. */
  async releaseExpired(): Promise<number> {
    const released = await this.prisma.$transaction((tx) =>
      this.releaseReservations(tx, { expiredOnly: true }),
    );

    if (released > 0) {
      this.logger.log(
        `${released} réservation(s) de stock expirée(s) libérée(s).`,
      );
    }

    return released;
  }

  // --- Administration -------------------------------------------------------

  async adjust(input: {
    variantId: string;
    locationId: string;
    quantity: number;
    type: StockMovementType;
    reason?: string;
    actorId?: string;
    lotNumber?: string;
    expiresAt?: string;
  }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.upsert({
        where: {
          variantId_locationId: {
            variantId: input.variantId,
            locationId: input.locationId,
          },
        },
        update: { onHand: { increment: input.quantity } },
        create: {
          variantId: input.variantId,
          locationId: input.locationId,
          onHand: input.quantity,
        },
      });

      let lotId: string | undefined;

      if (input.lotNumber) {
        const lot = await tx.stockLot.upsert({
          where: {
            variantId_locationId_lotNumber: {
              variantId: input.variantId,
              locationId: input.locationId,
              lotNumber: input.lotNumber,
            },
          },
          update: { quantity: { increment: input.quantity } },
          create: {
            variantId: input.variantId,
            locationId: input.locationId,
            lotNumber: input.lotNumber,
            quantity: input.quantity,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
          },
        });
        lotId = lot.id;
      }

      await tx.stockMovement.create({
        data: {
          variantId: input.variantId,
          locationId: input.locationId,
          lotId,
          type: input.type,
          quantity: input.quantity,
          reason: input.reason,
          actorId: input.actorId,
        },
      });

      return item;
    });

    if (input.quantity > 0) {
      await this.notifyBackInStock(input.variantId);
    }

    return result;
  }

  /**
   * Prévient les clients en attente quand un article redevient disponible.
   * `notifiedAt` garantit qu'une demande ne déclenche qu'un seul message.
   */
  private async notifyBackInStock(variantId: string): Promise<void> {
    const available =
      (await this.availableFor([variantId])).get(variantId) ?? 0;

    if (available <= 0) {
      return;
    }

    const requests = await this.prisma.backInStockRequest.findMany({
      where: { variantId, notifiedAt: null },
      include: {
        variant: {
          include: {
            product: { include: { translations: true } },
          },
        },
      },
    });

    for (const request of requests) {
      const translation =
        request.variant.product.translations.find(
          (item) => item.locale === request.locale,
        ) ?? request.variant.product.translations[0];

      await this.mail.enqueue({
        to: request.email,
        template: MailTemplate.BackInStock,
        locale: request.locale,
        variables: {
          productName: translation?.name ?? request.variant.sku,
          productUrl: `${this.config.getOrThrow<string>('storefrontUrl')}/produits/${translation?.slug ?? ''}`,
        },
        relatedType: 'variant',
        relatedId: variantId,
      });

      await this.prisma.backInStockRequest.update({
        where: { id: request.id },
        data: { notifiedAt: new Date() },
      });
    }
  }

  /**
   * État du stock, référence par référence.
   *
   * Le filtre porte sur le **disponible** (physique moins réservé) et non sur
   * la quantité physique : un article entièrement réservé est en rupture pour
   * qui veut l'acheter, même si le rayon n'est pas vide. Filtrer sur `onHand`
   * laisserait passer exactement les ruptures qu'on cherche à voir.
   *
   * Le tri se fait en mémoire après lecture : `onHand - reserved` n'est pas
   * une colonne, et Prisma ne sait pas trier sur une expression. La table
   * compte une ligne par variante et par emplacement — quelques milliers au
   * plus pour cette boutique, pas de quoi paginer côté base.
   */
  async listStock(options: {
    level?: 'out' | 'low' | 'ok';
    locationId?: string;
    search?: string;
  }) {
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        locationId: options.locationId,
        variant: options.search
          ? {
              OR: [
                { sku: { contains: options.search, mode: 'insensitive' } },
                {
                  product: {
                    translations: {
                      some: {
                        name: { contains: options.search, mode: 'insensitive' },
                      },
                    },
                  },
                },
              ],
            }
          : undefined,
      },
      include: {
        location: { select: { id: true, code: true, name: true } },
        variant: {
          select: {
            id: true,
            sku: true,
            measureUnit: true,
            isSoldByMeasure: true,
            product: {
              select: {
                id: true,
                translations: { select: { locale: true, name: true } },
              },
            },
          },
        },
      },
    });

    const lots = await this.prisma.stockLot.groupBy({
      by: ['variantId'],
      where: { quantity: { gt: 0 } },
      _count: { _all: true },
    });
    const lotCount = new Map(
      lots.map((lot) => [lot.variantId, lot._count._all]),
    );

    const rows = items.map((item) => {
      const onHand = item.onHand.toNumber();
      const reserved = item.reserved.toNumber();
      const threshold = item.lowStockAt.toNumber();
      const available = onHand - reserved;

      return {
        variantId: item.variantId,
        sku: item.variant.sku,
        productId: item.variant.product.id,
        name: item.variant.product.translations,
        location: item.location,
        onHand,
        reserved,
        available,
        threshold,
        unit: item.variant.isSoldByMeasure ? item.variant.measureUnit : null,
        openLots: lotCount.get(item.variantId) ?? 0,
        level: available <= 0 ? 'out' : available <= threshold ? 'low' : 'ok',
      };
    });

    const filtered = options.level
      ? rows.filter((row) => row.level === options.level)
      : rows;

    // Le plus urgent en tête : ce qu'on vient chercher sur cet écran, c'est
    // ce qui manque, pas l'ordre alphabétique.
    const order = { out: 0, low: 1, ok: 2 } as const;
    return filtered.sort(
      (a, b) =>
        order[a.level as keyof typeof order] -
          order[b.level as keyof typeof order] || a.available - b.available,
    );
  }

  /** Entrepôts actifs, le principal en tête — la plupart des boutiques n'en ont qu'un. */
  listLocations() {
    return this.prisma.location.findMany({
      where: { isActive: true },
      orderBy: { isDefault: 'desc' },
      select: { id: true, code: true, name: true, isDefault: true },
    });
  }

  listMovements(variantId: string, take = 50) {
    return this.prisma.stockMovement.findMany({
      where: { variantId },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        location: { select: { code: true } },
        lot: { select: { lotNumber: true } },
      },
    });
  }

  /** Denrées dont la date limite approche : à écouler ou à retirer. */
  expiringLots(days = 30) {
    return this.prisma.stockLot.findMany({
      where: {
        quantity: { gt: 0 },
        expiresAt: { not: null, lte: new Date(Date.now() + days * 86_400_000) },
      },
      orderBy: { expiresAt: 'asc' },
      include: {
        variant: {
          select: {
            sku: true,
            isSoldByMeasure: true,
            measureUnit: true,
            product: { select: { translations: true } },
          },
        },
      },
    });
  }
}
