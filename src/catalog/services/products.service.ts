import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaService } from '../../media/media.service';
import { PriceResolverService } from '../../pricing/price-resolver.service';
import { TaxService } from '../../pricing/tax.service';
import { SettingsService } from '../../pricing/settings.service';
import { uniqueSlug } from '../../common/utils/slug';
import { paginate, type Paginated } from '../../common/dto/pagination.dto';
import type { StorefrontContext } from '../../common/decorators/storefront-context.decorator';
import { Prisma } from '../../generated/prisma/client';
import type { Locale } from '../../generated/prisma/enums';
import {
  ProductSort,
  type AdminProductQueryDto,
  type CreateProductDto,
  type CreateVariantDto,
  type ProductQueryDto,
  type UpdateProductDto,
} from '../dto/product.dto';

export type ProductCard = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  brand: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  compareAtCents: number | null;
  currencyCode: string;
  ecoTaxCents: number;
  ratingAvg: number;
  ratingCount: number;
  isAvailable: boolean;
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prices: PriceResolverService,
    private readonly tax: TaxService,
    private readonly settings: SettingsService,
    private readonly media: MediaService,
  ) {}

  // --- Administration -------------------------------------------------------

  /**
   * Création complète en une transaction : traductions, options, variantes,
   * tarifs, catégories, médias et fiche alimentaire. Un produit partiellement
   * créé serait invendable, donc tout passe ou rien ne passe.
   */
  async create(dto: CreateProductDto) {
    this.assertVariantsAreConsistent(dto.variants);

    const translations = await Promise.all(
      dto.translations.map(async (translation) => ({
        locale: translation.locale,
        name: translation.name,
        slug: await uniqueSlug(
          translation.slug ?? translation.name,
          (candidate) => this.isSlugTaken(translation.locale, candidate),
        ),
        shortDescription: translation.shortDescription,
        description: translation.description,
        seoTitle: translation.seoTitle,
        seoDescription: translation.seoDescription,
      })),
    );

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          type: dto.type ?? 'PHYSICAL',
          status: dto.status ?? 'DRAFT',
          brandId: dto.brandId,
          taxClassId: dto.taxClassId ?? (await this.defaultTaxClassId(tx)),
          requiresShipping:
            dto.requiresShipping ?? (dto.type ?? 'PHYSICAL') === 'PHYSICAL',
          isPerishable: dto.isPerishable ?? false,
          requiresSerial: dto.requiresSerial ?? false,
          hsCode: dto.hsCode,
          countryOfOrigin: dto.countryOfOrigin,
          ecoTaxCents: dto.ecoTaxCents ?? 0,
          warrantyMonths: dto.warrantyMonths,
          energyLabel: dto.energyLabel,
          dangerousGoods: dto.dangerousGoods,
          isFeatured: dto.isFeatured ?? false,
          publishedAt: dto.status === 'ACTIVE' ? new Date() : null,
          translations: { create: translations },
          categories: dto.categoryIds?.length
            ? {
                create: dto.categoryIds.map((categoryId, index) => ({
                  categoryId,
                  position: index,
                  isPrimary: index === 0,
                })),
              }
            : undefined,
          options: dto.optionTypeIds?.length
            ? {
                create: dto.optionTypeIds.map((optionTypeId, index) => ({
                  optionTypeId,
                  position: index,
                })),
              }
            : undefined,
          media: dto.mediaIds?.length
            ? {
                create: dto.mediaIds.map((mediaId, index) => ({
                  mediaId,
                  position: index,
                })),
              }
            : undefined,
        },
      });

      for (const [index, variant] of dto.variants.entries()) {
        await tx.variant.create({
          data: {
            productId: product.id,
            sku: variant.sku,
            barcode: variant.barcode,
            position: variant.position ?? index,
            isDefault: variant.isDefault ?? index === 0,
            isActive: variant.isActive ?? true,
            weightGrams: variant.weightGrams,
            lengthMm: variant.lengthMm,
            widthMm: variant.widthMm,
            heightMm: variant.heightMm,
            isOversized: variant.isOversized ?? false,
            isSoldByMeasure: variant.isSoldByMeasure ?? false,
            measureUnit: variant.measureUnit,
            stepQuantity: variant.stepQuantity ?? 1,
            minQuantity: variant.minQuantity ?? 1,
            netContent: variant.netContent,
            netContentUnit: variant.netContentUnit,
            optionValues: variant.optionValueIds?.length
              ? {
                  create: variant.optionValueIds.map((optionValueId) => ({
                    optionValueId,
                  })),
                }
              : undefined,
            prices: {
              create: variant.prices.map((price) => ({
                currencyCode: price.currencyCode.toUpperCase(),
                amountCents: price.amountCents,
                compareAtCents: price.compareAtCents,
                costCents: price.costCents,
                customerGroupId: price.customerGroupId,
                minQuantity: price.minQuantity ?? 1,
              })),
            },
          },
        });
      }

      if (dto.foodDetail) {
        const { translations: foodTranslations, ...foodDetail } =
          dto.foodDetail;

        await tx.foodDetail.create({
          data: {
            productId: product.id,
            allergens: foodDetail.allergens ?? [],
            nutrition: foodDetail.nutrition as Prisma.InputJsonValue,
            storageTempMin: foodDetail.storageTempMin,
            storageTempMax: foodDetail.storageTempMax,
            requiresColdChain: foodDetail.requiresColdChain ?? false,
            shelfLifeDays: foodDetail.shelfLifeDays,
            originCountry: foodDetail.originCountry,
            alcoholDegree: foodDetail.alcoholDegree,
            translations: foodTranslations?.length
              ? { create: foodTranslations }
              : undefined,
          },
        });
      }

      return tx.product.findUniqueOrThrow({
        where: { id: product.id },
        include: this.adminInclude(),
      });
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.prisma.product.update({
      where: { id },
      data: {
        status: dto.status,
        brandId: dto.brandId,
        taxClassId: dto.taxClassId,
        isFeatured: dto.isFeatured,
        requiresShipping: dto.requiresShipping,
        ecoTaxCents: dto.ecoTaxCents,
        // La date de publication est posée au premier passage en ACTIVE et
        // jamais réécrite ensuite : elle sert de date de mise en ligne.
        publishedAt: dto.status === 'ACTIVE' ? new Date() : undefined,
      },
    });

    if (dto.categoryIds) {
      await this.prisma.productCategory.deleteMany({
        where: { productId: id },
      });
      await this.prisma.productCategory.createMany({
        data: dto.categoryIds.map((categoryId, index) => ({
          productId: id,
          categoryId,
          position: index,
          isPrimary: index === 0,
        })),
      });
    }

    if (dto.mediaIds) {
      await this.prisma.productMedia.deleteMany({ where: { productId: id } });
      await this.prisma.productMedia.createMany({
        data: dto.mediaIds.map((mediaId, index) => ({
          productId: id,
          mediaId,
          position: index,
        })),
      });
    }

    for (const translation of dto.translations ?? []) {
      const slug = await uniqueSlug(
        translation.slug ?? translation.name,
        (candidate) => this.isSlugTaken(translation.locale, candidate, id),
      );

      await this.prisma.productTranslation.upsert({
        where: {
          productId_locale: { productId: id, locale: translation.locale },
        },
        update: {
          name: translation.name,
          slug,
          shortDescription: translation.shortDescription,
          description: translation.description,
          seoTitle: translation.seoTitle,
          seoDescription: translation.seoDescription,
        },
        create: {
          productId: id,
          locale: translation.locale,
          name: translation.name,
          slug,
          shortDescription: translation.shortDescription,
          description: translation.description,
          seoTitle: translation.seoTitle,
          seoDescription: translation.seoDescription,
        },
      });
    }

    return this.prisma.product.findUniqueOrThrow({
      where: { id },
      include: this.adminInclude(),
    });
  }

  async findOneAdmin(id: string) {
    return this.prisma.product.findUniqueOrThrow({
      where: { id },
      include: this.adminInclude(),
    });
  }

  async listAdmin(query: AdminProductQueryDto) {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      status: query.status,
      type: query.type,
      brandId: query.brandId,
      categories: query.categoryId
        ? { some: { categoryId: query.categoryId } }
        : undefined,
      translations: query.search
        ? { some: { name: { contains: query.search, mode: 'insensitive' } } }
        : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: query.skip,
        take: query.perPage,
        include: {
          translations: true,
          brand: { select: { id: true, name: true } },
          media: {
            take: 1,
            orderBy: { position: 'asc' },
            include: { media: true },
          },
          variants: {
            select: {
              id: true,
              sku: true,
              isActive: true,
              prices: true,
              inventoryItems: { select: { onHand: true, reserved: true } },
            },
          },
          _count: { select: { variants: true, reviews: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return paginate(items, total, query);
  }

  /** Suppression logique : les commandes passées gardent leur référence. */
  async archive(id: string): Promise<void> {
    await this.prisma.product.update({
      where: { id },
      data: { status: 'ARCHIVED', deletedAt: new Date() },
    });
  }

  // --- Boutique -------------------------------------------------------------

  async listStorefront(
    query: ProductQueryDto,
    context: StorefrontContext,
  ): Promise<Paginated<ProductCard>> {
    const where = await this.buildStorefrontWhere(query, context.locale);

    const orderBy = this.buildOrderBy(query.sort);
    const usesPriceSort =
      query.sort === ProductSort.PRICE_ASC ||
      query.sort === ProductSort.PRICE_DESC;

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        // Le tri par prix se fait après résolution tarifaire (groupe client,
        // devise, promotions) : on prend une fenêtre plus large puis on trie.
        skip: usesPriceSort ? 0 : query.skip,
        take: usesPriceSort
          ? Math.min(query.skip + query.perPage * 3, 300)
          : query.perPage,
        include: this.storefrontListInclude(context.locale),
      }),
      this.prisma.product.count({ where }),
    ]);

    const cards = await this.toCards(products, context, query);

    if (usesPriceSort) {
      cards.sort((a, b) => {
        const left = a.priceCents ?? Number.MAX_SAFE_INTEGER;
        const right = b.priceCents ?? Number.MAX_SAFE_INTEGER;
        return query.sort === ProductSort.PRICE_ASC
          ? left - right
          : right - left;
      });

      return paginate(
        cards.slice(query.skip, query.skip + query.perPage),
        total,
        query,
      );
    }

    return paginate(cards, total, query);
  }

  async findBySlug(slug: string, context: StorefrontContext) {
    const translation = await this.prisma.productTranslation.findUnique({
      where: { locale_slug: { locale: context.locale, slug } },
      select: { productId: true },
    });

    if (!translation) {
      throw new NotFoundException('Produit introuvable.');
    }

    return this.findOneStorefront(translation.productId, context);
  }

  async findOneStorefront(productId: string, context: StorefrontContext) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: 'ACTIVE', deletedAt: null },
      include: {
        translations: { where: { locale: context.locale } },
        brand: {
          include: { translations: { where: { locale: context.locale } } },
        },
        media: {
          orderBy: { position: 'asc' },
          include: {
            media: {
              include: { translations: { where: { locale: context.locale } } },
            },
          },
        },
        categories: {
          include: {
            category: {
              include: { translations: { where: { locale: context.locale } } },
            },
          },
        },
        attributes: {
          include: {
            attribute: {
              include: { translations: { where: { locale: context.locale } } },
            },
          },
        },
        foodDetail: {
          include: { translations: { where: { locale: context.locale } } },
        },
        options: {
          orderBy: { position: 'asc' },
          include: {
            optionType: {
              include: {
                translations: { where: { locale: context.locale } },
                values: {
                  orderBy: { position: 'asc' },
                  include: {
                    translations: { where: { locale: context.locale } },
                  },
                },
              },
            },
          },
        },
        variants: {
          where: { isActive: true, deletedAt: null },
          orderBy: { position: 'asc' },
          include: {
            optionValues: { include: { optionValue: true } },
            inventoryItems: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Produit introuvable.');
    }

    const [priceMap, pricesIncludeTax, taxRates] = await Promise.all([
      this.prices.resolveMany(
        product.variants.map((variant) => variant.id),
        {
          currencyCode: context.currencyCode,
          customerGroupId: context.customerGroupId,
        },
      ),
      this.settings.pricesIncludeTax(),
      this.tax.ratesFor(context.countryCode, product.taxClassId),
    ]);

    const translation = product.translations[0];

    return {
      id: product.id,
      type: product.type,
      name: translation?.name ?? '',
      slug: translation?.slug ?? '',
      shortDescription: translation?.shortDescription ?? null,
      description: translation?.description ?? null,
      seo: {
        title: translation?.seoTitle ?? translation?.name ?? '',
        description:
          translation?.seoDescription ?? translation?.shortDescription ?? '',
      },
      brand: product.brand
        ? {
            id: product.brand.id,
            name: product.brand.translations[0]?.name ?? product.brand.name,
            slug: product.brand.slug,
          }
        : null,
      categories: product.categories.map((link) => ({
        id: link.categoryId,
        name: link.category.translations[0]?.name ?? '',
        slug: link.category.translations[0]?.slug ?? '',
        isPrimary: link.isPrimary,
      })),
      media: product.media.map((item) => ({
        id: item.mediaId,
        url: item.media.url,
        // Déclinaisons prêtes pour un `srcset` : c'est ce qui évite d'envoyer
        // la photo d'origine à un mobile.
        variants: this.media.buildVariants(item.media),
        alt: item.media.translations[0]?.alt ?? translation?.name ?? '',
        variantId: item.variantId,
      })),
      options: product.options.map((option) => ({
        id: option.optionTypeId,
        code: option.optionType.code,
        name: option.optionType.translations[0]?.name ?? option.optionType.code,
        displayAs: option.optionType.displayAs,
        values: option.optionType.values.map((value) => ({
          id: value.id,
          code: value.code,
          label: value.translations[0]?.label ?? value.code,
          hexColor: value.hexColor,
        })),
      })),
      attributes: product.attributes.map((attribute) => ({
        code: attribute.attribute.code,
        name:
          attribute.attribute.translations[0]?.name ?? attribute.attribute.code,
        unit: attribute.attribute.unit,
        value:
          attribute.valueText ??
          attribute.valueNumber?.toString() ??
          attribute.valueBoolean?.toString() ??
          attribute.valueDate?.toISOString() ??
          null,
      })),
      compliance: {
        // Mentions obligatoires : garantie légale, éco-participation (DEEE),
        // origine, et pour l'alimentaire allergènes et conservation.
        warrantyMonths: product.warrantyMonths,
        ecoTaxCents: product.ecoTaxCents,
        countryOfOrigin: product.countryOfOrigin,
        energyLabel: product.energyLabel,
        food: product.foodDetail
          ? {
              allergens: product.foodDetail.allergens,
              nutrition: product.foodDetail.nutrition,
              requiresColdChain: product.foodDetail.requiresColdChain,
              storageTempMin: product.foodDetail.storageTempMin,
              storageTempMax: product.foodDetail.storageTempMax,
              originCountry: product.foodDetail.originCountry,
              alcoholDegree: product.foodDetail.alcoholDegree,
              ingredients:
                product.foodDetail.translations[0]?.ingredients ?? null,
              storageAdvice:
                product.foodDetail.translations[0]?.storageAdvice ?? null,
              usageAdvice:
                product.foodDetail.translations[0]?.usageAdvice ?? null,
              legalNotice:
                product.foodDetail.translations[0]?.legalNotice ?? null,
            }
          : null,
      },
      rating: {
        average: Number(product.ratingAvg),
        count: product.ratingCount,
      },
      variants: product.variants.map((variant) => {
        const price = priceMap.get(variant.id);
        const available = this.availableQuantity(variant.inventoryItems);
        const taxed = price
          ? this.tax.apply(price.amountCents, taxRates, pricesIncludeTax)
          : null;

        return {
          id: variant.id,
          sku: variant.sku,
          optionValueIds: variant.optionValues.map(
            (link) => link.optionValueId,
          ),
          price: price
            ? {
                currencyCode: price.currencyCode,
                amountCents: price.amountCents,
                compareAtCents: price.compareAtCents,
                netCents: taxed?.netCents ?? price.amountCents,
                taxCents: taxed?.taxCents ?? 0,
                isConverted: price.isConverted,
              }
            : null,
          measure: variant.isSoldByMeasure
            ? {
                unit: variant.measureUnit,
                step: Number(variant.stepQuantity),
                min: Number(variant.minQuantity),
                netContent: variant.netContent
                  ? Number(variant.netContent)
                  : null,
                netContentUnit: variant.netContentUnit,
                // Prix à l'unité de mesure, obligatoire en UE sur les
                // denrées préemballées (« 4,50 € / kg »).
                unitPriceCents:
                  price && variant.netContent && Number(variant.netContent) > 0
                    ? Math.round(price.amountCents / Number(variant.netContent))
                    : null,
              }
            : null,
          shipping: {
            weightGrams: variant.weightGrams,
            isOversized: variant.isOversized,
          },
          stock: { available, isAvailable: available > 0 },
        };
      }),
    };
  }

  // --- Interne --------------------------------------------------------------

  private async buildStorefrontWhere(
    query: ProductQueryDto,
    locale: Locale,
  ): Promise<Prisma.ProductWhereInput> {
    const where: Prisma.ProductWhereInput = {
      status: 'ACTIVE',
      deletedAt: null,
      publishedAt: { lte: new Date() },
    };

    if (query.search) {
      where.translations = {
        some: {
          locale,
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            {
              shortDescription: { contains: query.search, mode: 'insensitive' },
            },
          ],
        },
      };
    }

    if (query.categorySlug) {
      const category = await this.prisma.categoryTranslation.findUnique({
        where: { locale_slug: { locale, slug: query.categorySlug } },
        include: { category: { select: { path: true } } },
      });

      if (!category) {
        throw new NotFoundException('Catégorie introuvable.');
      }

      // Une catégorie inclut toujours ses sous-catégories : demander
      // « Meubles » doit remonter les canapés.
      where.categories = {
        some: { category: { path: { startsWith: category.category.path } } },
      };
    }

    if (query.collectionSlug) {
      where.collections = {
        some: {
          collection: {
            translations: { some: { locale, slug: query.collectionSlug } },
          },
        },
      };
    }

    if (query.brandIds?.length) {
      where.brandId = { in: query.brandIds };
    }

    if (
      query.minPriceCents !== undefined ||
      query.maxPriceCents !== undefined
    ) {
      where.variants = {
        some: {
          prices: {
            some: {
              amountCents: {
                gte: query.minPriceCents,
                lte: query.maxPriceCents,
              },
            },
          },
        },
      };
    }

    if (query.inStockOnly) {
      where.variants = {
        ...(where.variants as object),
        some: {
          ...(where.variants?.some ?? {}),
          inventoryItems: { some: { onHand: { gt: 0 } } },
        },
      };
    }

    return where;
  }

  private buildOrderBy(
    sort?: ProductSort,
  ): Prisma.ProductOrderByWithRelationInput {
    switch (sort) {
      case ProductSort.BEST_SELLING:
        return { soldCount: 'desc' };
      case ProductSort.RATING:
        return { ratingAvg: 'desc' };
      case ProductSort.NAME_ASC:
      case ProductSort.PRICE_ASC:
      case ProductSort.PRICE_DESC:
      case ProductSort.NEWEST:
      default:
        return { publishedAt: 'desc' };
    }
  }

  private storefrontListInclude(locale: Locale) {
    return {
      translations: { where: { locale } },
      brand: { select: { name: true } },
      media: {
        take: 1,
        orderBy: { position: 'asc' as const },
        include: { media: true },
      },
      variants: {
        where: { isActive: true, deletedAt: null },
        orderBy: { position: 'asc' as const },
        select: {
          id: true,
          inventoryItems: { select: { onHand: true, reserved: true } },
        },
      },
    };
  }

  private async toCards(
    products: Awaited<ReturnType<ProductsService['fetchForCards']>>,
    context: StorefrontContext,
    query: ProductQueryDto,
  ): Promise<ProductCard[]> {
    const variantIds = products.flatMap((product) =>
      product.variants.map((v) => v.id),
    );

    const priceMap = await this.prices.resolveMany(variantIds, {
      currencyCode: context.currencyCode,
      customerGroupId: context.customerGroupId,
    });

    const cards = products.map((product) => {
      const prices = product.variants
        .map((variant) => priceMap.get(variant.id))
        .filter((price): price is NonNullable<typeof price> => Boolean(price));

      const cheapest = prices.reduce<(typeof prices)[number] | null>(
        (best, price) =>
          !best || price.amountCents < best.amountCents ? price : best,
        null,
      );

      const available = product.variants.some(
        (variant) => this.availableQuantity(variant.inventoryItems) > 0,
      );

      return {
        id: product.id,
        name: product.translations[0]?.name ?? '',
        slug: product.translations[0]?.slug ?? '',
        shortDescription: product.translations[0]?.shortDescription ?? null,
        brand: product.brand?.name ?? null,
        imageUrl: this.media.cardUrl(product.media[0]?.media),
        priceCents: cheapest?.amountCents ?? null,
        compareAtCents: cheapest?.compareAtCents ?? null,
        currencyCode: context.currencyCode,
        ecoTaxCents: product.ecoTaxCents,
        ratingAvg: Number(product.ratingAvg),
        ratingCount: product.ratingCount,
        isAvailable: available,
      };
    });

    if (query.sort === ProductSort.NAME_ASC) {
      cards.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    }

    return cards;
  }

  /** Signature technique servant uniquement à typer `toCards`. */
  private fetchForCards(locale: Locale) {
    return this.prisma.product.findMany({
      include: this.storefrontListInclude(locale),
    });
  }

  private availableQuantity(
    items: { onHand: unknown; reserved: unknown }[],
  ): number {
    return items.reduce(
      (total, item) => total + (Number(item.onHand) - Number(item.reserved)),
      0,
    );
  }

  private adminInclude() {
    return {
      translations: true,
      brand: true,
      taxClass: true,
      categories: {
        include: { category: { include: { translations: true } } },
      },
      media: {
        orderBy: { position: 'asc' as const },
        include: { media: true },
      },
      options: {
        include: {
          optionType: { include: { translations: true, values: true } },
        },
      },
      attributes: {
        include: { attribute: { include: { translations: true } } },
      },
      foodDetail: { include: { translations: true } },
      variants: {
        orderBy: { position: 'asc' as const },
        include: {
          prices: true,
          optionValues: {
            include: { optionValue: { include: { translations: true } } },
          },
          inventoryItems: {
            include: { location: { select: { code: true, name: true } } },
          },
        },
      },
    };
  }

  private async defaultTaxClassId(
    tx: Prisma.TransactionClient,
  ): Promise<string | undefined> {
    const taxClass = await tx.taxClass.findFirst({
      where: { isDefault: true },
    });
    return taxClass?.id;
  }

  private assertVariantsAreConsistent(variants: CreateVariantDto[]): void {
    if (variants.length === 0) {
      throw new BadRequestException(
        'Un produit doit avoir au moins une variante.',
      );
    }

    const skus = new Set<string>();

    for (const variant of variants) {
      if (skus.has(variant.sku)) {
        throw new BadRequestException(
          `SKU en double dans la requête : ${variant.sku}.`,
        );
      }
      skus.add(variant.sku);

      if (variant.prices.length === 0) {
        throw new BadRequestException(
          `La variante ${variant.sku} n'a aucun prix.`,
        );
      }
    }
  }

  private async isSlugTaken(
    locale: Locale,
    slug: string,
    exceptProductId?: string,
  ): Promise<boolean> {
    const existing = await this.prisma.productTranslation.findUnique({
      where: { locale_slug: { locale, slug } },
      select: { productId: true },
    });

    return Boolean(existing) && existing?.productId !== exceptProductId;
  }
}
