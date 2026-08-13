import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PriceResolverService } from '../pricing/price-resolver.service';
import { MediaService } from '../media/media.service';
import { paginate, type Paginated } from '../common/dto/pagination.dto';
import type { StorefrontContext } from '../common/decorators/storefront-context.decorator';
import type { Locale } from '../generated/prisma/enums';
import type { SearchQueryDto } from './dto/search.dto';

export type SearchHit = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  brand: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  compareAtCents: number | null;
  currencyCode: string;
  ratingAvg: number;
  ratingCount: number;
  isAvailable: boolean;
  isPinned: boolean;
  /** Score de pertinence, exposé pour le débogage du merchandising. */
  score: number;
};

export type FacetBucket = {
  value: string;
  label: string;
  count: number;
};

export type SearchFacets = {
  categories: FacetBucket[];
  brands: FacetBucket[];
  attributes: { code: string; label: string; values: FacetBucket[] }[];
  priceRange: { minCents: number; maxCents: number } | null;
  availability: { inStock: number; outOfStock: number };
};

/**
 * Seuil de similarité trigramme.
 *
 * `word_similarity` compare la saisie au mot le plus proche du libellé, au
 * lieu de la chaîne entière : sur « Canapé d'angle Oslo », une recherche
 * « canpé » obtient 0,50 en similarité de mot contre 0,18 en similarité
 * globale. Sans cette distinction, aucun seuil utilisable n'existe — trop bas
 * il ramène tout le catalogue, trop haut il ne corrige plus rien.
 */
