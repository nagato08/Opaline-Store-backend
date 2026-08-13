import { Injectable } from '@nestjs/common';
import { PriceResolverService } from '../pricing/price-resolver.service';
import { TaxService, type TaxLine } from '../pricing/tax.service';
import { SettingsService } from '../pricing/settings.service';
import {
  ShippingService,
  type ShippableLine,
} from '../shipping/shipping.service';
import { InventoryService } from '../inventory/inventory.service';
import { PromotionsService } from '../promotions/promotions.service';
import { MediaService } from '../media/media.service';
import type {
  AppliedPromotion,
  EvaluableLine,
} from '../promotions/rule-engine.types';
import type { StorefrontContext } from '../common/decorators/storefront-context.decorator';
import type { Locale, MediaType } from '../generated/prisma/enums';

export type CalculatedLine = {
  cartItemId: string;
  variantId: string;
  productId: string;
  sku: string;
  name: string;
  variantName: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  /** Remise imputée à cette ligne par le moteur de promotions. */
  discountCents: number;
  netCents: number;
  taxCents: number;
  taxRatePercent: number;
  ecoTaxCents: number;
  weightGrams: number;
  requiresShipping: boolean;
  isDigital: boolean;
  taxClassId: string | null;
  isOversized: boolean;
  requiresColdChain: boolean;
  availableQuantity: number;
  hasEnoughStock: boolean;
  /** Le tarif a changé depuis l'ajout au panier : à signaler au client. */
  priceChanged: boolean;
};

export type CartTotals = {
  currencyCode: string;
  pricesIncludeTax: boolean;
  lines: CalculatedLine[];
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  ecoTaxCents: number;
  discountCents: number;
  totalCents: number;
  totalWeightGrams: number;
  taxLines: {
    name: string;
    jurisdiction: string | null;
    ratePercent: number;
    amountCents: number;
  }[];
  discounts: {
    promotionId: string;
    code: string;
    label: string;
    scope: string;
    amountCents: number;
    freeShipping: boolean;
  }[];
  rejectedCoupons: { code: string; reason: string }[];
  shippingMethodId: string | null;
  hasStockIssue: boolean;
  requiresShipping: boolean;
};

type CartInput = {
  currencyCode: string;
  locale: Locale;
  shippingMethodId: string | null;
  couponCodes?: string[];
  userId?: string | null;
  items: {
    id: string;
    quantity: unknown;
    unitPriceCents: number;
    variant: {
      id: string;
      sku: string;
      weightGrams: number | null;
      isOversized: boolean;
      optionValues: { optionValue: { translations: { label: string }[] } }[];
      product: {
        id: string;
        brandId: string | null;
        ecoTaxCents: number;
        requiresShipping: boolean;
        type: string;
        taxClassId: string | null;
        translations: { name: string }[];
        media: {
          media: { path: string | null; url: string; type: MediaType };
        }[];
        foodDetail: { requiresColdChain: boolean } | null;
        categories: { categoryId: string }[];
        collections: { collectionId: string }[];
      };
    };
  }[];
};

/** Détail intermédiaire d'une ligne, avant application des taxes. */
type RawLine = {
  item: CartInput['items'][number];
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  priceChanged: boolean;
  available: number;
};

@Injectable()
export class CartCalculatorService {
  constructor(
    private readonly prices: PriceResolverService,
    private readonly tax: TaxService,
    private readonly settings: SettingsService,
    private readonly shipping: ShippingService,
    private readonly inventory: InventoryService,
    private readonly promotions: PromotionsService,
    private readonly media: MediaService,
  ) {}

