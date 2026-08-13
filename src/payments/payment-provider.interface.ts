import type { PaymentProvider as ProviderCode } from '../generated/prisma/enums';

export type PaymentIntentInput = {
  orderId: string;
  orderNumber: string;
  amountCents: number;
  currencyCode: string;
  customerEmail: string;
  locale: string;
  returnUrl: string;
};

export type PaymentIntentResult = {
  /** Identifiant côté prestataire, réconcilié plus tard par webhook. */
  providerPaymentId: string | null;
  /** État immédiat : un virement reste PENDING, une carte peut être capturée. */
  state: 'PENDING' | 'REQUIRES_ACTION' | 'AUTHORIZED' | 'CAPTURED';
  /** URL de redirection ou données à passer au SDK côté navigateur. */
  redirectUrl?: string;
  clientSecret?: string;
  instructions?: string;
  raw?: Record<string, unknown>;
};

export type RefundInput = {
  providerPaymentId: string | null;
  amountCents: number;
  reason?: string;
};

export type RefundResult = {
  providerRefundId: string | null;
  succeeded: boolean;
};

export type WebhookVerification = {
  eventId: string;
  type: string;
  providerPaymentId: string | null;
  payload: Record<string, unknown>;
};

/**
 * Port de paiement. Chaque prestataire fournit son adaptateur ; le reste de
 * l'application ne connaît que cette interface, ce qui permet de brancher
 * Stripe, PayPal ou un paiement à la livraison sans toucher au checkout.
 */
export interface PaymentProviderAdapter {
  readonly code: ProviderCode;
  readonly isConfigured: boolean;
  /** Vrai si le paiement est acquis sans attendre de webhook. */
  readonly capturesImmediately: boolean;

  createPayment(input: PaymentIntentInput): Promise<PaymentIntentResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  verifyWebhook(
    rawBody: Buffer,
    signature: string | undefined,
  ): WebhookVerification;
}

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');
