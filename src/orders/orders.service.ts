import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { PaymentsService } from '../payments/payments.service';
import { OrderNumberService } from './order-number.service';
import { OrderAccessService } from './order-access.service';
import { MailService } from '../mail/mail.service';
import { MailTemplate } from '../mail/mail.types';
import { ConfigService } from '@nestjs/config';
import { LoyaltyService } from '../engagement/services/loyalty.service';
import { paginate, type PaginationDto } from '../common/dto/pagination.dto';
import { Prisma } from '../generated/prisma/client';
import type { OrderStatus, Role } from '../generated/prisma/enums';

/**
 * Transitions autorisées. Sans machine à états explicite, une commande peut se
 * retrouver « expédiée » puis « en attente », ce qui casse la comptabilité et
 * la logistique.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly payments: PaymentsService,
    private readonly numbers: OrderNumberService,
    private readonly mail: MailService,
    private readonly loyalty: LoyaltyService,
    private readonly access: OrderAccessService,
    private readonly config: ConfigService,
  ) {}

  private get detailInclude() {
    return {
      items: true,
      addresses: true,
      taxLines: true,
      discounts: true,
      payments: { orderBy: { createdAt: 'desc' as const } },
      refunds: true,
      invoices: true,
      shipments: { include: { items: true, carrier: true } },
      statusHistory: { orderBy: { createdAt: 'asc' as const } },
      returnRequests: { include: { items: true } },
    };
  }

  /**
   * Lecture interne, sans contrôle d'accès : utilisée juste après la création
   * d'une commande, y compris pour un achat sans compte où il n'y a pas encore
   * d'utilisateur à qui la rattacher.
   */
  async findOneInternal(orderId: string) {
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: this.detailInclude,
    });
  }

  async findOne(orderId: string, scope: { userId?: string; role?: Role } = {}) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: this.detailInclude,
    });

    if (!order) {
      throw new NotFoundException('Commande introuvable.');
    }

    this.assertCanRead(order, scope);

    return order;
  }

  async findByNumber(
    number: string,
    scope: { userId?: string; role?: Role } = {},
  ) {
    const order = await this.prisma.order.findUnique({
      where: { number },
      include: this.detailInclude,
    });

    if (!order) {
      throw new NotFoundException('Commande introuvable.');
    }

    this.assertCanRead(order, scope);

    return order;
  }

  async listForCustomer(userId: string, dto: PaginationDto) {
    const where: Prisma.OrderWhereInput = { userId };

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: dto.skip,
        take: dto.perPage,
        include: {
          items: true,
          shipments: { select: { trackingNumber: true, status: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return paginate(items, total, dto);
  }

  async listForAdmin(
    dto: PaginationDto,
    filters: { status?: OrderStatus; search?: string; email?: string },
  ) {
    const where: Prisma.OrderWhereInput = {
      status: filters.status,
      email: filters.email,
      OR: filters.search
        ? [
            { number: { contains: filters.search, mode: 'insensitive' } },
            { email: { contains: filters.search, mode: 'insensitive' } },
          ]
        : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: dto.skip,
        take: dto.perPage,
        include: { items: true, payments: true },
      }),
      this.prisma.order.count({ where }),
    ]);

    return paginate(items, total, dto);
  }

  /**
   * Encaissement confirmé : le stock réservé devient une sortie définitive, la
   * facture est émise et les produits digitaux deviennent téléchargeables.
   * Idempotent — un webhook rejoué ne double pas les écritures.
   */
  async markAsPaid(orderId: string, paymentId?: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true },
      });

      if (order.paymentStatus === 'PAID') {
        return { order, invoiceNumber: null };
      }

      if (paymentId) {
        await tx.payment.update({
          where: { id: paymentId },
          data: { state: 'CAPTURED', capturedAt: new Date() },
        });
      }

      await this.inventory.commitReservations(tx, orderId);

      for (const item of order.items) {
        if (item.productId) {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              soldCount: { increment: Math.round(Number(item.quantity)) },
            },
          });
        }
      }

      await this.grantDigitalDownloads(tx, orderId);
      await this.loyalty.earnFromOrder(tx, order);

      const invoiceNumber = await this.numbers.nextInvoiceNumber(tx);

      await tx.invoice.create({
        data: {
          orderId,
          number: invoiceNumber,
          type: 'INVOICE',
          totalCents: order.totalCents,
          taxCents: order.taxCents,
          currencyCode: order.currencyCode,
        },
      });

      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: 'PAID',
          paidCents: order.totalCents,
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          statusHistory: {
            create: {
              fromStatus: order.status,
              toStatus: 'CONFIRMED',
              reason: 'Paiement reçu',
            },
          },
        },
        include: { items: true },
      });

      this.logger.log(
        `Commande ${order.number} payée, facture ${invoiceNumber}.`,
      );

      return { order: updated, invoiceNumber };
    });

    // L'email part après le commit : notifier un client d'un paiement dont la
    // transaction aurait échoué serait pire que de ne rien envoyer.
    await this.notify(result.order, MailTemplate.OrderPaid, {
      invoiceNumber: result.invoiceNumber,
    });

    return result.order;
  }

  async transition(
    orderId: string,
    toStatus: OrderStatus,
    actorId?: string,
    reason?: string,
  ) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });

    if (!ALLOWED_TRANSITIONS[order.status].includes(toStatus)) {
      throw new BadRequestException(
        `Transition impossible : ${order.status} → ${toStatus}.`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (toStatus === 'CANCELLED') {
        await this.inventory.releaseReservations(tx, { orderId });
      }

      return tx.order.update({
        where: { id: orderId },
        data: {
          status: toStatus,
          cancelledAt: toStatus === 'CANCELLED' ? new Date() : undefined,
          cancelReason: toStatus === 'CANCELLED' ? reason : undefined,
          completedAt: toStatus === 'COMPLETED' ? new Date() : undefined,
          statusHistory: {
            create: { fromStatus: order.status, toStatus, actorId, reason },
          },
        },
        include: this.detailInclude,
      });
    });

    if (toStatus === 'CANCELLED') {
      await this.notify(updated, MailTemplate.OrderCancelled, {
        reason: reason ?? 'non précisé',
      });
    }

    return updated;
  }

  /** Annulation par le client, possible tant que rien n'est expédié. */
  async cancelByCustomer(orderId: string, userId: string, reason?: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });

    if (order.userId !== userId) {
      throw new ForbiddenException('Cette commande ne vous appartient pas.');
    }

    if (order.fulfillmentStatus !== 'UNFULFILLED') {
      throw new BadRequestException(
        'La commande est déjà en cours de préparation, contactez le service client.',
      );
    }

    return this.transition(
      orderId,
      'CANCELLED',
      userId,
      reason ?? 'Annulée par le client',
    );
  }

  /**
   * Remboursement total ou partiel. Le montant remboursé ne peut pas dépasser
   * ce qui a été encaissé, sinon la comptabilité part en négatif.
   */
  async refund(
    orderId: string,
    amountCents: number,
    actorId: string,
    reason?: string,
  ) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        payments: {
          where: { state: 'CAPTURED' },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    const refundable = order.paidCents - order.refundedCents;

    if (amountCents <= 0 || amountCents > refundable) {
      throw new BadRequestException(
        `Montant remboursable maximum : ${refundable} ${order.currencyCode}.`,
      );
    }

    const payment = order.payments[0];
    const adapter = payment ? this.payments.adapterFor(payment.provider) : null;

    const result = adapter
      ? await adapter.refund({
          providerPaymentId: payment?.providerPaymentId ?? null,
          amountCents,
          reason,
        })
      : { providerRefundId: null, succeeded: true };

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.refund.create({
        data: {
          orderId,
          paymentId: payment?.id,
          amountCents,
          reason,
          status: result.succeeded ? 'SUCCEEDED' : 'FAILED',
          providerRefundId: result.providerRefundId,
          isManual: !adapter,
          actorId,
          processedAt: result.succeeded ? new Date() : null,
        },
      });

      const totalRefunded = order.refundedCents + amountCents;
      const invoiceNumber = await this.numbers.nextInvoiceNumber(
        tx,
        'CREDIT_NOTE',
      );

      await tx.invoice.create({
        data: {
          orderId,
          number: invoiceNumber,
          type: 'CREDIT_NOTE',
          totalCents: amountCents,
          taxCents: 0,
          currencyCode: order.currencyCode,
        },
      });

      return tx.order.update({
        where: { id: orderId },
        data: {
          refundedCents: totalRefunded,
          paymentStatus:
            totalRefunded >= order.paidCents
              ? 'REFUNDED'
              : 'PARTIALLY_REFUNDED',
        },
        include: this.detailInclude,
      });
    });

    await this.notify(updated, MailTemplate.OrderRefunded, {
      amount: this.formatMoney(amountCents, order.currencyCode, order.locale),
    });

    return updated;
  }

  /** Expédition : décrémente le reste à expédier et fait avancer la commande. */
  async createShipment(
    orderId: string,
    input: {
      carrierId?: string;
      trackingNumber?: string;
      items: { orderItemId: string; quantity: number }[];
    },
  ) {
    const shipment = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true },
      });

      for (const line of input.items) {
        const item = order.items.find(
          (candidate) => candidate.id === line.orderItemId,
        );

        if (!item) {
          throw new BadRequestException('Ligne de commande inconnue.');
        }

        const remaining =
          Number(item.quantity) - Number(item.fulfilledQuantity);

        if (line.quantity > remaining) {
          throw new BadRequestException(
            `Quantité expédiée supérieure au reste à expédier pour ${item.sku}.`,
          );
        }

        await tx.orderItem.update({
          where: { id: item.id },
          data: { fulfilledQuantity: { increment: line.quantity } },
        });
      }

      const created = await tx.shipment.create({
        data: {
          orderId,
          carrierId: input.carrierId,
          trackingNumber: input.trackingNumber,
          status: 'SHIPPED',
          shippedAt: new Date(),
          items: {
            create: input.items.map((line) => ({
              orderItemId: line.orderItemId,
              quantity: line.quantity,
            })),
          },
        },
        include: { items: true },
      });

      const refreshed = await tx.orderItem.findMany({ where: { orderId } });
      const fullyShipped = refreshed
        .filter((item) => item.requiresShipping)
        .every(
          (item) => Number(item.fulfilledQuantity) >= Number(item.quantity),
        );

      await tx.order.update({
        where: { id: orderId },
        data: {
          fulfillmentStatus: fullyShipped ? 'SHIPPED' : 'PARTIALLY_FULFILLED',
          status: order.status === 'CONFIRMED' ? 'PROCESSING' : order.status,
        },
      });

      return created;
    });

    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { addresses: true },
    });

    const carrier = shipment.carrierId
      ? await this.prisma.carrier.findUnique({
          where: { id: shipment.carrierId },
        })
      : null;

    await this.notify(order, MailTemplate.OrderShipped, {
      carrier: carrier?.name ?? 'notre transporteur',
      trackingNumber: shipment.trackingNumber ?? '—',
      trackingUrl:
        carrier?.trackingUrlTemplate && shipment.trackingNumber
          ? carrier.trackingUrlTemplate.replace(
              '{tracking}',
              shipment.trackingNumber,
            )
          : `${this.config.getOrThrow<string>('storefrontUrl')}/commande/${order.number}`,
    });

    return shipment;
  }

  /**
   * Envoi d'un email lié à une commande. Le prénom vient de l'adresse de
   * livraison figée : le compte client peut avoir changé de nom depuis.
   */
  private async notify(
    order: {
      id: string;
      number: string;
      email: string;
      locale: string;
      totalCents: number;
      currencyCode: string;
      userId?: string | null;
      addresses?: { type: string; firstName: string }[];
    },
    template: (typeof MailTemplate)[keyof typeof MailTemplate],
    variables: Record<string, string | number | null | undefined> = {},
  ): Promise<void> {
    const shipping = order.addresses?.find(
      (address) => address.type === 'SHIPPING',
    );

    await this.mail.enqueue({
      to: order.email,
      template,
      locale: order.locale as 'FR' | 'EN',
      variables: {
        firstName: shipping?.firstName,
        orderNumber: order.number,
        total: this.formatMoney(
          order.totalCents,
          order.currencyCode,
          order.locale,
        ),
        orderUrl: this.access.buildTrackingUrl({
          id: order.id,
          number: order.number,
          userId: order.userId ?? null,
        }),
        ...variables,
      },
      relatedType: 'order',
      relatedId: order.id,
    });
  }

  private formatMoney(cents: number, currency: string, locale: string): string {
    return new Intl.NumberFormat(locale === 'EN' ? 'en-GB' : 'fr-FR', {
      style: 'currency',
      currency,
    }).format(cents / 100);
  }

  private async grantDigitalDownloads(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<void> {
    const items = await tx.orderItem.findMany({
      where: { orderId, isDigital: true },
    });

    for (const item of items) {
      if (!item.variantId) continue;

      const assets = await tx.digitalAsset.findMany({
        where: { variantId: item.variantId },
      });

      for (const asset of assets) {
        await tx.downloadGrant.create({
          data: {
            orderId,
            orderItemId: item.id,
            assetId: asset.id,
            tokenHash: `${orderId}:${asset.id}`,
            maxDownloads: asset.maxDownloads,
            expiresAt: asset.validityDays
              ? new Date(Date.now() + asset.validityDays * 86_400_000)
              : null,
          },
        });
      }
    }
  }

  private assertCanRead(
    order: { userId: string | null; email: string },
    scope: { userId?: string; role?: Role },
  ): void {
    const isStaff = scope.role && scope.role !== 'CUSTOMER';

    if (isStaff) {
      return;
    }

    if (!scope.userId || order.userId !== scope.userId) {
      throw new NotFoundException('Commande introuvable.');
    }
  }
}
