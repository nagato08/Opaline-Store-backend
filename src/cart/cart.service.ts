import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CartCalculatorService,
  type CartTotals,
} from './cart-calculator.service';
import { ShippingService } from '../shipping/shipping.service';
import { SettingsService } from '../pricing/settings.service';
import { PriceResolverService } from '../pricing/price-resolver.service';
import { PromotionsService } from '../promotions/promotions.service';
import { MailService } from '../mail/mail.service';
import { MailTemplate } from '../mail/mail.types';
import { ConfigService } from '@nestjs/config';
import type { StorefrontContext } from '../common/decorators/storefront-context.decorator';
import type { Locale } from '../generated/prisma/enums';
import type {
  AddCartItemDto,
  AddressInputDto,
  SetCartContactDto,
  SetShippingMethodDto,
} from './dto/cart.dto';

const CART_TTL_DAYS = 30;

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: CartCalculatorService,
    private readonly shipping: ShippingService,
    private readonly settings: SettingsService,
    private readonly prices: PriceResolverService,
    private readonly promotions: PromotionsService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  private get cartInclude() {
    return {
      items: {
        orderBy: { addedAt: 'asc' as const },
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
                    orderBy: { position: 'asc' as const },
                    include: { media: true },
                  },
                  foodDetail: true,
                  // Nécessaires au moteur de promotions : une offre peut cibler
                  // une catégorie, une marque ou une collection.
                  categories: { select: { categoryId: true } },
                  collections: { select: { collectionId: true } },
                },
              },
            },
          },
        },
      },
    };
  }

  /** Récupère le panier courant, ou en crée un rattaché au client connecté. */
  async getOrCreate(
    token: string | undefined,
    context: StorefrontContext,
    userId?: string,
  ) {
    if (token) {
      const existing = await this.prisma.cart.findFirst({
        where: { token, status: 'ACTIVE' },
        include: this.cartInclude,
      });

      if (existing) {
        return this.syncWithContext(existing, context, userId);
      }
    }

    if (userId) {
      const userCart = await this.prisma.cart.findFirst({
        where: { userId, status: 'ACTIVE' },
        orderBy: { updatedAt: 'desc' },
        include: this.cartInclude,
      });

      if (userCart) {
        return this.syncWithContext(userCart, context);
      }
    }

    return this.prisma.cart.create({
      data: {
        token: randomBytes(24).toString('base64url'),
        userId,
        currencyCode: context.currencyCode,
        locale: context.locale,
        expiresAt: new Date(Date.now() + CART_TTL_DAYS * 86_400_000),
      },
      include: this.cartInclude,
    });
  }

  /**
   * Aligne le panier sur le contexte courant : rattachement au compte après
   * connexion, mais aussi changement de devise ou de langue.
   *
   * Sans cette remise à niveau, un visiteur qui bascule en dollars canadiens
   * conserve un panier en euros : les tarifs de livraison canadiens, libellés
   * en CAD, ne remontent alors jamais et le tunnel se bloque sans message.
   */
  private async syncWithContext(
    cart: {
      id: string;
      userId: string | null;
      currencyCode: string;
      locale: Locale;
    },
    context: StorefrontContext,
    userId?: string,
  ) {
    const data: {
      userId?: string;
      currencyCode?: string;
      locale?: Locale;
    } = {};

    if (userId && !cart.userId) {
      data.userId = userId;
    }

    if (context.currencyCode !== cart.currencyCode) {
      data.currencyCode = context.currencyCode;
    }

    if (context.locale !== cart.locale) {
      data.locale = context.locale;
    }

    if (Object.keys(data).length === 0) {
      return this.prisma.cart.findUniqueOrThrow({
        where: { id: cart.id },
        include: this.cartInclude,
      });
    }

    return this.prisma.cart.update({
      where: { id: cart.id },
      data,
      include: this.cartInclude,
    });
  }

  /**
   * Fusionne le panier invité dans celui du compte à la connexion : les
   * quantités s'additionnent, le panier invité est marqué converti.
   */
  async merge(guestToken: string, userId: string, context: StorefrontContext) {
    const guest = await this.prisma.cart.findFirst({
      where: { token: guestToken, status: 'ACTIVE' },
      include: { items: true },
    });

    const target = await this.getOrCreate(undefined, context, userId);

    if (!guest || guest.id === target.id) {
      return this.summary(target.id, context);
    }

    for (const item of guest.items) {
      const existing = await this.prisma.cartItem.findUnique({
        where: {
          cartId_variantId: { cartId: target.id, variantId: item.variantId },
        },
      });

      if (existing) {
        await this.prisma.cartItem.update({
          where: { id: existing.id },
          data: { quantity: { increment: Number(item.quantity) } },
        });
      } else {
        await this.prisma.cartItem.create({
          data: {
            cartId: target.id,
            variantId: item.variantId,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            customization: item.customization ?? Prisma.JsonNull,
          },
        });
      }
    }

    await this.prisma.cart.update({
      where: { id: guest.id },
      data: { status: 'EXPIRED' },
    });

    return this.summary(target.id, context);
  }

  async addItem(
    cartId: string,
    dto: AddCartItemDto,
    context: StorefrontContext,
  ) {
    const variant = await this.prisma.variant.findFirst({
      where: { id: dto.variantId, isActive: true, deletedAt: null },
      include: { product: { select: { status: true, deletedAt: true } } },
    });

    if (
      !variant ||
      variant.product.status !== 'ACTIVE' ||
      variant.product.deletedAt
    ) {
      throw new NotFoundException('Article indisponible.');
    }

    this.assertQuantityIsValid(dto.quantity, variant);

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId, variantId: dto.variantId } },
    });

    // Le prix est figé à l'ajout pour détecter un changement de tarif avant
    // paiement ; c'est toujours le prix recalculé qui fait foi.
    const price = await this.currentPriceCents(
      dto.variantId,
      context,
      dto.quantity,
    );

    if (existing) {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: { increment: dto.quantity }, unitPriceCents: price },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId,
          variantId: dto.variantId,
          quantity: dto.quantity,
          unitPriceCents: price,
          customization: dto.customization as Prisma.InputJsonValue,
        },
      });
    }

    return this.summary(cartId, context);
  }

  async updateItem(
    cartId: string,
    itemId: string,
    quantity: number,
    context: StorefrontContext,
  ) {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cartId },
      include: { variant: true },
    });

    if (!item) {
      throw new NotFoundException('Ligne de panier introuvable.');
    }

    if (quantity <= 0) {
      await this.prisma.cartItem.delete({ where: { id: itemId } });
      return this.summary(cartId, context);
    }

    this.assertQuantityIsValid(quantity, item.variant);

    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity },
    });

    return this.summary(cartId, context);
  }

  async removeItem(cartId: string, itemId: string, context: StorefrontContext) {
    await this.prisma.cartItem.deleteMany({ where: { id: itemId, cartId } });
    return this.summary(cartId, context);
  }

  async clear(cartId: string, context: StorefrontContext) {
    await this.prisma.cartItem.deleteMany({ where: { cartId } });
    return this.summary(cartId, context);
  }

  async setContact(
    cartId: string,
    dto: SetCartContactDto,
    context: StorefrontContext,
  ) {
    const billing = dto.billingSameAsShipping
      ? dto.shippingAddress
      : dto.billingAddress;

    await this.prisma.cart.update({
      where: { id: cartId },
      data: {
        email: dto.email,
        customerNote: dto.customerNote,
        guestShipping: dto.shippingAddress as unknown as Prisma.InputJsonValue,
        guestBilling: billing as unknown as Prisma.InputJsonValue,
      },
    });

    return this.summary(cartId, context);
  }

  async setShippingMethod(
    cartId: string,
    dto: SetShippingMethodDto,
    context: StorefrontContext,
  ) {
    const quotes = await this.shippingOptions(cartId, context);

    if (!quotes.some((quote) => quote.methodId === dto.methodId)) {
      throw new BadRequestException(
        'Mode de livraison indisponible pour ce panier.',
      );
    }

    await this.prisma.cart.update({
      where: { id: cartId },
      data: { shippingMethodId: dto.methodId, deliverySlotId: dto.slotId },
    });

    return this.summary(cartId, context);
  }

  /** Modes de livraison possibles pour l'adresse renseignée sur le panier. */
  async shippingOptions(cartId: string, context: StorefrontContext) {
    const cart = await this.prisma.cart.findUniqueOrThrow({
      where: { id: cartId },
      include: this.cartInclude,
    });

    const destination = this.destinationOf(cart);
    const totals = await this.calculator.calculate(cart, context, destination);

    return this.shipping.quote(
      destination,
      totals.lines
        .filter((line) => line.requiresShipping)
        .map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          weightGrams: line.weightGrams,
          isOversized: line.isOversized,
          requiresColdChain: line.requiresColdChain,
          lineTotalCents: line.lineTotalCents,
        })),
      cart.currencyCode,
      cart.locale,
    );
  }

  async summary(cartId: string, context: StorefrontContext) {
    const cart = await this.prisma.cart.findUniqueOrThrow({
      where: { id: cartId },
      include: this.cartInclude,
    });

    const destination = this.destinationOf(cart);
    const totals = await this.calculator.calculate(cart, context, destination);

    await this.persistTotals(cartId, totals);

    return {
      id: cart.id,
      token: cart.token,
      status: cart.status,
      email: cart.email,
      locale: cart.locale,
      customerNote: cart.customerNote,
      shippingAddress: cart.guestShipping,
      billingAddress: cart.guestBilling,
      deliverySlotId: cart.deliverySlotId,
      couponCodes: cart.couponCodes,
      ...totals,
    };
  }

  /**
   * Ajoute un code promotionnel au panier. Le code est validé immédiatement
   * pour donner un retour précis au client plutôt qu'un silence à la commande.
   */
  async applyCoupon(cartId: string, code: string, context: StorefrontContext) {
    const cart = await this.prisma.cart.findUniqueOrThrow({
      where: { id: cartId },
      include: this.cartInclude,
    });

    const normalized = code.trim().toUpperCase();

    if (cart.couponCodes.includes(normalized)) {
      throw new BadRequestException('Ce code est déjà appliqué.');
    }

    await this.promotions.validateCoupon(normalized, {
      lines: cart.items.map((item) => ({
        cartItemId: item.id,
        variantId: item.variant.id,
        productId: item.variant.product.id,
        brandId: item.variant.product.brandId,
        categoryIds: item.variant.product.categories.map(
          (link) => link.categoryId,
        ),
        collectionIds: item.variant.product.collections.map(
          (link) => link.collectionId,
        ),
        taxClassId: item.variant.product.taxClassId,
        quantity: Number(item.quantity),
        unitPriceCents: item.unitPriceCents,
        lineTotalCents: Math.round(item.unitPriceCents * Number(item.quantity)),
      })),
      subtotalCents: cart.items.reduce(
        (sum, item) =>
          sum + Math.round(item.unitPriceCents * Number(item.quantity)),
        0,
      ),
      totalQuantity: cart.items.reduce(
        (sum, item) => sum + Number(item.quantity),
        0,
      ),
      currencyCode: cart.currencyCode,
      countryCode: this.destinationOf(cart).countryCode,
      customerGroupId: context.customerGroupId,
      userId: cart.userId,
      isFirstOrder: !cart.userId,
    });

    await this.prisma.cart.update({
      where: { id: cartId },
      data: { couponCodes: { push: normalized } },
    });

    return this.summary(cartId, context);
  }

  async removeCoupon(cartId: string, code: string, context: StorefrontContext) {
    const cart = await this.prisma.cart.findUniqueOrThrow({
      where: { id: cartId },
    });
    const normalized = code.trim().toUpperCase();

    await this.prisma.cart.update({
      where: { id: cartId },
      data: {
        couponCodes: cart.couponCodes.filter((item) => item !== normalized),
      },
    });

    return this.summary(cartId, context);
  }

  /** Marque les paniers inactifs comme abandonnés (relance par email). */
  async flagAbandoned(): Promise<number> {
    const hours = await this.settings.get<number>(
      'cart.abandonedAfterHours',
      4,
    );
    const threshold = new Date(Date.now() - hours * 3600_000);

    const candidates = await this.prisma.cart.findMany({
      where: {
        status: 'ACTIVE',
        updatedAt: { lt: threshold },
        abandonedAt: null,
        items: { some: {} },
      },
      include: { items: true, user: { select: { firstName: true } } },
    });

    for (const cart of candidates) {
      await this.prisma.cart.update({
        where: { id: cart.id },
        data: { status: 'ABANDONED', abandonedAt: new Date() },
      });

      // Une seule relance, et seulement si on a une adresse : `abandonedMailSentAt`
      // évite de harceler un client qui ne reviendra pas.
      if (!cart.email || cart.abandonedMailSentAt) {
        continue;
      }

      await this.mail.enqueue({
        to: cart.email,
        template: MailTemplate.AbandonedCart,
        locale: cart.locale,
        variables: {
          firstName: cart.user?.firstName,
          itemCount: cart.items.length,
          total: new Intl.NumberFormat(
            cart.locale === 'EN' ? 'en-GB' : 'fr-FR',
            {
              style: 'currency',
              currency: cart.currencyCode,
            },
          ).format(cart.totalCents / 100),
          cartUrl: `${this.config.getOrThrow<string>('storefrontUrl')}/panier?token=${cart.token}`,
        },
        relatedType: 'cart',
        relatedId: cart.id,
      });

      await this.prisma.cart.update({
        where: { id: cart.id },
        data: { abandonedMailSentAt: new Date() },
      });
    }

    return candidates.length;
  }

  destinationOf(cart: { guestShipping: unknown; guestBilling: unknown }): {
    countryCode: string;
    region?: string | null;
  } {
    const shipping = cart.guestShipping as AddressInputDto | null;
    const billing = cart.guestBilling as AddressInputDto | null;
    const address = shipping ?? billing;

    return address
      ? {
          countryCode: address.countryCode.toUpperCase(),
          region: address.region ?? null,
        }
      : { countryCode: 'FR', region: null };
  }

  private async persistTotals(
    cartId: string,
    totals: CartTotals,
  ): Promise<void> {
    await this.prisma.cart.update({
      where: { id: cartId },
      data: {
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        shippingCents: totals.shippingCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
      },
    });
  }

  private async currentPriceCents(
    variantId: string,
    context: StorefrontContext,
    quantity: number,
  ): Promise<number> {
    const resolved = await this.prices.resolve(variantId, {
      currencyCode: context.currencyCode,
      customerGroupId: context.customerGroupId,
      quantity,
    });

    if (!resolved) {
      throw new BadRequestException(
        `Aucun tarif disponible en ${context.currencyCode} pour cet article.`,
      );
    }

    return resolved.amountCents;
  }

  /**
   * Vérifie le pas de vente : un article vendu au poids impose un multiple
   * (0,5 kg), un article à l'unité impose un entier.
   */
  private assertQuantityIsValid(
    quantity: number,
    variant: {
      isSoldByMeasure: boolean;
      stepQuantity: unknown;
      minQuantity: unknown;
      sku: string;
    },
  ): void {
    const step = Number(variant.stepQuantity) || 1;
    const min = Number(variant.minQuantity) || step;

    if (!variant.isSoldByMeasure && !Number.isInteger(quantity)) {
      throw new BadRequestException(
        `La quantité doit être entière pour ${variant.sku}.`,
      );
    }

    if (quantity < min) {
      throw new BadRequestException(
        `Quantité minimale pour ${variant.sku} : ${min}.`,
      );
    }

    const ratio = quantity / step;

    if (Math.abs(ratio - Math.round(ratio)) > 1e-6) {
      throw new BadRequestException(
        `La quantité doit être un multiple de ${step}.`,
      );
    }
  }
}