  /**
   * Recalcule intégralement le panier à chaque lecture : prix, remises, taxes,
   * frais de port et disponibilité. Rien n'est cru sur parole côté client.
   *
   * L'ordre compte : les promotions s'appliquent **avant** le calcul de la
   * taxe, parce qu'une remise réduit la base taxable. Calculer la TVA sur le
   * prix plein puis retrancher la remise donnerait un montant de taxe faux et
   * une facture non conforme.
   */
  async calculate(
    cart: CartInput,
    context: StorefrontContext,
    destination?: { countryCode: string; region?: string | null },
  ): Promise<CartTotals> {
    const country = destination?.countryCode ?? context.countryCode;
    const pricesIncludeTax = await this.tax.pricesIncludeTaxFor(country);

    const rawLines = await this.buildRawLines(cart, context);
    const subtotalCents = rawLines.reduce(
      (sum, line) => sum + line.lineTotalCents,
      0,
    );

    const discounts = await this.resolveDiscounts(
      cart,
      context,
      country,
      rawLines,
      subtotalCents,
    );

    const ratesByClass = await this.loadTaxRates(
      cart,
      country,
      destination?.region,
    );

    const lines: CalculatedLine[] = [];
    const taxTotals = new Map<string, { line: TaxLine; amountCents: number }>();

    for (const raw of rawLines) {
      const product = raw.item.variant.product;
      const discountCents = discounts.lineDiscounts.get(raw.item.id) ?? 0;
      const taxableCents = raw.lineTotalCents - discountCents;

      const rates = ratesByClass.get(product.taxClassId ?? '') ?? [];
      const taxed = this.tax.apply(taxableCents, rates, pricesIncludeTax);

      this.accumulateTax(taxTotals, taxed.lines);

      lines.push({
        cartItemId: raw.item.id,
        variantId: raw.item.variant.id,
        productId: product.id,
        sku: raw.item.variant.sku,
        name: product.translations[0]?.name ?? raw.item.variant.sku,
        variantName:
          raw.item.variant.optionValues
            .map((link) => link.optionValue.translations[0]?.label)
            .filter(Boolean)
            .join(' / ') || null,
        imageUrl: this.media.cardUrl(product.media[0]?.media),
        quantity: raw.quantity,
        unitPriceCents: raw.unitPriceCents,
        lineTotalCents: raw.lineTotalCents,
        discountCents,
        netCents: taxed.netCents,
        taxCents: taxed.taxCents,
        taxRatePercent: rates.reduce((sum, rate) => sum + rate.ratePercent, 0),
        ecoTaxCents: product.ecoTaxCents * raw.quantity,
        weightGrams: raw.item.variant.weightGrams ?? 0,
        requiresShipping: product.requiresShipping,
        isDigital: product.type === 'DIGITAL',
        taxClassId: product.taxClassId,
        isOversized: raw.item.variant.isOversized,
        requiresColdChain: product.foodDetail?.requiresColdChain ?? false,
        availableQuantity:
          raw.available === Number.MAX_SAFE_INTEGER
            ? raw.quantity
            : raw.available,
        hasEnoughStock: raw.available >= raw.quantity,
        priceChanged: raw.priceChanged,
      });
    }

    const requiresShipping = lines.some((line) => line.requiresShipping);
    const shipping = await this.resolveShipping(
      cart,
      lines,
      country,
      destination?.region,
      requiresShipping,
      discounts.freeShipping,
      pricesIncludeTax,
      ratesByClass,
      taxTotals,
    );

    const taxCents =
      lines.reduce((sum, line) => sum + line.taxCents, 0) + shipping.taxCents;
    const discountCents = discounts.totalDiscountCents;

    return {
      currencyCode: cart.currencyCode,
      pricesIncludeTax,
      lines,
      subtotalCents,
      shippingCents: shipping.priceCents,
      taxCents,
      ecoTaxCents: lines.reduce((sum, line) => sum + line.ecoTaxCents, 0),
      discountCents,
      // En régime TTC la taxe est déjà comprise dans les prix affichés :
      // l'ajouter au total la compterait deux fois.
      totalCents: pricesIncludeTax
        ? subtotalCents - discountCents + shipping.priceCents
        : subtotalCents - discountCents + shipping.priceCents + taxCents,
      totalWeightGrams: lines.reduce(
        (sum, line) => sum + line.weightGrams * line.quantity,
        0,
      ),
      taxLines: [...taxTotals.values()].map((entry) => ({
        name: entry.line.name,
        jurisdiction: entry.line.jurisdiction,
        ratePercent: entry.line.ratePercent,
        amountCents: entry.amountCents,
      })),
      discounts: discounts.applied.map((promotion) => ({
        promotionId: promotion.promotionId,
        code: promotion.code,
        label: promotion.label,
        scope: promotion.scope,
        amountCents: promotion.amountCents,
        freeShipping: promotion.freeShipping,
      })),
      rejectedCoupons: discounts.rejectedCoupons,
      shippingMethodId: cart.shippingMethodId,
      hasStockIssue: lines.some((line) => !line.hasEnoughStock),
      requiresShipping,
    };
  }

  /** Promotions retenues, exposées au checkout pour être figées sur la commande. */
  async appliedPromotions(
    cart: CartInput,
    context: StorefrontContext,
    destination?: { countryCode: string; region?: string | null },
  ): Promise<AppliedPromotion[]> {
    const rawLines = await this.buildRawLines(cart, context);
    const subtotalCents = rawLines.reduce(
      (sum, line) => sum + line.lineTotalCents,
      0,
    );

    const discounts = await this.resolveDiscounts(
      cart,
      context,
      destination?.countryCode ?? context.countryCode,
      rawLines,
      subtotalCents,
    );

    return discounts.applied;
  }

  private async buildRawLines(
    cart: CartInput,
    context: StorefrontContext,
  ): Promise<RawLine[]> {
    const variantIds = cart.items.map((item) => item.variant.id);

    const [priceMap, availability] = await Promise.all([
      this.prices.resolveMany(variantIds, {
        currencyCode: cart.currencyCode,
        customerGroupId: context.customerGroupId,
      }),
      this.inventory.availableFor(variantIds),
    ]);

    return cart.items.map((item) => {
      const quantity = Number(item.quantity);
      const resolved = priceMap.get(item.variant.id);
      const unitPriceCents = resolved?.amountCents ?? item.unitPriceCents;

      return {
        item,
        quantity,
        unitPriceCents,
        lineTotalCents: Math.round(unitPriceCents * quantity),
        priceChanged: resolved
          ? resolved.amountCents !== item.unitPriceCents
          : false,
        available: availability.get(item.variant.id) ?? 0,
      };
    });
  }

