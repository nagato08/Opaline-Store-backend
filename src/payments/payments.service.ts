import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PAYMENT_PROVIDERS,
  type PaymentProviderAdapter,
} from './payment-provider.interface';
import { Prisma } from '../generated/prisma/client';
import type { PaymentProvider } from '../generated/prisma/enums';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PROVIDERS)
    private readonly providers: PaymentProviderAdapter[],
  ) {}

  availableProviders() {
    return this.providers
      .filter((provider) => provider.isConfigured)
      .map((provider) => ({
        code: provider.code,
        capturesImmediately: provider.capturesImmediately,
      }));
  }

  adapterFor(code: PaymentProvider): PaymentProviderAdapter {
    const provider = this.providers.find(
      (item) => item.code === code && item.isConfigured,
    );

    if (!provider) {
      throw new BadRequestException(
        `Moyen de paiement indisponible : ${code}.`,
      );
    }

    return provider;
  }

  /** Crée la tentative de paiement rattachée à une commande. */
  async createForOrder(
    tx: Prisma.TransactionClient,
    order: {
      id: string;
      number: string;
      email: string;
      locale: string;
      totalCents: number;
      currencyCode: string;
    },
    providerCode: PaymentProvider,
    returnUrl: string,
    idempotencyKey?: string,
  ) {
    const adapter = this.adapterFor(providerCode);

    const intent = await adapter.createPayment({
      orderId: order.id,
      orderNumber: order.number,
      amountCents: order.totalCents,
      currencyCode: order.currencyCode,
      customerEmail: order.email,
      locale: order.locale,
      returnUrl,
    });

    const payment = await tx.payment.create({
      data: {
        orderId: order.id,
        provider: providerCode,
        providerPaymentId: intent.providerPaymentId,
        state: intent.state,
        amountCents: order.totalCents,
        currencyCode: order.currencyCode,
        authorizedAt: intent.state === 'AUTHORIZED' ? new Date() : null,
        capturedAt: intent.state === 'CAPTURED' ? new Date() : null,
        rawResponse: intent.raw as Prisma.InputJsonValue,
        idempotencyKey,
      },
    });

    return {
      payment,
      redirectUrl: intent.redirectUrl,
      clientSecret: intent.clientSecret,
      instructions: intent.instructions,
    };
  }

  /**
   * Enregistre un événement entrant avant tout traitement métier : si le même
   * événement est rejoué par le prestataire, il est ignoré.
   */
  async recordWebhookEvent(
    provider: string,
    externalId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const existing = await this.prisma.webhookEvent.findUnique({
      where: { provider_externalId: { provider, externalId } },
    });

    if (existing?.processedAt) {
      this.logger.debug(
        `Webhook ${provider}/${externalId} déjà traité, ignoré.`,
      );
      return false;
    }

    await this.prisma.webhookEvent.upsert({
      where: { provider_externalId: { provider, externalId } },
      update: { attempts: { increment: 1 } },
      create: {
        provider,
        externalId,
        type,
        payload: payload as Prisma.InputJsonValue,
      },
    });

    return true;
  }

  async markWebhookProcessed(
    provider: string,
    externalId: string,
    error?: string,
  ): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { provider_externalId: { provider, externalId } },
      data: { processedAt: error ? null : new Date(), error },
    });
  }
}
