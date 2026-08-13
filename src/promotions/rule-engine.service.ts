import { Injectable, Logger } from '@nestjs/common';
import type {
  ConditionNode,
  EvaluableLine,
  EvaluationContext,
  LeafCondition,
  LineSelector,
  ListOperator,
  NumericOperator,
  PromotionAction,
} from './rule-engine.types';

export type ActionOutcome = {
  amountCents: number;
  lineDiscounts: Map<string, number>;
  freeShipping: boolean;
};

/**
 * Évaluateur de règles. Il ne connaît ni Prisma ni HTTP : il prend un contexte
 * de panier et un arbre de conditions, et rend un montant de remise ventilé
 * par ligne. Cette ventilation est indispensable en UE, où une remise réduit
 * la base taxable de chaque article.
 */
@Injectable()
export class RuleEngineService {
  private readonly logger = new Logger(RuleEngineService.name);

  /** Le panier remplit-il les conditions de la promotion ? */
  evaluate(
    node: ConditionNode | null | undefined,
    context: EvaluationContext,
  ): boolean {
    if (!node || Object.keys(node).length === 0) {
      return true;
    }

    if ('all' in node && Array.isArray(node.all)) {
      return node.all.every((child) => this.evaluate(child, context));
    }

    if ('any' in node && Array.isArray(node.any)) {
      return node.any.some((child) => this.evaluate(child, context));
    }

    if ('not' in node && node.not) {
      return !this.evaluate(node.not, context);
    }

    return this.evaluateLeaf(node as LeafCondition, context);
  }

  /** Calcule la remise produite par une action, ventilée par ligne. */
  apply(action: PromotionAction, context: EvaluationContext): ActionOutcome {
    const empty: ActionOutcome = {
      amountCents: 0,
      lineDiscounts: new Map(),
      freeShipping: false,
    };

    switch (action.type) {
      case 'FREE_SHIPPING':
        return { ...empty, freeShipping: true };

      case 'PERCENTAGE_OFF': {
        const targets = this.resolveTargets(
          action.appliesTo,
          action.target,
          context,
        );
        const lineDiscounts = new Map<string, number>();
        let total = 0;

        for (const line of targets) {
          const discount = Math.round(
            (line.lineTotalCents * action.value) / 100,
          );
          lineDiscounts.set(line.cartItemId, discount);
          total += discount;
        }

        if (action.maxDiscountCents && total > action.maxDiscountCents) {
          return this.capDiscount(
            lineDiscounts,
            total,
            action.maxDiscountCents,
          );
        }

        return { amountCents: total, lineDiscounts, freeShipping: false };
      }

      case 'FIXED_OFF': {
        const targets = this.resolveTargets(
          action.appliesTo,
          action.target,
          context,
        );
        const base = targets.reduce(
          (sum, line) => sum + line.lineTotalCents,
          0,
        );

        // Une remise fixe ne peut pas dépasser le montant sur lequel elle porte,
        // sinon le total part en négatif.
        const total = Math.min(action.value, base);

        return this.spreadProportionally(targets, total, base);
      }

      case 'BUY_X_GET_Y': {
        const targets = this.resolveTargets(
          'MATCHED_ITEMS',
          action.target,
          context,
        );
        const discountPercent = action.discountPercent ?? 100;
        const groupSize = action.buyQuantity + action.getQuantity;

        // Les articles offerts sont les moins chers du lot : c'est la règle
        // commerciale usuelle et la plus défendable vis-à-vis du client.
        const units = targets
          .flatMap((line) =>
            Array.from({ length: Math.floor(line.quantity) }, () => ({
              cartItemId: line.cartItemId,
              unitPriceCents: line.unitPriceCents,
            })),
          )
          .sort((a, b) => a.unitPriceCents - b.unitPriceCents);

        const freeUnits =
          Math.floor(units.length / groupSize) * action.getQuantity;
        const lineDiscounts = new Map<string, number>();
        let total = 0;

        for (const unit of units.slice(0, freeUnits)) {
          const discount = Math.round(
            (unit.unitPriceCents * discountPercent) / 100,
          );
          lineDiscounts.set(
            unit.cartItemId,
            (lineDiscounts.get(unit.cartItemId) ?? 0) + discount,
          );
          total += discount;
        }

        return { amountCents: total, lineDiscounts, freeShipping: false };
      }

      default:
        this.logger.warn(
          `Action de promotion inconnue : ${JSON.stringify(action)}`,
        );
        return empty;
    }
  }

  /** Lignes correspondant à un sélecteur (catégorie, marque, produit…). */
  matchLines(
    selector: LineSelector | undefined,
    lines: EvaluableLine[],
  ): EvaluableLine[] {
    if (!selector || Object.keys(selector).length === 0) {
      return lines;
    }

    return lines.filter((line) => this.lineMatches(selector, line));
  }

  private resolveTargets(
    appliesTo: string | undefined,
    selector: LineSelector | undefined,
    context: EvaluationContext,
  ): EvaluableLine[] {
    const matched = this.matchLines(selector, context.lines);

    switch (appliesTo) {
      case 'CHEAPEST_MATCHED': {
        const cheapest = [...matched].sort(
          (a, b) => a.unitPriceCents - b.unitPriceCents,
        )[0];
        return cheapest ? [cheapest] : [];
      }
      case 'MOST_EXPENSIVE_MATCHED': {
        const priciest = [...matched].sort(
          (a, b) => b.unitPriceCents - a.unitPriceCents,
        )[0];
        return priciest ? [priciest] : [];
      }
      case 'CART':
        return context.lines;
      case 'MATCHED_ITEMS':
      default:
        return matched;
    }
  }