  private async resolveDiscounts(
    cart: CartInput,
    context: StorefrontContext,
    countryCode: string,
    rawLines: RawLine[],
    subtotalCents: number,
  ) {
    const evaluable: EvaluableLine[] = rawLines.map((raw) => ({
      cartItemId: raw.item.id,
      variantId: raw.item.variant.id,
      productId: raw.item.variant.product.id,
      brandId: raw.item.variant.product.brandId,
      categoryIds: raw.item.variant.product.categories.map(
        (link) => link.categoryId,
      ),
      collectionIds: raw.item.variant.product.collections.map(
        (link) => link.collectionId,
      ),
      taxClassId: raw.item.variant.product.taxClassId,
      quantity: raw.quantity,
      unitPriceCents: raw.unitPriceCents,
      lineTotalCents: raw.lineTotalCents,
    }));

    const result = await this.promotions.computeDiscounts(
      {
        lines: evaluable,
        subtotalCents,
        totalQuantity: rawLines.reduce((sum, raw) => sum + raw.quantity, 0),
        currencyCode: cart.currencyCode,
        countryCode,
        customerGroupId: context.customerGroupId,
        userId: cart.userId ?? null,
        // Sans compte, on ne peut pas savoir s'il s'agit d'une première
        // commande : on ne l'affirme que pour un visiteur non connecté.
        isFirstOrder: !cart.userId,
      },
      cart.couponCodes ?? [],
    );

    return {
      applied: result.applied,
      lineDiscounts: result.lineDiscounts,
      totalDiscountCents: result.totalDiscountCents,
      freeShipping: result.freeShipping,
      rejectedCoupons: result.rejectedCodes,
    };
  }

  private async loadTaxRates(
    cart: CartInput,
    country: string,
    region?: string | null,
  ): Promise<Map<string, TaxLine[]>> {
    const taxClassIds = [
      ...new Set(
        cart.items
          .map((item) => item.variant.product.taxClassId)
          .filter(Boolean),
      ),
    ] as string[];

    const ratesByClass = new Map<string, TaxLine[]>();

    // Un appel de taux par classe fiscale, pas par ligne.
    await Promise.all(
      taxClassIds.map(async (taxClassId) => {
        ratesByClass.set(
          taxClassId,
          await this.tax.ratesFor(country, taxClassId, region),
        );
      }),
    );

    return ratesByClass;
  }

  private async resolveShipping(
    cart: CartInput,
    lines: CalculatedLine[],
    country: string,
    region: string | null | undefined,
    requiresShipping: boolean,
    freeShipping: boolean,
    pricesIncludeTax: boolean,
    ratesByClass: Map<string, TaxLine[]>,
    taxTotals: Map<string, { line: TaxLine; amountCents: number }>,
  ): Promise<{ priceCents: number; taxCents: number }> {
    if (!requiresShipping || !cart.shippingMethodId) {
      return { priceCents: 0, taxCents: 0 };
    }

    const shippable: ShippableLine[] = lines
      .filter((line) => line.requiresShipping)
      .map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
        weightGrams: line.weightGrams,
        isOversized: line.isOversized,
        requiresColdChain: line.requiresColdChain,
        lineTotalCents: line.lineTotalCents,
      }));

    const quote = await this.shipping
      .quoteForMethod(
        cart.shippingMethodId,
        { countryCode: country, region },
        shippable,
        cart.currencyCode,
        cart.locale,
      )
      .catch(() => null);

    if (!quote) {
      return { priceCents: 0, taxCents: 0 };
    }

    // Une promotion « livraison offerte » annule les frais, mais le mode de
    // livraison choisi reste celui du client.
    const priceCents = freeShipping ? 0 : quote.priceCents;

    if (priceCents === 0) {
      return { priceCents: 0, taxCents: 0 };
    }

    // Les frais de port suivent leur propre classe fiscale ; à défaut, ils
    // sont taxés au taux normal du pays de destination.
    const shippingRates = quote.taxClassId
      ? (ratesByClass.get(quote.taxClassId) ??
        (await this.tax.ratesFor(country, quote.taxClassId, region)))
      : [];

    const taxed = this.tax.apply(priceCents, shippingRates, pricesIncludeTax);
    this.accumulateTax(taxTotals, taxed.lines);

    return { priceCents, taxCents: taxed.taxCents };
  }

  private accumulateTax(
    totals: Map<string, { line: TaxLine; amountCents: number }>,
    lines: (TaxLine & { amountCents: number })[],
  ): void {
    for (const taxLine of lines) {
      const key = `${taxLine.name}|${taxLine.ratePercent}`;
      const current = totals.get(key);
      totals.set(key, {
        line: taxLine,
        amountCents: (current?.amountCents ?? 0) + taxLine.amountCents,
      });
    }
  }
}
