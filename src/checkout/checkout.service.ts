import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { CartCalculatorService } from '../cart/cart-calculator.service';
import { InventoryService } from '../inventory/inventory.service';
import { PaymentsService } from '../payments/payments.service';
import { OrderNumberService } from '../orders/order-number.service';
import { OrdersService } from '../orders/orders.service';
import { OrderAccessService } from '../orders/order-access.service';
import { SettingsService } from '../pricing/settings.service';
import { PromotionsService } from '../promotions/promotions.service';
import { MailService } from '../mail/mail.service';
import { MailTemplate } from '../mail/mail.types';
import type { StorefrontContext } from '../common/decorators/storefront-context.decorator';
import type { PlaceOrderDto } from './dto/checkout.dto';
import type { AddressInputDto } from '../cart/dto/cart.dto';
import { Prisma } from '../generated/prisma/client';
import type { AddressType, DiscountScope } from '../generated/prisma/enums';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly calculator: CartCalculatorService,
    private readonly inventory: InventoryService,
    private readonly payments: PaymentsService,
    private readonly numbers: OrderNumberService,
    private readonly orders: OrdersService,
    private readonly promotions: PromotionsService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly orderAccess: OrderAccessService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Transforme le panier en commande.
   *
   * Tout se joue dans une seule transaction : recalcul des montants côté
   * serveur, verrouillage et réservation du stock, création de la commande
   * avec ses montants figés, puis ouverture du paiement. Si une étape échoue,
   * rien n'est écrit — pas de commande fantôme ni de stock bloqué.
   *
   * La route est idempotente (`Idempotency-Key`) : un double-clic ou un retry
   * réseau ne crée pas deux commandes.
   */
  async placeOrder(
    cartToken: string | undefined,
    dto: PlaceOrderDto,
    context: StorefrontContext,
    userId?: string,
    requestMeta?: { ip?: string; userAgent?: string },
  ) {
    if (!dto.acceptsTerms) {
      throw new BadRequestException(
        'Les conditions générales de vente doivent être acceptées.',
      );
    }

    // La boutique peut exiger un compte. Par défaut l'achat sans compte reste
    // ouvert : imposer une inscription au moment de payer fait chuter la
    // conversion bien plus qu'elle ne fidélise.
    const guestEnabled = await this.settings.get<boolean>(
      'checkout.guestEnabled',
      true,
    );

    if (!guestEnabled && !userId) {
      throw new UnauthorizedException(
        'La création d’un compte est requise pour commander.',
      );
    }

    const cart = await this.loadCart(cartToken, userId);

    if (cart.items.length === 0) {
      throw new BadRequestException('Votre panier est vide.');
    }

    const billing = dto.billingSameAsShipping
      ? dto.shippingAddress
      : (dto.billingAddress ?? dto.shippingAddress);
    const destination = {
      countryCode: dto.shippingAddress.countryCode.toUpperCase(),
      region: dto.shippingAddress.region ?? null,
    };

    await this.assertCountryIsServed(destination.countryCode);

    const cartForCalculation = {
      ...cart,
      shippingMethodId: dto.shippingMethodId,
      userId: userId ?? null,
    };

    const [totals, appliedPromotions] = await Promise.all([
      this.calculator.calculate(cartForCalculation, context, destination),
      this.calculator.appliedPromotions(
        cartForCalculation,
        context,
        destination,
      ),
    ]);

    if (totals.hasStockIssue) {
      const missing = totals.lines
        .filter((line) => !line.hasEnoughStock)
        .map((line) => line.sku);
      throw new BadRequestException(
        `Stock insuffisant : ${missing.join(', ')}.`,
      );
    }

    if (
      totals.requiresShipping &&
      totals.shippingCents === 0 &&
      !dto.shippingMethodId
    ) {
      throw new BadRequestException('Un mode de livraison est requis.');
    }

    const order = await this.prisma.$transaction(
      async (tx) => {
        const number = await this.numbers.nextOrderNumber(tx);

        const created = await tx.order.create({
          data: {
            number,
            userId,
            email: dto.email.toLowerCase(),
            phone: dto.shippingAddress.phone,
            status: 'PENDING',
            paymentStatus: 'UNPAID',
            fulfillmentStatus: 'UNFULFILLED',
            currencyCode: cart.currencyCode,
            locale: cart.locale,
            pricesIncludeTax: totals.pricesIncludeTax,
            subtotalCents: totals.subtotalCents,
            discountCents: totals.discountCents,
            shippingCents: totals.shippingCents,
            taxCents: totals.taxCents,
            ecoTaxCents: totals.ecoTaxCents,
            totalCents: totals.totalCents,
            vatNumber: billing.vatNumber,
            customerNote: dto.customerNote ?? cart.customerNote,
            ip: requestMeta?.ip,
            userAgent: requestMeta?.userAgent,
            placedAt: new Date(),
            addresses: {
              create: [
                this.toAddressData('SHIPPING', dto.shippingAddress),
                this.toAddressData('BILLING', billing),
              ],
            },
            discounts: {
              create: totals.discounts.map((discount) => ({
                promotionId: discount.promotionId,
                code: discount.code,
                label: discount.label,
                scope: discount.scope as DiscountScope,
                amountCents: discount.amountCents,
              })),
            },
            taxLines: {
              create: totals.taxLines.map((line) => ({
                name: line.name,
                jurisdiction: line.jurisdiction,
                ratePercent: line.ratePercent,
                taxableCents: totals.subtotalCents,
                amountCents: line.amountCents,
              })),
            },
            items: {
              create: totals.lines.map((line) => ({
                variantId: line.variantId,
                productId: line.productId,
                sku: line.sku,
                name: line.name,
                variantName: line.variantName,
                imageUrl: line.imageUrl,
                quantity: line.quantity,
                unitPriceCents: line.unitPriceCents,
                discountCents: line.discountCents,
                taxRatePercent: line.taxRatePercent,
                taxCents: line.taxCents,
                ecoTaxCents: line.ecoTaxCents,
                totalCents: line.lineTotalCents,
                weightGrams: line.weightGrams,
                requiresShipping: line.requiresShipping,
                isDigital: line.isDigital,
              })),
            },
            statusHistory: {
              create: { toStatus: 'PENDING', reason: 'Commande créée' },
            },
          },
          include: { items: true },
        });

        await this.inventory.reserveForOrder(
          tx,
          created.id,
          totals.lines.map((line) => ({
            variantId: line.variantId,
            quantity: line.quantity,
          })),
        );

        // Compteurs d'usage et trace nominative : c'est ce qui fait respecter
        // les limites « une fois par client » et « 500 premiers ».
        await this.promotions.recordRedemptions(
          tx,
          created.id,
          userId ?? null,
          appliedPromotions,
        );

        await tx.cart.update({
          where: { id: cart.id },
          data: { status: 'CONVERTED', convertedOrderId: created.id },
        });

        if (dto.acceptsMarketing && userId) {
          await tx.user.update({
            where: { id: userId },
            data: { acceptsMarketing: true },
          });
        }

        return created;
      },
      { timeout: 20_000, isolationLevel: 'ReadCommitted' },
    );

    const payment = await this.prisma.$transaction((tx) =>
      this.payments.createForOrder(
        tx,
        {
          id: order.id,
          number: order.number,
          email: order.email,
          locale: order.locale,
          totalCents: order.totalCents,
          currencyCode: order.currencyCode,
        },
        dto.paymentProvider,
        `${this.config.getOrThrow<string>('storefrontUrl')}/commande/${order.number}`,
      ),
    );

    await this.mail.enqueue({
      to: order.email,
      template: MailTemplate.OrderConfirmation,
      locale: order.locale,
      variables: {
        firstName: dto.shippingAddress.firstName,
        orderNumber: order.number,
        total: this.formatMoney(
          order.totalCents,
          order.currencyCode,
          order.locale,
        ),
        shippingMethod:
          totals.shippingCents > 0 ? 'Livraison standard' : 'Offerte',
        paymentInstructions: payment.instructions ?? '',
        // Pour un achat sans compte, le lien porte un jeton signé : c'est le
        // seul moyen pour le client de retrouver sa commande ensuite.
        orderUrl: this.orderAccess.buildTrackingUrl(order),
      },
      relatedType: 'order',
      relatedId: order.id,
    });

    this.logger.log(
      `Commande ${order.number} créée (${order.totalCents} ${order.currencyCode}).`,
    );

    return {
      order: await this.orders.findOneInternal(order.id),
      // Remis au front pour construire la page de confirmation et proposer la
      // création de compte avec rattachement de la commande.
      guestAccessToken: userId ? null : this.orderAccess.issueToken(order.id),
      payment: {
        id: payment.payment.id,
        provider: payment.payment.provider,
        state: payment.payment.state,
        redirectUrl: payment.redirectUrl,
        clientSecret: payment.clientSecret,
        instructions: payment.instructions,
      },
    };
  }

  /** Montant lisible dans la langue et la devise de la commande. */
  private formatMoney(cents: number, currency: string, locale: string): string {
    return new Intl.NumberFormat(locale === 'EN' ? 'en-GB' : 'fr-FR', {
      style: 'currency',
      currency,
    }).format(cents / 100);
  }

  private async loadCart(token: string | undefined, userId?: string) {
    const cart = await this.prisma.cart.findFirst({
      where: token ? { token, status: 'ACTIVE' } : { userId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
      include: {
        items: {
          include: {
            variant: {
              include: {
                optionValues: {
                  include: { optionValue: { include: { translations: true } } },
                },
                product: {
                  include: {
                    translations: true,
                    media: {
                      take: 1,
                      orderBy: { position: 'asc' },
                      include: { media: true },
                    },
                    foodDetail: true,
                    // Requis par le moteur de promotions (ciblage catégorie,
                    // marque, collection).
                    categories: { select: { categoryId: true } },
                    collections: { select: { collectionId: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!cart) {
      throw new BadRequestException('Aucun panier actif.');
    }

    return cart;
  }

  /**
   * Une commande ne peut partir que vers un pays activé à la livraison.
   * Les denrées périssables, notamment, ne peuvent pas franchir toutes les
   * frontières (contrôles sanitaires).
   */
  private async assertCountryIsServed(countryCode: string): Promise<void> {
    const country = await this.prisma.country.findUnique({
      where: { code: countryCode },
    });

    if (!country?.isShippingActive) {
      throw new BadRequestException(
        'La livraison n’est pas encore proposée vers ce pays.',
      );
    }
  }

  private toAddressData(
    type: AddressType,
    address: AddressInputDto,
  ): Prisma.OrderAddressCreateWithoutOrderInput {
    return {
      type,
      firstName: address.firstName,
      lastName: address.lastName,
      company: address.company,
      line1: address.line1,
      line2: address.line2,
      postalCode: address.postalCode,
      city: address.city,
      region: address.region,
      country: { connect: { code: address.countryCode.toUpperCase() } },
      phone: address.phone,
      notes: address.notes,
    };
  }
}