  /**
   * Répartit un montant global au prorata du poids de chaque ligne, le reste
   * de l'arrondi étant absorbé par la dernière ligne pour que la somme des
   * remises corresponde exactement au montant annoncé.
   */
  private spreadProportionally(
    lines: EvaluableLine[],
    total: number,
    base: number,
  ): ActionOutcome {
    const lineDiscounts = new Map<string, number>();

    if (base <= 0 || total <= 0) {
      return { amountCents: 0, lineDiscounts, freeShipping: false };
    }

    let remaining = total;

    lines.forEach((line, index) => {
      const share =
        index === lines.length - 1
          ? remaining
          : Math.round((line.lineTotalCents / base) * total);

      remaining -= share;
      lineDiscounts.set(line.cartItemId, share);
    });

    return { amountCents: total, lineDiscounts, freeShipping: false };
  }

  private capDiscount(
    lineDiscounts: Map<string, number>,
    total: number,
    cap: number,
  ): ActionOutcome {
    const capped = new Map<string, number>();
    let remaining = cap;
    const entries = [...lineDiscounts.entries()];

    entries.forEach(([cartItemId, amount], index) => {
      const share =
        index === entries.length - 1
          ? remaining
          : Math.round((amount / total) * cap);
      remaining -= share;
      capped.set(cartItemId, share);
    });

    return { amountCents: cap, lineDiscounts: capped, freeShipping: false };
  }

  private evaluateLeaf(
    condition: LeafCondition,
    context: EvaluationContext,
  ): boolean {
    if (
      condition.cartSubtotal &&
      !this.matchNumber(condition.cartSubtotal, context.subtotalCents)
    ) {
      return false;
    }

    if (
      condition.cartQuantity &&
      !this.matchNumber(condition.cartQuantity, context.totalQuantity)
    ) {
      return false;
    }

    if (
      condition.currency &&
      !this.matchList(condition.currency, [context.currencyCode])
    ) {
      return false;
    }

    if (
      condition.country &&
      !this.matchList(condition.country, [context.countryCode])
    ) {
      return false;
    }

    if (
      condition.customerGroup &&
      !this.matchList(
        condition.customerGroup,
        context.customerGroupId ? [context.customerGroupId] : [],
      )
    ) {
      return false;
    }

    if (
      condition.firstOrder !== undefined &&
      condition.firstOrder !== context.isFirstOrder
    ) {
      return false;
    }

    if (condition.authenticated !== undefined) {
      if (condition.authenticated !== Boolean(context.userId)) {
        return false;
      }
    }

    // Les critères portant sur les articles sont satisfaits dès qu'au moins
    // une ligne du panier correspond.
    const lineSelector = this.extractSelector(condition);

    if (Object.keys(lineSelector).length > 0) {
      return context.lines.some((line) => this.lineMatches(lineSelector, line));
    }

    return true;
  }

  private extractSelector(condition: LeafCondition): LineSelector {
    const selector: LineSelector = {};

    if (condition.product) selector.product = condition.product;
    if (condition.variant) selector.variant = condition.variant;
    if (condition.category) selector.category = condition.category;
    if (condition.brand) selector.brand = condition.brand;
    if (condition.collection) selector.collection = condition.collection;
    if (condition.taxClass) selector.taxClass = condition.taxClass;

    return selector;
  }

  private lineMatches(selector: LineSelector, line: EvaluableLine): boolean {
    if (selector.product && !this.matchList(selector.product, [line.productId]))
      return false;
    if (selector.variant && !this.matchList(selector.variant, [line.variantId]))
      return false;
    if (
      selector.category &&
      !this.matchList(selector.category, line.categoryIds)
    )
      return false;
    if (
      selector.collection &&
      !this.matchList(selector.collection, line.collectionIds)
    )
      return false;
    if (
      selector.brand &&
      !this.matchList(selector.brand, line.brandId ? [line.brandId] : [])
    )
      return false;
    if (
      selector.taxClass &&
      !this.matchList(
        selector.taxClass,
        line.taxClassId ? [line.taxClassId] : [],
      )
    )
      return false;

    return true;
  }

  private matchNumber(operator: NumericOperator, value: number): boolean {
    if (operator.eq !== undefined && value !== operator.eq) return false;
    if (operator.gt !== undefined && !(value > operator.gt)) return false;
    if (operator.gte !== undefined && !(value >= operator.gte)) return false;
    if (operator.lt !== undefined && !(value < operator.lt)) return false;
    if (operator.lte !== undefined && !(value <= operator.lte)) return false;
    return true;
  }

  private matchList(operator: ListOperator, values: string[]): boolean {
    if (operator.in && !values.some((value) => operator.in?.includes(value)))
      return false;
    if (
      operator.notIn &&
      values.some((value) => operator.notIn?.includes(value))
    )
      return false;
    return true;
  }
}
