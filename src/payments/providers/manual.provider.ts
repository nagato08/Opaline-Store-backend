import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  PaymentIntentInput,
  PaymentIntentResult,
  PaymentProviderAdapter,
  RefundResult,
  WebhookVerification,
} from '../payment-provider.interface';

/**
 * Paiement hors ligne : virement bancaire, chèque, espèces à la livraison, ou
 * mode démonstration tant qu'aucun prestataire n'est contractualisé (il faut
 * une société immatriculée pour ouvrir un compte Stripe ou PayPal).
 *
 * La commande est créée et le stock réservé, mais l'encaissement reste à
 * valider manuellement depuis l'administration.
 */
@Injectable()
export class ManualPaymentProvider implements PaymentProviderAdapter {
  readonly code = 'MANUAL' as const;
  readonly isConfigured = true;
  readonly capturesImmediately = false;

  createPayment(input: PaymentIntentInput): Promise<PaymentIntentResult> {
    return Promise.resolve({
      providerPaymentId: `manual_${randomUUID()}`,
      state: 'PENDING',
      instructions:
        `Virement à effectuer en indiquant la référence ${input.orderNumber}. ` +
        'La commande sera préparée dès réception du règlement.',
    });
  }

  refund(): Promise<RefundResult> {
    // Le remboursement réel est fait à la main (virement retour) ; on trace
    // seulement l'opération.
    return Promise.resolve({
      providerRefundId: `manual_refund_${randomUUID()}`,
      succeeded: true,
    });
  }

  verifyWebhook(): WebhookVerification {
    throw new BadRequestException(
      'Ce mode de paiement ne reçoit pas de webhooks.',
    );
  }
}
