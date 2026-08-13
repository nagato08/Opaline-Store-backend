import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ResolvedPrice = {
  variantId: string;
  currencyCode: string;
  amountCents: number;
  compareAtCents: number | null;
  /** Vrai quand le prix vient d'une conversion et non d'un tarif saisi. */
  isConverted: boolean;
};

type ResolveOptions = {
  currencyCode: string;
  customerGroupId?: string | null;
  quantity?: number;
};

@Injectable()
export class PriceResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Résout le prix applicable pour un lot de variantes en une seule requête.
   *
   * Sélection, du plus spécifique au plus général :
   *   1. tarif du groupe client, palier de quantité le plus élevé atteint ;
   *   2. tarif public dans la devise demandée ;
   *   3. conversion depuis la devise par défaut au dernier taux connu.
   */
  async resolveMany(
    variantIds: string[],
    options: ResolveOptions,
  ): Promise<Map<string, ResolvedPrice>> {
    const resolved = new Map<string, ResolvedPrice>();

    if (variantIds.length === 0) {
      return resolved;
    }

    const quantity = options.quantity ?? 1;
    const now = new Date();

    const prices = await this.prisma.price.findMany({
      where: {
        variantId: { in: variantIds },
        currencyCode: options.currencyCode,
        minQuantity: { lte: quantity },
        // Tarif du groupe client s'il en a un, sinon tarif public.
        OR: options.customerGroupId
          ? [
              { customerGroupId: options.customerGroupId },
              { customerGroupId: null },
            ]
          : [{ customerGroupId: null }],
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ minQuantity: 'desc' }],
    });

    for (const price of prices) {
      const current = resolved.get(price.variantId);
      const isMoreSpecific =
        !current ||
        (price.customerGroupId !== null &&
          options.customerGroupId === price.customerGroupId);

      if (isMoreSpecific) {
        resolved.set(price.variantId, {
          variantId: price.variantId,
          currencyCode: price.currencyCode,
          amountCents: price.amountCents,
          compareAtCents: price.compareAtCents,
          isConverted: false,
        });
      }
    }

    const missing = variantIds.filter((id) => !resolved.has(id));

    if (missing.length > 0) {
      for (const [variantId, converted] of await this.convertFromDefault(
        missing,
        options.currencyCode,
      )) {
        resolved.set(variantId, converted);
      }
    }

    return resolved;
  }

  async resolve(
    variantId: string,
    options: ResolveOptions,
  ): Promise<ResolvedPrice | null> {
    const prices = await this.resolveMany([variantId], options);
    return prices.get(variantId) ?? null;
  }

  /**
   * Repli quand aucun tarif n'est saisi dans la devise demandée : conversion au
   * dernier taux connu. Un prix converti est signalé pour que l'admin sache
   * qu'il n'a pas été validé manuellement.
   */
  private async convertFromDefault(
    variantIds: string[],
    targetCurrency: string,
  ): Promise<Map<string, ResolvedPrice>> {
    const converted = new Map<string, ResolvedPrice>();

    const defaultCurrency = await this.prisma.currency.findFirst({
      where: { isDefault: true },
    });

    if (!defaultCurrency || defaultCurrency.code === targetCurrency) {
      return converted;
    }

    const [basePrices, rate] = await Promise.all([
      this.prisma.price.findMany({
        where: {
          variantId: { in: variantIds },
          currencyCode: defaultCurrency.code,
          customerGroupId: null,
        },
        orderBy: { minQuantity: 'asc' },
      }),
      this.prisma.exchangeRate.findFirst({
        where: { baseCode: defaultCurrency.code, quoteCode: targetCurrency },
        orderBy: { fetchedAt: 'desc' },
      }),
    ]);

    if (!rate) {
      return converted;
    }

    const factor = Number(rate.rate);

    for (const price of basePrices) {
      if (converted.has(price.variantId)) continue;

      converted.set(price.variantId, {
        variantId: price.variantId,
        currencyCode: targetCurrency,
        amountCents: Math.round(price.amountCents * factor),
        compareAtCents: price.compareAtCents
          ? Math.round(price.compareAtCents * factor)
          : null,
        isConverted: true,
      });
    }

    return converted;
  }
}
