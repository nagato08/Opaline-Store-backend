import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { slugify, uniqueSlug } from '../../common/utils/slug';
import { paginate, type PaginationDto } from '../../common/dto/pagination.dto';
import { Prisma } from '../../generated/prisma/client';
import type { Locale } from '../../generated/prisma/enums';
import type {
  ContentTranslationDto,
  CreateBannerDto,
  CreateCampaignDto,
  CreatePageDto,
  CreatePostDto,
  CreateRedirectDto,
  MenuItemInputDto,
  UpdateCampaignDto,
} from '../dto/content.dto';

@Injectable()
export class ContentAdminService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Pages ----------------------------------------------------------------

  async createPage(dto: CreatePageDto) {
    return this.prisma.page.create({
      data: {
        code: dto.code,
        template: dto.template ?? 'default',
        status: dto.status ?? 'DRAFT',
        publishedAt: dto.status === 'PUBLISHED' ? new Date() : null,
        translations: {
          create: await this.buildContentTranslations(dto.translations, 'page'),
        },
      },
      include: { translations: true },
    });
  }

  async updatePage(id: string, dto: Partial<CreatePageDto>) {
    await this.prisma.page.update({
      where: { id },
      data: {
        template: dto.template,
        status: dto.status,
        publishedAt: dto.status === 'PUBLISHED' ? new Date() : undefined,
      },
    });

    for (const translation of dto.translations ?? []) {
      await this.prisma.pageTranslation.upsert({
        where: { pageId_locale: { pageId: id, locale: translation.locale } },
        update: this.contentTranslationData(translation),
        create: {
          pageId: id,
          locale: translation.locale,
          slug: await this.uniquePageSlug(translation, id),
          ...this.contentTranslationData(translation),
        },
      });
    }

    return this.prisma.page.findUniqueOrThrow({
      where: { id },
      include: { translations: true },
    });
  }

  listPages(dto: PaginationDto) {
    return this.prisma.page.findMany({
      orderBy: { updatedAt: 'desc' },
      skip: dto.skip,
      take: dto.perPage,
      include: { translations: true },
    });
  }

  async removePage(id: string): Promise<void> {
    await this.prisma.page.delete({ where: { id } });
  }

  // --- Articles -------------------------------------------------------------

  async createPost(dto: CreatePostDto) {
    return this.prisma.post.create({
      data: {
        status: dto.status ?? 'DRAFT',
        authorName: dto.authorName,
        tags: dto.tags ?? [],
        publishedAt: dto.publishedAt
          ? new Date(dto.publishedAt)
          : dto.status === 'PUBLISHED'
            ? new Date()
            : null,
        translations: {
          create: await this.buildContentTranslations(dto.translations, 'post'),
        },
      },
      include: { translations: true },
    });
  }

  async listPosts(dto: PaginationDto) {
    const [items, total] = await Promise.all([
      this.prisma.post.findMany({
        orderBy: { updatedAt: 'desc' },
        skip: dto.skip,
        take: dto.perPage,
        include: { translations: true },
      }),
      this.prisma.post.count(),
    ]);

    return paginate(items, total, dto);
  }

  async removePost(id: string): Promise<void> {
    await this.prisma.post.delete({ where: { id } });
  }

  // --- Campagnes ------------------------------------------------------------

  createCampaign(dto: CreateCampaignDto) {
    return this.prisma.campaign.create({
      data: {
        code: dto.code.toUpperCase(),
        type: dto.type,
        status: dto.status ?? 'DRAFT',
        priority: dto.priority ?? 0,
        isExclusive: dto.isExclusive ?? false,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        timezone: dto.timezone ?? 'Europe/Paris',
        recurrence: dto.recurrence as Prisma.InputJsonValue,
        targeting: (dto.targeting ?? {}) as Prisma.InputJsonValue,
        displayRules: (dto.displayRules ?? {}) as Prisma.InputJsonValue,
        promotionId: dto.promotionId,
        collectionId: dto.collectionId,
        placements: dto.placements?.length
          ? {
              create: dto.placements.map((placement, index) => ({
                slot: placement.slot,
                position: placement.position ?? index,
              })),
            }
          : undefined,
        translations: dto.translations?.length
          ? { create: dto.translations }
          : undefined,
      },
      include: { translations: true, placements: true },
    });
  }

  updateCampaign(id: string, dto: UpdateCampaignDto) {
    return this.prisma.campaign.update({
      where: { id },
      data: {
        status: dto.status,
        priority: dto.priority,
        isExclusive: dto.isExclusive,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        recurrence: dto.recurrence as Prisma.InputJsonValue,
        targeting: dto.targeting as Prisma.InputJsonValue,
        displayRules: dto.displayRules as Prisma.InputJsonValue,
      },
      include: { translations: true, placements: true, banners: true },
    });
  }

  async listCampaigns(dto: PaginationDto) {
    const [items, total] = await Promise.all([
      this.prisma.campaign.findMany({
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        skip: dto.skip,
        take: dto.perPage,
        include: {
          translations: true,
          placements: true,
          _count: { select: { banners: true } },
        },
      }),
      this.prisma.campaign.count(),
    ]);

    return paginate(items, total, dto);
  }

  findCampaign(id: string) {
    return this.prisma.campaign.findUniqueOrThrow({
      where: { id },
      include: {
        translations: true,
        placements: true,
        banners: { include: { translations: true } },
        stats: { orderBy: { date: 'desc' }, take: 30 },
      },
    });
  }

  /**
   * Performance d'une campagne : impressions, clics, taux de clic et
   * revenus attribués, agrégés sur la période demandée.
   */
  async campaignStats(id: string, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);

    const stats = await this.prisma.campaignStat.findMany({
      where: { campaignId: id, date: { gte: since } },
      orderBy: { date: 'asc' },
    });

    const impressions = stats.reduce((sum, stat) => sum + stat.impressions, 0);
    const clicks = stats.reduce((sum, stat) => sum + stat.clicks, 0);

    return {
      campaignId: id,
      period: { days, since },
      impressions,
      clicks,
      dismissals: stats.reduce((sum, stat) => sum + stat.dismissals, 0),
      conversions: stats.reduce((sum, stat) => sum + stat.conversions, 0),
      revenueCents: stats.reduce((sum, stat) => sum + stat.revenueCents, 0),
      clickThroughRate:
        impressions > 0 ? Number((clicks / impressions).toFixed(4)) : 0,
      daily: stats,
    };
  }

  async removeCampaign(id: string): Promise<void> {
    await this.prisma.campaign.delete({ where: { id } });
  }

  // --- Bannières ------------------------------------------------------------

  createBanner(dto: CreateBannerDto) {
    return this.prisma.banner.create({
      data: {
        code: dto.code,
        slot: dto.slot,
        campaignId: dto.campaignId,
        desktopId: dto.desktopId,
        mobileId: dto.mobileId,
        linkUrl: dto.linkUrl,
        weight: dto.weight ?? 1,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        translations: dto.translations?.length
          ? { create: dto.translations }
          : undefined,
      },
      include: { translations: true },
    });
  }

  listBanners(slot?: string) {
    return this.prisma.banner.findMany({
      where: slot ? { slot } : {},
      orderBy: [{ slot: 'asc' }, { position: 'asc' }],
      include: {
        translations: true,
        campaign: { select: { code: true, status: true } },
      },
    });
  }

  async removeBanner(id: string): Promise<void> {
    await this.prisma.banner.delete({ where: { id } });
  }

  // --- Menus ----------------------------------------------------------------

  async upsertMenu(code: string, items: MenuItemInputDto[]) {
    const menu = await this.prisma.menu.upsert({
      where: { code },
      update: {},
      create: { code },
    });

    // Le menu est remplacé intégralement : l'admin envoie l'arbre complet,
    // ce qui évite de gérer des réordonnancements partiels.
    await this.prisma.menuItem.deleteMany({ where: { menuId: menu.id } });

    for (const [index, item] of items.entries()) {
      await this.prisma.menuItem.create({
        data: {
          menuId: menu.id,
          parentId: item.parentId,
          url: item.url,
          targetType: item.targetType,
          targetId: item.targetId,
          position: item.position ?? index,
          translations: { create: item.translations },
        },
      });
    }

    return this.prisma.menu.findUniqueOrThrow({
      where: { id: menu.id },
      include: { items: { include: { translations: true } } },
    });
  }

  // --- Redirections ---------------------------------------------------------

  createRedirect(dto: CreateRedirectDto) {
    return this.prisma.redirect.upsert({
      where: { fromPath: dto.fromPath },
      update: {
        toPath: dto.toPath,
        statusCode: dto.statusCode ?? 301,
        isActive: true,
      },
      create: {
        fromPath: dto.fromPath,
        toPath: dto.toPath,
        statusCode: dto.statusCode ?? 301,
      },
    });
  }

  listRedirects(dto: PaginationDto) {
    return this.prisma.redirect.findMany({
      orderBy: { hits: 'desc' },
      skip: dto.skip,
      take: dto.perPage,
    });
  }

  async removeRedirect(id: string): Promise<void> {
    await this.prisma.redirect.delete({ where: { id } });
  }

  // --- Interne --------------------------------------------------------------

  private async buildContentTranslations(
    translations: ContentTranslationDto[],
    kind: 'page' | 'post',
  ) {
    return Promise.all(
      translations.map(async (translation) => ({
        locale: translation.locale,
        slug: await uniqueSlug(
          translation.slug ?? translation.title,
          (candidate) => this.isSlugTaken(kind, translation.locale, candidate),
        ),
        ...this.contentTranslationData(translation),
      })),
    );
  }

  private contentTranslationData(translation: ContentTranslationDto) {
    return {
      title: translation.title,
      excerpt: translation.excerpt,
      content: translation.content as Prisma.InputJsonValue,
      coverId: translation.coverId,
      seoTitle: translation.seoTitle,
      seoDescription: translation.seoDescription,
    };
  }

  private async uniquePageSlug(
    translation: ContentTranslationDto,
    pageId: string,
  ) {
    return translation.slug
      ? slugify(translation.slug)
      : uniqueSlug(translation.title, (candidate) =>
          this.isSlugTaken('page', translation.locale, candidate, pageId),
        );
  }

  private async isSlugTaken(
    kind: 'page' | 'post',
    locale: Locale,
    slug: string,
    exceptId?: string,
  ): Promise<boolean> {
    if (kind === 'page') {
      const existing = await this.prisma.pageTranslation.findUnique({
        where: { locale_slug: { locale, slug } },
        select: { pageId: true },
      });
      return Boolean(existing) && existing?.pageId !== exceptId;
    }

    const existing = await this.prisma.postTranslation.findUnique({
      where: { locale_slug: { locale, slug } },
      select: { postId: true },
    });
    return Boolean(existing) && existing?.postId !== exceptId;
  }
}
