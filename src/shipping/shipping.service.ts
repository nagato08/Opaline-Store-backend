import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Locale } from '../generated/prisma/enums';

export type ShippableLine = {
  variantId: string;
  quantity: number;
  weightGrams: number;
  isOversized: boolean;
  requiresColdChain: boolean;
  lineTotalCents: number;
};

export type ShippingQuote = {
  methodId: string;
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  currencyCode: string;
  isFree: boolean;
  requiresSlot: boolean;
  minDeliveryDays: number | null;
  maxDeliveryDays: number | null;
  taxClassId: string | null;
};

@Injectable()
export class ShippingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Méthodes disponibles pour une destination et un contenu de panier.
   *
   * Les contraintes physiques filtrent avant le tarif : un colis hors gabarit
   * (meuble) ou une denrée sous chaîne du froid ne peuvent pas partir par
   * n'importe quel transporteur.
   */
  async quote(
    destination: { countryCode: string; region?: string | null },
    lines: ShippableLine[],
    currencyCode: string,
    locale: Locale,
  ): Promise<ShippingQuote[]> {
    if (lines.length === 0) {
      return [];
    }

    const totalWeight = lines.reduce(
      (sum, line) => sum + line.weightGrams * line.quantity,
      0,
    );
    const totalValue = lines.reduce(
      (sum, line) => sum + line.lineTotalCents,
      0,
    );
    const hasOversized = lines.some((line) => line.isOversized);
    const needsColdChain = lines.some((line) => line.requiresColdChain);

    const methods = await this.prisma.shippingMethod.findMany({
      where: {
        isActive: true,
        zone: {
          isActive: true,
          countryCodes: { has: destination.countryCode },
        },
        ...(hasOversized ? { supportsOversized: true } : {}),
        ...(needsColdChain ? { supportsColdChain: true } : {}),
      },
      orderBy: { position: 'asc' },
      include: {
        translations: { where: { locale } },
        rates: { where: { currencyCode }, orderBy: { minValue: 'asc' } },
        zone: true,
      },
    });

    const quotes: ShippingQuote[] = [];

    for (const method of methods) {
      // Zone restreinte à certaines régions (États américains, provinces).
      if (
        method.zone.regions.length > 0 &&
        destination.region &&
        !method.zone.regions.includes(destination.region)
      ) {
        continue;
      }

      if (method.maxWeightGrams && totalWeight > method.maxWeightGrams) {
        continue;
      }

      const isFree =
        method.rateType === 'FREE' ||
        (method.freeAboveCents !== null && totalValue >= method.freeAboveCents);

      const priceCents = isFree
        ? 0
        : this.priceFor(method.rateType, method.rates, {
            totalWeight,
            totalValue,
          });

      if (priceCents === null) {
        continue;
      }

      quotes.push({
        methodId: method.id,
        code: method.code,
        name: method.translations[0]?.name ?? method.code,
        description: method.translations[0]?.description ?? null,
        priceCents,
        currencyCode,
        isFree,
        requiresSlot: method.requiresSlot,
        minDeliveryDays: method.minDeliveryDays,
        maxDeliveryDays: method.maxDeliveryDays,
        taxClassId: method.taxClassId,
      });
    }

    return quotes;
  }

  async quoteForMethod(
    methodId: string,
    destination: { countryCode: string; region?: string | null },
    lines: ShippableLine[],
    currencyCode: string,
    locale: Locale,
  ): Promise<ShippingQuote> {
    const quotes = await this.quote(destination, lines, currencyCode, locale);
    const quote = quotes.find((item) => item.methodId === methodId);

    if (!quote) {
      throw new NotFoundException(
        'Ce mode de livraison n’est pas disponible pour cette commande.',
      );
    }

    return quote;
  }

  /**
   * Applique le barème selon le type de tarification. `perUnitCents` permet
   * une part variable au-delà de la borne basse (au kilo, au volume).
   */
  private priceFor(
    rateType: string,
    rates: {
      minValue: unknown;
      maxValue: unknown;
      priceCents: number;
      perUnitCents: number | null;
    }[],
    context: { totalWeight: number; totalValue: number },
  ): number | null {
    if (rateType === 'PICKUP') {
      return rates[0]?.priceCents ?? 0;
    }

    const value =
      rateType === 'BY_WEIGHT'
        ? context.totalWeight
        : rateType === 'BY_PRICE'
          ? context.totalValue
          : 0;

    if (rateType === 'FLAT') {
      return rates[0]?.priceCents ?? null;
    }

    const bracket = rates.find((rate) => {
      const min = Number(rate.minValue);
      const max =
        rate.maxValue === null
          ? Number.POSITIVE_INFINITY
          : Number(rate.maxValue);
      return value >= min && value <= max;
    });

    if (!bracket) {
      return null;
    }

    const extra = bracket.perUnitCents
      ? Math.round(
          ((value - Number(bracket.minValue)) / 1000) * bracket.perUnitCents,
        )
      : 0;

    return bracket.priceCents + extra;
  }

  listZones() {
    return this.prisma.shippingZone.findMany({
      orderBy: { priority: 'asc' },
      include: {
        methods: {
          orderBy: { position: 'asc' },
          include: { translations: true, rates: true, carrier: true },
        },
      },
    });
  }

  /** Créneaux encore réservables pour une méthode de livraison sur RDV. */
  availableSlots(methodId: string, from = new Date(), days = 14) {
    const to = new Date(from.getTime() + days * 86_400_000);

    return this.prisma.deliverySlot.findMany({
      where: {
        methodId,
        isActive: true,
        date: { gte: from, lte: to },
      },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
  }
}