const FUZZY_THRESHOLD = 0.4;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prices: PriceResolverService,
    private readonly media: MediaService,
  ) {}

  /**
   * Recherche produit.
   *
   * Deux passes complémentaires : le plein texte pondéré (nom > résumé >
   * description) répond aux requêtes correctement orthographiées, la
   * similarité trigramme rattrape les fautes de frappe. Sans la seconde,
   * « canpé » ne renvoie rien alors que l'intention est évidente.
   */
  async search(
    query: SearchQueryDto,
    context: StorefrontContext,
    /**
     * Identifiant issu du jeton, jamais du DTO : une propriété non décorée
     * dans un DTO est rejetée par `forbidNonWhitelisted`, et laisser le client
     * fournir cet identifiant fausserait les statistiques.
     */
    userId?: string,
  ): Promise<
    Paginated<SearchHit> & {
      facets: SearchFacets;
      correctedTerm: string | null;
    }
  > {
    const term = (query.q ?? '').trim();
    const expanded = await this.expandWithSynonyms(term, context.locale);

    const { ids, scores, total, correctedTerm } = term
      ? await this.matchIds(expanded, term, context.locale, query)
      : await this.browseIds(context.locale, query);

    const pinnedIds = term
      ? await this.pinnedProductIds(term, context.locale)
      : [];
    const orderedIds = [...new Set([...pinnedIds, ...ids])];

    const [hits, facets] = await Promise.all([
      this.hydrate(orderedIds, scores, pinnedIds, context),
      this.buildFacets(context.locale, query),
    ]);

    if (term) {
      await this.logQuery(term, context.locale, total, userId);
    }

    return {
      ...paginate(hits, total + pinnedIds.length, query),
      facets,
      correctedTerm,
    };
  }

  /** Suggestions d'autocomplétion, mêlant produits, catégories et marques. */
  async suggest(term: string, locale: Locale, limit = 8) {
    const normalized = term.trim();

    if (normalized.length < 2) {
      return { products: [], categories: [], brands: [], popular: [] };
    }

    const [products, categories, brands, popular] = await Promise.all([
      this.prisma.$queryRaw<
        { name: string; slug: string; similarity: number }[]
      >`
        SELECT t."name", t."slug",
               word_similarity(unaccent(${normalized}), unaccent(t."name")) AS similarity
        FROM "ProductTranslation" t
        JOIN "Product" p ON p."id" = t."productId"
        WHERE t."locale" = ${locale}::"Locale"
          AND p."status" = 'ACTIVE' AND p."deletedAt" IS NULL
          AND (t."name" ILIKE ${`%${normalized}%`}
               OR word_similarity(unaccent(${normalized}), unaccent(t."name")) > ${FUZZY_THRESHOLD})
        ORDER BY similarity DESC, t."name" ASC
        LIMIT ${limit}
      `,
      this.prisma.categoryTranslation.findMany({
        where: {
          locale,
          name: { contains: normalized, mode: 'insensitive' },
          category: { isActive: true },
        },
        select: { name: true, slug: true },
        take: 5,
      }),
      this.prisma.brand.findMany({
        where: {
          isActive: true,
          name: { contains: normalized, mode: 'insensitive' },
        },
        select: { name: true, slug: true },
        take: 5,
      }),
      // Recherches populaires ayant donné des résultats : elles guident le
      // visiteur vers ce que la boutique sait effectivement vendre.
      this.prisma.searchQuery.groupBy({
        by: ['term'],
        where: {
          locale,
          normalized: { startsWith: this.normalize(normalized) },
          resultCount: { gt: 0 },
        },
        _count: true,
        orderBy: { _count: { term: 'desc' } },
        take: 5,
      }),
    ]);

    return {
      products: products.map((item) => ({ name: item.name, slug: item.slug })),
      categories,
      brands,
      popular: popular.map((entry) => entry.term),
    };
  }

  /** Requêtes sans résultat : chaque ligne est une vente potentiellement perdue. */
  async zeroResultQueries(days = 30, limit = 50) {
    const since = new Date(Date.now() - days * 86_400_000);

    return this.prisma.searchQuery.groupBy({
      by: ['term', 'locale'],
      where: { resultCount: 0, createdAt: { gte: since } },
      _count: true,
      orderBy: { _count: { term: 'desc' } },
      take: limit,
    });
  }

  async topQueries(days = 30, limit = 50) {
    const since = new Date(Date.now() - days * 86_400_000);

    return this.prisma.searchQuery.groupBy({
      by: ['term', 'locale'],
      where: { createdAt: { gte: since } },
      _count: true,
      orderBy: { _count: { term: 'desc' } },
      take: limit,
    });
  }

  // --- Interne --------------------------------------------------------------

  /**
   * Recherche plein texte, avec repli trigramme si aucun résultat.
   * `websearch_to_tsquery` accepte la syntaxe naturelle (guillemets, `-mot`)
   * sans jamais lever d'erreur de syntaxe sur une saisie utilisateur.
   */
  private async matchIds(
    expandedTerm: string,
    originalTerm: string,
    locale: Locale,
    query: SearchQueryDto,
  ) {
    // $1 terme, $2 langue, $3 limite, $4 décalage.
    const filters = this.buildSqlFilters(query, 5);

    const rows = await this.prisma.$queryRawUnsafe<
      { productId: string; score: number; total: bigint }[]
    >(
      `
      SELECT t."productId",
             ts_rank(t."searchVector", websearch_to_tsquery('fr_unaccent', $1)) AS score,
             COUNT(*) OVER () AS total
      FROM "ProductTranslation" t
      JOIN "Product" p ON p."id" = t."productId"
      WHERE t."locale" = $2::"Locale"
        AND p."status" = 'ACTIVE' AND p."deletedAt" IS NULL
        AND t."searchVector" @@ websearch_to_tsquery('fr_unaccent', $1)
        ${filters.sql}
      ORDER BY score DESC, p."soldCount" DESC
      LIMIT $3 OFFSET $4
      `,
      expandedTerm,
      locale,
      query.perPage,
      query.skip,
      ...filters.params,
    );

    if (rows.length > 0) {
      return {
        ids: rows.map((row) => row.productId),
        scores: new Map(rows.map((row) => [row.productId, Number(row.score)])),
        total: Number(rows[0].total),
        correctedTerm: null,
      };
    }

    // Repli tolérant aux fautes.
    const fuzzy = await this.prisma.$queryRawUnsafe<
      { productId: string; name: string; score: number; total: bigint }[]
    >(
      `
      SELECT t."productId", t."name",
             word_similarity(unaccent($1), unaccent(t."name")) AS score,
             COUNT(*) OVER () AS total
      FROM "ProductTranslation" t
      JOIN "Product" p ON p."id" = t."productId"
      WHERE t."locale" = $2::"Locale"
        AND p."status" = 'ACTIVE' AND p."deletedAt" IS NULL
        AND word_similarity(unaccent($1), unaccent(t."name")) > ${FUZZY_THRESHOLD}
        ${filters.sql}
      ORDER BY score DESC
      LIMIT $3 OFFSET $4
      `,
      originalTerm,
      locale,
      query.perPage,
      query.skip,
      ...filters.params,
    );

    return {
      ids: fuzzy.map((row) => row.productId),
      scores: new Map(fuzzy.map((row) => [row.productId, Number(row.score)])),
      total: fuzzy.length > 0 ? Number(fuzzy[0].total) : 0,
      // Proposer « vouliez-vous dire… » avec le meilleur candidat trouvé.
      correctedTerm: fuzzy[0]?.name ?? null,
    };
  }

  /** Navigation sans terme : filtres et facettes seuls. */
  private async browseIds(locale: Locale, query: SearchQueryDto) {
    // $1 langue, $2 limite, $3 décalage : un emplacement de moins qu'en
    // recherche, puisqu'il n'y a pas de terme.
    const filters = this.buildSqlFilters(query, 4);

    const rows = await this.prisma.$queryRawUnsafe<
      { productId: string; total: bigint }[]
    >(
      `
      SELECT t."productId", COUNT(*) OVER () AS total
      FROM "ProductTranslation" t
      JOIN "Product" p ON p."id" = t."productId"
      WHERE t."locale" = $1::"Locale"
        AND p."status" = 'ACTIVE' AND p."deletedAt" IS NULL
        ${filters.sql}
      ORDER BY p."soldCount" DESC, p."publishedAt" DESC
      LIMIT $2 OFFSET $3
      `,
      locale,
      query.perPage,
      query.skip,
      ...filters.params,
    );

    return {
      ids: rows.map((row) => row.productId),
      scores: new Map<string, number>(),
      total: rows.length > 0 ? Number(rows[0].total) : 0,
      correctedTerm: null,
    };
  }

  /**
   * Fragments SQL des filtres à facettes. Les valeurs passent en paramètres
   * numérotés : jamais d'interpolation directe, sinon injection SQL.
   */
  private buildSqlFilters(query: SearchQueryDto, firstIndex: number) {
    const params: unknown[] = [];
    const clauses: string[] = [];
    // Les emplacements précédents sont déjà pris par la requête appelante
    // (terme, langue, limite, décalage) : le décalage varie selon le mode,
    // d'où le paramètre plutôt qu'une constante.
    let index = firstIndex;

    if (query.categoryIds?.length) {
      clauses.push(`AND EXISTS (
        SELECT 1 FROM "ProductCategory" pc
        JOIN "Category" c ON c."id" = pc."categoryId"
        WHERE pc."productId" = p."id" AND c."id" = ANY($${index}::text[])
      )`);
      params.push(query.categoryIds);
      index += 1;
    }

    if (query.brandIds?.length) {
      clauses.push(`AND p."brandId" = ANY($${index}::text[])`);
      params.push(query.brandIds);
      index += 1;
    }

    if (query.minPriceCents !== undefined) {
      clauses.push(`AND EXISTS (
        SELECT 1 FROM "Variant" v JOIN "Price" pr ON pr."variantId" = v."id"
        WHERE v."productId" = p."id" AND pr."amountCents" >= $${index}
      )`);
      params.push(query.minPriceCents);
      index += 1;
    }

    if (query.maxPriceCents !== undefined) {
      clauses.push(`AND EXISTS (
        SELECT 1 FROM "Variant" v JOIN "Price" pr ON pr."variantId" = v."id"
        WHERE v."productId" = p."id" AND pr."amountCents" <= $${index}
      )`);
      params.push(query.maxPriceCents);
      index += 1;
    }

    if (query.inStockOnly) {
      clauses.push(`AND EXISTS (
        SELECT 1 FROM "Variant" v JOIN "InventoryItem" i ON i."variantId" = v."id"
        WHERE v."productId" = p."id" AND (i."onHand" - i."reserved") > 0
      )`);
    }

    if (query.minRating !== undefined) {
      clauses.push(`AND p."ratingAvg" >= $${index}`);
      params.push(query.minRating);
      index += 1;
    }

    return { sql: clauses.join('\n        '), params };
  }

  private async pinnedProductIds(
    term: string,
    locale: Locale,
  ): Promise<string[]> {
    const pins = await this.prisma.searchPin.findMany({
      where: { term: this.normalize(term), locale },
      orderBy: { position: 'asc' },
      select: { productId: true },
    });

    return pins.map((pin) => pin.productId);
  }

  private async hydrate(
    ids: string[],
    scores: Map<string, number>,
    pinnedIds: string[],
    context: StorefrontContext,
  ): Promise<SearchHit[]> {
    if (ids.length === 0) {
      return [];
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, status: 'ACTIVE', deletedAt: null },
      include: {
        translations: { where: { locale: context.locale } },
        brand: { select: { name: true } },
        media: {
          take: 1,
          orderBy: { position: 'asc' },
          include: { media: true },
        },
        variants: {
          where: { isActive: true, deletedAt: null },
          select: {
            id: true,
            inventoryItems: { select: { onHand: true, reserved: true } },
          },
        },
      },
    });

    const priceMap = await this.prices.resolveMany(
      products.flatMap((product) =>
        product.variants.map((variant) => variant.id),
      ),
      {
        currencyCode: context.currencyCode,
        customerGroupId: context.customerGroupId,
      },
    );

    const byId = new Map(products.map((product) => [product.id, product]));

    // L'ordre du SQL fait foi : `findMany` ne garantit pas l'ordre d'un `IN`.
    return ids
      .map((id) => byId.get(id))
      .filter((product): product is NonNullable<typeof product> =>
        Boolean(product),
      )
      .map((product) => {
        const prices = product.variants
          .map((variant) => priceMap.get(variant.id))
          .filter((price): price is NonNullable<typeof price> =>
            Boolean(price),
          );

        const cheapest = prices.reduce<(typeof prices)[number] | null>(
          (best, price) =>
            !best || price.amountCents < best.amountCents ? price : best,
          null,
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
          ratingAvg: Number(product.ratingAvg),
          ratingCount: product.ratingCount,
          isAvailable: product.variants.some((variant) =>
            variant.inventoryItems.some(
              (item) => Number(item.onHand) - Number(item.reserved) > 0,
            ),
          ),
          isPinned: pinnedIds.includes(product.id),
          score: scores.get(product.id) ?? 0,
        };
      });
  }

  /**
   * Facettes calculées sur l'ensemble filtré. Elles ne tiennent pas compte du
   * terme recherché : un compteur qui tombe à zéro dès la première sélection
   * empêche le visiteur d'élargir sa recherche.
   */
  private async buildFacets(
    locale: Locale,
    query: SearchQueryDto,
  ): Promise<SearchFacets> {
    const baseWhere = {
      status: 'ACTIVE' as const,
      deletedAt: null,
      brandId: query.brandIds?.length ? { in: query.brandIds } : undefined,
    };

    const [categories, brands, attributes, priceBounds, stock] =
      await Promise.all([
        this.prisma.productCategory.groupBy({
          by: ['categoryId'],
          where: { product: baseWhere },
          _count: true,
          orderBy: { _count: { categoryId: 'desc' } },
          take: 20,
        }),
        this.prisma.product.groupBy({
          by: ['brandId'],
          where: { ...baseWhere, brandId: { not: null } },
          _count: true,
          orderBy: { _count: { brandId: 'desc' } },
          take: 20,
        }),
        this.prisma.productAttributeValue.groupBy({
          by: ['attributeId', 'valueText'],
          where: { product: baseWhere, valueText: { not: null } },
          _count: true,
          orderBy: { _count: { attributeId: 'desc' } },
          take: 50,
        }),
        this.prisma.price.aggregate({
          where: { variant: { product: baseWhere } },
          _min: { amountCents: true },
          _max: { amountCents: true },
        }),
        this.prisma.product.findMany({
          where: baseWhere,
          select: {
            id: true,
            variants: {
              select: {
                inventoryItems: { select: { onHand: true, reserved: true } },
              },
            },
          },
        }),
      ]);

    const [categoryLabels, brandLabels, attributeLabels] = await Promise.all([
      this.prisma.categoryTranslation.findMany({
        where: {
          locale,
          categoryId: { in: categories.map((entry) => entry.categoryId) },
        },
        select: { categoryId: true, name: true, slug: true },
      }),
      this.prisma.brand.findMany({
        where: { id: { in: brands.map((entry) => entry.brandId as string) } },
        select: { id: true, name: true },
      }),
      this.prisma.attributeDefinitionTranslation.findMany({
        where: {
          locale,
          attributeId: {
            in: [...new Set(attributes.map((entry) => entry.attributeId))],
          },
        },
        select: {
          attributeId: true,
          name: true,
          attribute: { select: { code: true } },
        },
      }) as Promise<
        { attributeId: string; name: string; attribute: { code: string } }[]
      >,
    ]);

    const inStock = stock.filter((product) =>
      product.variants.some((variant) =>
        variant.inventoryItems.some(
          (item) => Number(item.onHand) - Number(item.reserved) > 0,
        ),
      ),
    ).length;

    const attributeBuckets = new Map<string, FacetBucket[]>();

    for (const entry of attributes) {
      const list = attributeBuckets.get(entry.attributeId) ?? [];
      list.push({
        value: entry.valueText as string,
        label: entry.valueText as string,
        count: entry._count,
      });
      attributeBuckets.set(entry.attributeId, list);
    }

    return {
      categories: categories.map((entry) => {
        const label = categoryLabels.find(
          (item) => item.categoryId === entry.categoryId,
        );
        return {
          value: label?.slug ?? entry.categoryId,
          label: label?.name ?? '',
          count: entry._count,
        };
      }),
      brands: brands.map((entry) => ({
        value: entry.brandId as string,
        label:
          brandLabels.find((item) => item.id === entry.brandId)?.name ?? '',
        count: entry._count,
      })),
      attributes: [...attributeBuckets.entries()].map(
        ([attributeId, values]) => {
          const label = attributeLabels.find(
            (item) => item.attributeId === attributeId,
          );
          return {
            code: label?.attribute.code ?? attributeId,
            label: label?.name ?? '',
            values,
          };
        },
      ),
      priceRange:
        priceBounds._min.amountCents !== null &&
        priceBounds._max.amountCents !== null
          ? {
              minCents: priceBounds._min.amountCents,
              maxCents: priceBounds._max.amountCents,
            }
          : null,
      availability: { inStock, outOfStock: stock.length - inStock },
    };
  }

  /** Élargit la requête avec les synonymes configurés par l'administration. */
  private async expandWithSynonyms(
    term: string,
    locale: Locale,
  ): Promise<string> {
    if (!term) {
      return term;
    }

    const entry = await this.prisma.searchSynonym.findFirst({
      where: { term: this.normalize(term), locale, isActive: true },
    });

    if (!entry?.synonyms.length) {
      return term;
    }

    // `websearch_to_tsquery` interprète « OR » comme une alternative.
    return [term, ...entry.synonyms].join(' OR ');
  }

  private async logQuery(
    term: string,
    locale: Locale,
    resultCount: number,
    userId?: string,
  ): Promise<void> {
    await this.prisma.searchQuery
      .create({
        data: {
          term,
          normalized: this.normalize(term),
          locale,
          resultCount,
          userId,
        },
      })
      // Le journal de recherche est de la donnée d'analyse : son échec ne doit
      // jamais empêcher d'afficher les résultats.
      .catch(() => undefined);
  }

  private normalize(term: string): string {
    return term
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }
}
