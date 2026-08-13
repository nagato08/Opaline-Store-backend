import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type TaxLine = {
  name: string;
  jurisdiction: string | null;
  ratePercent: number;
  isCompound: boolean;
};

export type TaxedAmount = {
  netCents: number;
  taxCents: number;
  grossCents: number;
  lines: (TaxLine & { amountCents: number })[];
};

@Injectable()
export class TaxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Taux applicables pour une destination et une classe de produit.
   *
   * Aux États-Unis et au Canada, la taxe dépend de l'État/province voire de la
   * commune : ce résolveur couvre le cas UE (un taux par pays) et sert de
   * repli ailleurs. Pour l'Amérique du Nord en production, il faut brancher un
   * prestataire fiscal (Stripe Tax, Avalara) — le modèle est prêt à recevoir
   * plusieurs lignes de taxe par commande.
   */
  async ratesFor(
    countryCode: string,
    taxClassId: string | null,
    region?: string | null,
  ): Promise<TaxLine[]> {
    if (!taxClassId) {
      return [];
    }

    const now = new Date();

    const rates = await this.prisma.taxRate.findMany({
      where: {
        taxClassId,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
        taxZone: {
          isActive: true,
          countries: {
            some: {
              countryCode,
              ...(region
                ? { OR: [{ region: null }, { region }] }
                : { region: null }),
            },
          },
        },
      },
      orderBy: { priority: 'asc' },
      include: { taxZone: { select: { name: true } } },
    });

    return rates.map((rate) => ({
      name: rate.name,
      jurisdiction: rate.taxZone.name,
      ratePercent: Number(rate.ratePercent),
      isCompound: rate.isCompound,
    }));
  }

  /**
   * Régime d'affichage du pays de destination.
   *
   * La France impose l'affichage TTC, le Canada affiche hors taxe et ajoute
   * GST/TVQ/HST au paiement. Le réglage est donc porté par le pays, pas par la
   * boutique : avec les deux marchés ouverts, un booléen global en trahirait
   * forcément un.
   */
  async pricesIncludeTaxFor(countryCode: string): Promise<boolean> {
    const country = await this.prisma.country.findUnique({
      where: { code: countryCode.toUpperCase() },
      select: { pricesIncludeTax: true },
    });

    return country?.pricesIncludeTax ?? true;
  }

  /**
   * Ventile un montant selon les taux fournis.
   * `pricesIncludeTax` distingue le régime UE (prix affichés TTC) du régime
   * nord-américain (taxe ajoutée au moment du paiement).
   */
  apply(
    amountCents: number,
    rates: TaxLine[],
    pricesIncludeTax: boolean,
  ): TaxedAmount {
    if (rates.length === 0) {
      return {
        netCents: amountCents,
        taxCents: 0,
        grossCents: amountCents,
        lines: [],
      };
    }

    const lines: (TaxLine & { amountCents: number })[] = [];

    if (pricesIncludeTax) {
      const totalRate = rates.reduce((sum, rate) => sum + rate.ratePercent, 0);
      const netCents = Math.round(amountCents / (1 + totalRate / 100));
      let remaining = amountCents - netCents;

      rates.forEach((rate, index) => {
        // La dernière ligne absorbe l'arrondi pour que la somme des lignes
        // corresponde exactement au total affiché.
        const share =
          index === rates.length - 1
            ? remaining
            : Math.round((netCents * rate.ratePercent) / 100);
        remaining -= share;
        lines.push({ ...rate, amountCents: share });
      });

      return {
        netCents,
        taxCents: amountCents - netCents,
        grossCents: amountCents,
        lines,
      };
    }

    let base = amountCents;
    let taxTotal = 0;

    for (const rate of rates) {
      const taxable = rate.isCompound ? base + taxTotal : base;
      const amount = Math.round((taxable * rate.ratePercent) / 100);
      taxTotal += amount;
      lines.push({ ...rate, amountCents: amount });
    }

    base = amountCents;

    return {
      netCents: base,
      taxCents: taxTotal,
      grossCents: base + taxTotal,
      lines,
    };
  }
}
