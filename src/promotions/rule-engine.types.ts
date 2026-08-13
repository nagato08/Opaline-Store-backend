/**
 * Grammaire du moteur de règles, partagée par les promotions et les campagnes
 * d'affichage. Le format est volontairement déclaratif : l'administration
 * compose des règles sans qu'il faille redéployer du code, et une nouvelle
 * mécanique commerciale ne demande pas une table de plus.
 */

export type NumericOperator = {
  eq?: number;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
};

export type ListOperator = {
  in?: string[];
  notIn?: string[];
};

/** Sélecteur de lignes : détermine sur quels articles porte une action. */
export type LineSelector = {
  product?: ListOperator;
  variant?: ListOperator;
  category?: ListOperator;
  brand?: ListOperator;
  collection?: ListOperator;
  /** Restreint aux articles d'une classe fiscale (alimentaire, standard…). */
  taxClass?: ListOperator;
};

export type LeafCondition = LineSelector & {
  cartSubtotal?: NumericOperator;
  cartQuantity?: NumericOperator;
  customerGroup?: ListOperator;
  country?: ListOperator;
  currency?: ListOperator;
  /** Réservé à la première commande du client. */
  firstOrder?: boolean;
  /** Réservé aux clients connectés. */
  authenticated?: boolean;
};

export type ConditionNode =
  | { all: ConditionNode[] }
  | { any: ConditionNode[] }
  | { not: ConditionNode }
  | LeafCondition;

export type ActionTarget =
  'CART' | 'MATCHED_ITEMS' | 'CHEAPEST_MATCHED' | 'MOST_EXPENSIVE_MATCHED';

export type PromotionAction =
  | {
      type: 'PERCENTAGE_OFF';
      value: number;
      appliesTo?: ActionTarget;
      target?: LineSelector;
      maxDiscountCents?: number;
    }
  | {
      type: 'FIXED_OFF';
      value: number;
      appliesTo?: ActionTarget;
      target?: LineSelector;
    }
  | { type: 'FREE_SHIPPING' }
  | {
      /** « 2 achetés, le 3e offert » : `getQuantity` articles à `discountPercent`. */
      type: 'BUY_X_GET_Y';
      buyQuantity: number;
      getQuantity: number;
      discountPercent?: number;
      target?: LineSelector;
    };

/** Ligne de panier telle que vue par le moteur, sans dépendance à Prisma. */
export type EvaluableLine = {
  cartItemId: string;
  variantId: string;
  productId: string;
  brandId: string | null;
  categoryIds: string[];
  collectionIds: string[];
  taxClassId: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
};

export type EvaluationContext = {
  lines: EvaluableLine[];
  subtotalCents: number;
  totalQuantity: number;
  currencyCode: string;
  countryCode: string;
  customerGroupId: string | null;
  userId: string | null;
  isFirstOrder: boolean;
};

export type AppliedPromotion = {
  promotionId: string;
  code: string;
  label: string;
  scope: 'ITEM' | 'CART' | 'SHIPPING';
  amountCents: number;
  freeShipping: boolean;
  /** Remise imputée à chaque ligne, pour recalculer la base taxable. */
  lineDiscounts: Map<string, number>;
  couponId: string | null;
};
