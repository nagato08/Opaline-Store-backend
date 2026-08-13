import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PriceResolverService } from '../../pricing/price-resolver.service';
import { InventoryService } from '../../inventory/inventory.service';
import { MediaService } from '../../media/media.service';
import type { StorefrontContext } from '../../common/decorators/storefront-context.decorator';
import type {
  AddWishlistItemDto,
  BackInStockRequestDto,
} from '../dto/engagement.dto';
import type { MediaType } from '../../generated/prisma/enums';

@Injectable()
export class WishlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prices: PriceResolverService,
    private readonly inventory: InventoryService,
    private readonly media: MediaService,
  ) {}

  async get(userId: string, context: StorefrontContext, name = 'default') {
    const wishlist = await this.prisma.wishlist.upsert({
      where: { userId_name: { userId, name } },
      update: {},
      create: { userId, name },
      include: this.itemsInclude(context),
    });

    return this.present(wishlist, context);
  }

  async addItem(
    userId: string,
    dto: AddWishlistItemDto,
    context: StorefrontContext,
  ) {
    const name = dto.wishlistName ?? 'default';

    const wishlist = await this.prisma.wishlist.upsert({
      where: { userId_name: { userId, name } },
      update: {},
      create: { userId, name },
    });

    // Postgres traite deux NULL comme distincts : un `upsert` sur une clé
    // dont `variantId` est nul créerait des doublons. On teste donc d'abord.
    const existing = await this.prisma.wishlistItem.findFirst({
      where: {
        wishlistId: wishlist.id,
        productId: dto.productId,
        variantId: dto.variantId ?? null,
      },
    });

    if (!existing) {
      await this.prisma.wishlistItem.create({
        data: {
          wishlistId: wishlist.id,
          productId: dto.productId,
          variantId: dto.variantId,
        },
      });
    }

    return this.get(userId, context, name);
  }

  async removeItem(userId: string, itemId: string, context: StorefrontContext) {
    await this.prisma.wishlistItem.deleteMany({
      where: { id: itemId, wishlist: { userId } },
    });

    return this.get(userId, context);
  }

  /** Génère un jeton de partage : la liste devient consultable sans compte. */
  async share(userId: string, name = 'default') {
    const wishlist = await this.prisma.wishlist.upsert({
      where: { userId_name: { userId, name } },
      update: { isPublic: true, token: randomBytes(16).toString('base64url') },
      create: {
        userId,
        name,
        isPublic: true,
        token: randomBytes(16).toString('base64url'),
      },
    });

    return { token: wishlist.token, isPublic: wishlist.isPublic };
  }

  async findShared(token: string, context: StorefrontContext) {
    const wishlist = await this.prisma.wishlist.findUnique({
      where: { token },
      include: this.itemsInclude(context),
    });

    if (!wishlist || !wishlist.isPublic) {
      throw new NotFoundException('Liste introuvable.');
    }

    return this.present(wishlist, context);
  }

  /**
   * Demande d'alerte de réapprovisionnement. Sans compte : l'adresse email
   * suffit, et l'unicité (variante, email) évite les doublons d'alerte.
   */
  async requestBackInStock(dto: BackInStockRequestDto, userId?: string) {
    await this.prisma.backInStockRequest.upsert({
      where: {
        variantId_email: {
          variantId: dto.variantId,
          email: dto.email.toLowerCase(),
        },
      },
      update: { notifiedAt: null, userId },
      create: {
        variantId: dto.variantId,
        email: dto.email.toLowerCase(),
        locale: dto.locale ?? 'FR',
        userId,
      },
    });

    return { status: 'REGISTERED' as const };
  }

  private itemsInclude(context: StorefrontContext) {
    return {
      items: {
        orderBy: { addedAt: 'desc' as const },
        include: {
          product: {
            include: {
              translations: { where: { locale: context.locale } },
              media: {
                take: 1,
                orderBy: { position: 'asc' as const },
                include: { media: true },
              },
              variants: {
                where: { isActive: true, deletedAt: null },
                orderBy: { position: 'asc' as const },
                take: 1,
              },
            },
          },
          variant: true,
        },
      },
    };
  }

  /**
   * Une liste d'envies n'a d'intérêt que si elle montre le prix courant et la
   * disponibilité : c'est ce qui déclenche l'achat quand un article baisse ou
   * revient en stock.
   */
  private async present(
    wishlist: {
      id: string;
      name: string;
      token: string | null;
      isPublic: boolean;
      items: {
        id: string;
        productId: string;
        variantId: string | null;
        product: {
          translations: { name: string; slug: string }[];
          media: {
            media: { path: string | null; url: string; type: MediaType };
          }[];
          variants: { id: string }[];
        };
      }[];
    },
    context: StorefrontContext,
  ) {
    const variantIds = wishlist.items
      .map((item) => item.variantId ?? item.product.variants[0]?.id)
      .filter((id): id is string => Boolean(id));

    const [priceMap, availability] = await Promise.all([
      this.prices.resolveMany(variantIds, {
        currencyCode: context.currencyCode,
        customerGroupId: context.customerGroupId,
      }),
      this.inventory.availableFor(variantIds),
    ]);

    return {
      id: wishlist.id,
      name: wishlist.name,
      isPublic: wishlist.isPublic,
      shareToken: wishlist.token,
      items: wishlist.items.map((item) => {
        const variantId = item.variantId ?? item.product.variants[0]?.id;
        const price = variantId ? priceMap.get(variantId) : undefined;
        const available = variantId ? (availability.get(variantId) ?? 0) : 0;

        return {
          id: item.id,
          productId: item.productId,
          variantId,
          name: item.product.translations[0]?.name ?? '',
          slug: item.product.translations[0]?.slug ?? '',
          imageUrl: this.media.cardUrl(item.product.media[0]?.media),
          priceCents: price?.amountCents ?? null,
          compareAtCents: price?.compareAtCents ?? null,
          currencyCode: context.currencyCode,
          isAvailable: available > 0,
        };
      }),
    };
  }
}
