import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import type { OrderStatus } from '../generated/prisma/enums';

const DAY_MS = 86_400_000;

/**
 * Agrégats du tableau de bord.
 *
 * Deux règles gouvernent tous les chiffres de ce fichier :
 *
 * **Les commandes annulées ne comptent pas.** Les inclure gonflerait le
 * chiffre d'affaires d'un montant qui n'a jamais été encaissé.
 *
 * **Les montants de pays différents ne s'additionnent pas.** La France
 * affiche TTC, le Canada hors taxe : un total mêlé ne veut rien dire. Le
 * chiffre global est donc accompagné de sa ventilation par régime, à charge
 * pour l'écran de la montrer plutôt que de laisser croire à un total unique.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  async overview(days: number) {
    const now = new Date();
    const since = new Date(now.getTime() - days * DAY_MS);
    // Période précédente de même longueur, pour la variation.
    const previousSince = new Date(since.getTime() - days * DAY_MS);

    const sold: OrderStatus[] = [
      'PENDING',
      'CONFIRMED',
      'PROCESSING',
      'COMPLETED',
    ];

    const [current, previous, byStatus, series, top, lots, stock] =
      await Promise.all([
        this.totals(since, now, sold),
        this.totals(previousSince, since, sold),
        this.countByStatus(since),
        this.revenueSeries(since, days),
        this.topProducts(since),
        this.inventory.expiringLots(7),
        this.inventory.listStock({ level: 'out' }),
      ]);

    return {
      period: { days, since, until: now },
      revenue: {
        totalCents: current.totalCents,
        orderCount: current.orderCount,
        averageCents: current.orderCount
          ? Math.round(current.totalCents / current.orderCount)
          : 0,
        // `null` et non zéro quand la période précédente est vide : « pas de
        // point de comparaison » n'est pas « aucune progression ».
        revenueChange: ratio(current.totalCents, previous.totalCents),
        orderChange: ratio(current.orderCount, previous.orderCount),
      },
      byTaxRegime: current.byRegime,
      byStatus,
      series,
      topProducts: top,
      alerts: {
        outOfStock: stock.slice(0, 10),
        expiringLots: lots.slice(0, 10),
        toPrepare:
          byStatus.find((row) => row.status === 'CONFIRMED')?.count ?? 0,
      },
    };
  }

  /** Chiffre d'affaires et volume sur un intervalle, ventilés par régime de taxe. */
  private async totals(from: Date, to: Date, statuses: OrderStatus[]) {
    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: from, lt: to }, status: { in: statuses } },
      select: { totalCents: true, pricesIncludeTax: true, currencyCode: true },
    });

    const byRegime = new Map<
      string,
      { totalCents: number; orderCount: number }
    >();

    for (const order of orders) {
      const key = `${order.currencyCode}:${order.pricesIncludeTax ? 'TTC' : 'HT'}`;
      const bucket = byRegime.get(key) ?? { totalCents: 0, orderCount: 0 };
      bucket.totalCents += order.totalCents;
      bucket.orderCount += 1;
      byRegime.set(key, bucket);
    }

    return {
      totalCents: orders.reduce((sum, order) => sum + order.totalCents, 0),
      orderCount: orders.length,
      byRegime: [...byRegime.entries()].map(([key, value]) => {
        const [currencyCode, regime] = key.split(':');
        return { currencyCode, regime, ...value };
      }),
    };
  }

  private async countByStatus(since: Date) {
    const rows = await this.prisma.order.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });

    return rows.map((row) => ({ status: row.status, count: row._count._all }));
  }

  /**
   * Série jour par jour.
   *
   * Les jours sans commande sont remplis à zéro : les omettre ferait sauter
   * la courbe d'un jour au suivant comme s'ils étaient contigus, et un creux
   * ressemblerait à une progression.
   */
  private async revenueSeries(since: Date, days: number) {
    const orders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: since },
        status: { notIn: ['CANCELLED'] },
      },
      select: { createdAt: true, totalCents: true },
    });

    const buckets = new Map<
      string,
      { totalCents: number; orderCount: number }
    >();

    for (let index = 0; index < days; index += 1) {
      const day = new Date(since.getTime() + index * DAY_MS);
      buckets.set(day.toISOString().slice(0, 10), {
        totalCents: 0,
        orderCount: 0,
      });
    }

    for (const order of orders) {
      const key = order.createdAt.toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (!bucket) continue;

      bucket.totalCents += order.totalCents;
      bucket.orderCount += 1;
    }

    return [...buckets.entries()].map(([date, value]) => ({ date, ...value }));
  }

  /** Meilleures ventes, par chiffre d'affaires — pas par volume. */
  private async topProducts(since: Date) {
    const rows = await this.prisma.orderItem.groupBy({
      by: ['sku', 'name'],
      where: {
        order: { createdAt: { gte: since }, status: { notIn: ['CANCELLED'] } },
      },
      _sum: { totalCents: true, quantity: true },
      orderBy: { _sum: { totalCents: 'desc' } },
      take: 5,
    });

    return rows.map((row) => ({
      sku: row.sku,
      name: row.name,
      revenueCents: row._sum.totalCents ?? 0,
      // Décimal : l'alimentaire se vend au poids.
      quantity: row._sum.quantity?.toNumber() ?? 0,
    }));
  }

  /**
   * Répartitions pour l'écran « Statistiques ». Trois angles, chacun avec sa
   * limite assumée plutôt que masquée :
   *
   * - **Par catégorie** : chiffre d'affaires des lignes de commande, groupé
   *   par catégorie primaire du produit au moment de la lecture. Un produit
   *   supprimé ou déplacé depuis retombe en « Sans catégorie ».
   * - **Par pays** : ventilé par pays *et* devise, jamais sommé entre les
   *   deux — même règle que le reste du tableau de bord.
   * - **Par transporteur** : compte les expéditions déjà créées, pas les
   *   commandes. Une commande non encore expédiée n'y figure donc pas.
   */
  async breakdowns(days: number) {
    const now = new Date();
    const since = new Date(now.getTime() - days * DAY_MS);
    const sold: OrderStatus[] = [
      'PENDING',
      'CONFIRMED',
      'PROCESSING',
      'COMPLETED',
    ];

    const [byCategory, byCountry, byCarrier] = await Promise.all([
      this.categoryBreakdown(since, now, sold),
      this.countryBreakdown(since, now, sold),
      this.carrierBreakdown(since, now),
    ]);

    return {
      period: { days, since, until: now },
      byCategory,
      byCountry,
      byCarrier,
    };
  }

  private async categoryBreakdown(
    since: Date,
    until: Date,
    statuses: OrderStatus[],
  ) {
    const items = await this.prisma.orderItem.findMany({
      where: {
        // Limité à l'euro : sommer des lignes EUR et CAD dans la même barre
        // mélangerait deux devises, la règle qui gouverne tout ce fichier.
        order: {
          createdAt: { gte: since, lt: until },
          status: { in: statuses },
          currencyCode: 'EUR',
        },
      },
      select: { productId: true, totalCents: true },
    });

    const productIds = [
      ...new Set(
        items
          .map((item) => item.productId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const categories = await this.prisma.productCategory.findMany({
      where: { productId: { in: productIds }, isPrimary: true },
      select: {
        productId: true,
        category: {
          select: {
            translations: {
              where: { locale: 'FR' },
              select: { name: true },
              take: 1,
            },
          },
        },
      },
    });

    const nameByProduct = new Map(
      categories.map((row) => [
        row.productId,
        row.category.translations[0]?.name ?? 'Sans catégorie',
      ]),
    );

    const totals = new Map<string, number>();
    for (const item of items) {
      const name = item.productId
        ? (nameByProduct.get(item.productId) ?? 'Sans catégorie')
        : 'Sans catégorie';
      totals.set(name, (totals.get(name) ?? 0) + item.totalCents);
    }

    return [...totals.entries()]
      .map(([name, totalCents]) => ({ name, totalCents }))
      .sort((a, b) => b.totalCents - a.totalCents);
  }

  private async countryBreakdown(
    since: Date,
    until: Date,
    statuses: OrderStatus[],
  ) {
    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: since, lt: until }, status: { in: statuses } },
      select: {
        totalCents: true,
        currencyCode: true,
        addresses: {
          where: { type: 'SHIPPING' },
          select: { countryCode: true },
          take: 1,
        },
      },
    });

    const totals = new Map<
      string,
      {
        countryCode: string;
        currencyCode: string;
        totalCents: number;
        orderCount: number;
      }
    >();

    for (const order of orders) {
      const countryCode = order.addresses[0]?.countryCode ?? '—';
      const key = `${countryCode}:${order.currencyCode}`;
      const bucket = totals.get(key) ?? {
        countryCode,
        currencyCode: order.currencyCode,
        totalCents: 0,
        orderCount: 0,
      };
      bucket.totalCents += order.totalCents;
      bucket.orderCount += 1;
      totals.set(key, bucket);
    }

    return [...totals.values()].sort((a, b) => b.totalCents - a.totalCents);
  }

  /** Expéditions créées sur la période, groupées par transporteur. */
  private async carrierBreakdown(since: Date, until: Date) {
    const rows = await this.prisma.shipment.groupBy({
      by: ['carrierId'],
      where: { createdAt: { gte: since, lt: until } },
      _count: { _all: true },
    });

    const carrierIds = rows
      .map((row) => row.carrierId)
      .filter((id): id is string => Boolean(id));

    const carriers = await this.prisma.carrier.findMany({
      where: { id: { in: carrierIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(
      carriers.map((carrier) => [carrier.id, carrier.name]),
    );

    return rows
      .map((row) => ({
        name: row.carrierId
          ? (nameById.get(row.carrierId) ?? 'Transporteur inconnu')
          : 'Sans transporteur',
        orderCount: row._count._all,
      }))
      .sort((a, b) => b.orderCount - a.orderCount);
  }
}

/** Variation relative. `null` quand la période précédente est vide. */
function ratio(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 1000;
}
