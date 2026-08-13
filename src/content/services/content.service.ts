import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, type PaginationDto } from '../../common/dto/pagination.dto';
import type { Locale } from '../../generated/prisma/enums';

export type MenuNode = {
  id: string;
  label: string;
  url: string | null;
  targetType: string | null;
  targetId: string | null;
  children: MenuNode[];
};

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  async page(slug: string, locale: Locale) {
    const translation = await this.prisma.pageTranslation.findUnique({
      where: { locale_slug: { locale, slug } },
      include: { page: true, cover: { select: { url: true } } },
    });

    if (!translation || translation.page.status !== 'PUBLISHED') {
      throw new NotFoundException('Page introuvable.');
    }

    return {
      id: translation.pageId,
      code: translation.page.code,
      template: translation.page.template,
      title: translation.title,
      slug: translation.slug,
      content: translation.content,
      coverUrl: translation.cover?.url ?? null,
      seo: {
        title: translation.seoTitle ?? translation.title,
        description: translation.seoDescription ?? translation.excerpt,
      },
      publishedAt: translation.page.publishedAt,
    };
  }

  async posts(locale: Locale, dto: PaginationDto, tag?: string) {
    const where = {
      status: 'PUBLISHED' as const,
      publishedAt: { lte: new Date() },
      ...(tag ? { tags: { has: tag } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: dto.skip,
        take: dto.perPage,
        include: {
          translations: { where: { locale } },
        },
      }),
      this.prisma.post.count({ where }),
    ]);

    return paginate(
      items.map((post) => ({
        id: post.id,
        title: post.translations[0]?.title ?? '',
        slug: post.translations[0]?.slug ?? '',
        excerpt: post.translations[0]?.excerpt ?? null,
        tags: post.tags,
        publishedAt: post.publishedAt,
      })),
      total,
      dto,
    );
  }

  async post(slug: string, locale: Locale) {
    const translation = await this.prisma.postTranslation.findUnique({
      where: { locale_slug: { locale, slug } },
      include: { post: true, cover: { select: { url: true } } },
    });

    if (!translation || translation.post.status !== 'PUBLISHED') {
      throw new NotFoundException('Article introuvable.');
    }

    return {
      id: translation.postId,
      title: translation.title,
      slug: translation.slug,
      excerpt: translation.excerpt,
      content: translation.content,
      coverUrl: translation.cover?.url ?? null,
      tags: translation.post.tags,
      authorName: translation.post.authorName,
      publishedAt: translation.post.publishedAt,
      seo: {
        title: translation.seoTitle ?? translation.title,
        description: translation.seoDescription ?? translation.excerpt,
      },
    };
  }

  /** Menu hiérarchique prêt à afficher, dans la langue demandée. */
  async menu(code: string, locale: Locale) {
    const menu = await this.prisma.menu.findUnique({
      where: { code },
      include: {
        items: {
          where: { isActive: true },
          orderBy: { position: 'asc' },
          include: { translations: { where: { locale } } },
        },
      },
    });

    if (!menu) {
      throw new NotFoundException('Menu introuvable.');
    }

    const nodes = new Map<string, MenuNode>();
    const roots: MenuNode[] = [];

    for (const item of menu.items) {
      nodes.set(item.id, {
        id: item.id,
        label: item.translations[0]?.label ?? '',
        url: item.url,
        targetType: item.targetType,
        targetId: item.targetId,
        children: [],
      });
    }

    for (const item of menu.items) {
      const node = nodes.get(item.id) as MenuNode;
      const parent = item.parentId ? nodes.get(item.parentId) : undefined;

      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return { code: menu.code, items: roots };
  }

  /**
   * Résolution d'une redirection. Le compteur de visites permet de repérer les
   * redirections encore utilisées et celles devenues inutiles.
   */
  async resolveRedirect(path: string) {
    const redirect = await this.prisma.redirect.findFirst({
      where: { fromPath: path, isActive: true },
    });

    if (!redirect) {
      return null;
    }

    await this.prisma.redirect.update({
      where: { id: redirect.id },
      data: { hits: { increment: 1 } },
    });

    return { toPath: redirect.toPath, statusCode: redirect.statusCode };
  }

  /**
   * Entrées du sitemap : produits, catégories, collections, pages et articles
   * publiés, avec leur slug par langue.
   */
  async sitemap(locale: Locale) {
    const [products, categories, collections, pages, posts] = await Promise.all(
      [
        this.prisma.productTranslation.findMany({
          where: { locale, product: { status: 'ACTIVE', deletedAt: null } },
          select: { slug: true, product: { select: { updatedAt: true } } },
        }),
        this.prisma.categoryTranslation.findMany({
          where: { locale, category: { isActive: true } },
          select: { slug: true, category: { select: { updatedAt: true } } },
        }),
        this.prisma.collectionTranslation.findMany({
          where: { locale, collection: { isActive: true } },
          select: { slug: true, collection: { select: { updatedAt: true } } },
        }),
        this.prisma.pageTranslation.findMany({
          where: { locale, page: { status: 'PUBLISHED' } },
          select: { slug: true, page: { select: { updatedAt: true } } },
        }),
        this.prisma.postTranslation.findMany({
          where: { locale, post: { status: 'PUBLISHED' } },
          select: { slug: true, post: { select: { updatedAt: true } } },
        }),
      ],
    );

    const prefix = locale.toLowerCase();

    return [
      ...products.map((item) => ({
        loc: `/${prefix}/produits/${item.slug}`,
        lastmod: item.product.updatedAt,
        changefreq: 'weekly',
        priority: 0.8,
      })),
      ...categories.map((item) => ({
        loc: `/${prefix}/categories/${item.slug}`,
        lastmod: item.category.updatedAt,
        changefreq: 'weekly',
        priority: 0.7,
      })),
      ...collections.map((item) => ({
        loc: `/${prefix}/collections/${item.slug}`,
        lastmod: item.collection.updatedAt,
        changefreq: 'weekly',
        priority: 0.6,
      })),
      ...pages.map((item) => ({
        loc: `/${prefix}/${item.slug}`,
        lastmod: item.page.updatedAt,
        changefreq: 'monthly',
        priority: 0.5,
      })),
      ...posts.map((item) => ({
        loc: `/${prefix}/blog/${item.slug}`,
        lastmod: item.post.updatedAt,
        changefreq: 'monthly',
        priority: 0.5,
      })),
    ];
  }
}
