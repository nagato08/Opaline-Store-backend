import { Global, Module } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { ManualPaymentProvider } from './providers/manual.provider';
import { PAYMENT_PROVIDERS } from './payment-provider.interface';

/**
 * Les adaptateurs sont regroupés dans un tableau injecté : ajouter Stripe ou
 * PayPal se limitera à écrire l'adaptateur et à l'ajouter ici.
 */
@Global()
@Module({
  providers: [
    ManualPaymentProvider,
    {
      provide: PAYMENT_PROVIDERS,
      inject: [ManualPaymentProvider],
      useFactory: (manual: ManualPaymentProvider) => [manual],
    },
    PaymentsService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
