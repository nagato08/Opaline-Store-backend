import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import type { Locale } from '../../generated/prisma/enums';
import type {
  CampaignDisplayRules,
  CampaignRecurrence,
  CampaignTargeting,
  VisitorContext,
} from '../campaign-targeting.types';

export type ResolvedCampaign = {
  id: string;
  code: string;
  type: string;
  slot: string;
  priority: number;
  title: string | null;
  body: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  displayRules: CampaignDisplayRules;
  banners: {
    id: string;
    desktopUrl: string | null;
    mobileUrl: string | null;
    linkUrl: string | null;
    title: string | null;
    subtitle: string | null;
    ctaLabel: string | null;
    alt: string | null;
  }[];
  promotionCode: string | null;
  collectionSlug: string | null;
  endsAt: Date | null;
};

/** Compteur d'affichages conservé un an : au-delà, le plafond n'a plus de sens. */
const SEEN_TTL_SECONDS = 365 * 24 * 3600;

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Campagnes à afficher pour un visiteur donné, emplacement par emplacement.
   *
   * Le filtrage se fait dans cet ordre : fenêtre de diffusion, récurrence,
   * ciblage, plafond de répétition. Ne reste ensuite qu'une campagne par
   * emplacement — la plus prioritaire —, sauf emplacements multiples comme les
   * bandeaux rotatifs.
   */
  async resolveFor(
    context: VisitorContext,
    locale: Locale,
  ): Promise<ResolvedCampaign[]> {
    const now = new Date();

    const campaigns = await this.prisma.campaign.findMany({
      where: {
        status: 'RUNNING',
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { priority: 'desc' },
      include: {
        translations: { where: { locale } },
        placements: true,
        banners: {
          where: { isActive: true },
          orderBy: { position: 'asc' },
          include: {
            translations: { where: { locale } },
            desktop: { select: { url: true } },
            mobile: { select: { url: true } },
          },
        },
        promotion: { select: { code: true } },
        collection: { include: { translations: { where: { locale } } } },
      },
    });

    const eligible: ResolvedCampaign[] = [];

    for (const campaign of campaigns) {
      if (
        !this.matchesRecurrence(
          campaign.recurrence as CampaignRecurrence | null,
          campaign.timezone,
          now,
        )
      ) {
        continue;
      }

      if (
        !this.matchesTargeting(campaign.targeting as CampaignTargeting, context)
      ) {
        continue;
      }

      const rules = (campaign.displayRules ?? {}) as CampaignDisplayRules;

      if (
        !(await this.isUnderFrequencyCap(campaign.id, context.visitorId, rules))
      ) {
        continue;
      }

      const translation = campaign.translations[0];

      for (const placement of campaign.placements.length > 0
        ? campaign.placements
        : [{ slot: 'default', position: 0 }]) {
        eligible.push({
          id: campaign.id,
          code: campaign.code,
          type: campaign.type,
          slot: placement.slot,
          priority: campaign.priority,
          title: translation?.title ?? null,
          body: translation?.body ?? null,
          ctaLabel: translation?.ctaLabel ?? null,
          ctaUrl: translation?.ctaUrl ?? null,
          displayRules: rules,
          banners: campaign.banners.map((banner) => ({
            id: banner.id,
            desktopUrl: banner.desktop?.url ?? null,
            mobileUrl: banner.mobile?.url ?? null,
            linkUrl: banner.linkUrl,
            title: banner.translations[0]?.title ?? null,
            subtitle: banner.translations[0]?.subtitle ?? null,
            ctaLabel: banner.translations[0]?.ctaLabel ?? null,
            alt: banner.translations[0]?.alt ?? null,
          })),
          promotionCode: campaign.promotion?.code ?? null,
          collectionSlug: campaign.collection?.translations[0]?.slug ?? null,
          endsAt: campaign.endsAt,
        });
      }
    }

    return this.keepBestPerSlot(eligible, campaigns);
  }

  /** Bannières libres d'un emplacement, hors campagne, avec rotation pondérée. */
  async bannersForSlot(slot: string, locale: Locale) {
    const now = new Date();

    const banners = await this.prisma.banner.findMany({
      where: {
        slot,
        isActive: true,
        campaignId: null,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { position: 'asc' },
      include: {
        translations: { where: { locale } },
        desktop: { select: { url: true } },
        mobile: { select: { url: true } },
      },
    });

    return banners.map((banner) => ({
      id: banner.id,
      code: banner.code,
      weight: banner.weight,
      desktopUrl: banner.desktop?.url ?? null,
      mobileUrl: banner.mobile?.url ?? null,
      linkUrl: banner.linkUrl,
      title: banner.translations[0]?.title ?? null,
      subtitle: banner.translations[0]?.subtitle ?? null,
      ctaLabel: banner.translations[0]?.ctaLabel ?? null,
      alt: banner.translations[0]?.alt ?? null,
    }));
  }

  /**
   * Enregistre un événement d'affichage. Les compteurs sont agrégés par jour :
   * stocker chaque impression individuellement ferait exploser la table pour
   * une information qu'on ne consulte que par jour.
   */
  async track(
    campaignId: string,
    type: 'IMPRESSION' | 'CLICK' | 'DISMISS',
    visitorId: string | null,
  ): Promise<void> {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);

    await this.prisma.campaignStat.upsert({
      where: { campaignId_date: { campaignId, date } },
      update: {
        impressions: type === 'IMPRESSION' ? { increment: 1 } : undefined,
        clicks: type === 'CLICK' ? { increment: 1 } : undefined,
        dismissals: type === 'DISMISS' ? { increment: 1 } : undefined,
      },
      create: {
        campaignId,
        date,
        impressions: type === 'IMPRESSION' ? 1 : 0,
        clicks: type === 'CLICK' ? 1 : 0,
        dismissals: type === 'DISMISS' ? 1 : 0,
      },
    });

    if (visitorId && type !== 'CLICK') {
      const key = this.seenKey(campaignId, visitorId);
      await this.redis.incr(key);
      await this.redis.expire(key, SEEN_TTL_SECONDS);

      if (type === 'DISMISS') {
        await this.redis.set(
          this.dismissKey(campaignId, visitorId),
          Date.now(),
          'EX',
          SEEN_TTL_SECONDS,
        );
      }
    }
  }

  /**
   * Une campagne est-elle dans sa fenêtre récurrente ?
   * L'heure est évaluée dans le fuseau de la campagne : « vendredi 18 h »
   * signifie 18 h à Paris, pas 18 h UTC.
   */
  private matchesRecurrence(
    recurrence: CampaignRecurrence | null,
    timezone: string,
    now: Date,
  ): boolean {
    if (!recurrence || Object.keys(recurrence).length === 0) {
      return true;
    }

    const parts = new Intl.DateTimeFormat('fr-FR', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? '';

    const weekdayMap: Record<string, number> = {
      dim: 0,
      lun: 1,
      mar: 2,
      mer: 3,
      jeu: 4,
      ven: 5,
      sam: 6,
    };

    const weekday = weekdayMap[get('weekday').slice(0, 3).toLowerCase()] ?? -1;
    const dayOfMonth = parseInt(get('day'), 10);
    const minutes =
      parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10);

    if (
      recurrence.daysOfWeek?.length &&
      !recurrence.daysOfWeek.includes(weekday)
    ) {
      return false;
    }

    if (
      recurrence.daysOfMonth?.length &&
      !recurrence.daysOfMonth.includes(dayOfMonth)
    ) {
      return false;
    }

    if (recurrence.startTime && recurrence.endTime) {
      const start = this.toMinutes(recurrence.startTime);
      const end = this.toMinutes(recurrence.endTime);

      // Plage à cheval sur minuit (22 h → 2 h) : elle se lit en deux morceaux.
      return start <= end
        ? minutes >= start && minutes <= end
        : minutes >= start || minutes <= end;
    }

    return true;
  }

  private matchesTargeting(
    targeting: CampaignTargeting,
    context: VisitorContext,
  ): boolean {
    if (!targeting || Object.keys(targeting).length === 0) {
      return true;
    }

    if (
      targeting.pages?.length &&
      !targeting.pages.some((pattern) => this.matchPath(pattern, context.path))
    ) {
      return false;
    }

    if (
      targeting.excludedPages?.some((pattern) =>
        this.matchPath(pattern, context.path),
      )
    ) {
      return false;
    }

    if (
      targeting.devices?.length &&
      !targeting.devices.includes(context.device)
    ) {
      return false;
    }

    if (
      targeting.locales?.length &&
      !targeting.locales.includes(context.locale)
    ) {
      return false;
    }

    if (
      targeting.countries?.length &&
      !targeting.countries.includes(context.countryCode)
    ) {
      return false;
    }

    if (
      targeting.customerGroups?.length &&
      (!context.customerGroupId ||
        !targeting.customerGroups.includes(context.customerGroupId))
    ) {
      return false;
    }

    if (
      targeting.utmSources?.length &&
      (!context.utmSource || !targeting.utmSources.includes(context.utmSource))
    ) {
      return false;
    }

    if (
      targeting.minCartCents !== undefined &&
      context.cartTotalCents < targeting.minCartCents
    ) {
      return false;
    }

    if (
      targeting.categories?.length &&
      !targeting.categories.some((id) => context.categoryIds.includes(id))
    ) {
      return false;
    }

    switch (targeting.audience) {
      case 'NEW_VISITOR':
        return !context.isReturning;
      case 'RETURNING_VISITOR':
        return context.isReturning;
      case 'CUSTOMER':
        return Boolean(context.userId);
      case 'GUEST':
        return !context.userId;
      default:
        return true;
    }
  }

  private async isUnderFrequencyCap(
    campaignId: string,
    visitorId: string | null,
    rules: CampaignDisplayRules,
  ): Promise<boolean> {
    if (!visitorId || (!rules.maxPerVisitor && !rules.cooldownHours)) {
      return true;
    }

    if (rules.maxPerVisitor) {
      const seen = await this.redis.get(this.seenKey(campaignId, visitorId));

      if (seen && parseInt(seen, 10) >= rules.maxPerVisitor) {
        return false;
      }
    }

    if (rules.cooldownHours) {
      const dismissedAt = await this.redis.get(
        this.dismissKey(campaignId, visitorId),
      );

      if (
        dismissedAt &&
        Date.now() - parseInt(dismissedAt, 10) < rules.cooldownHours * 3600_000
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Un emplacement exclusif n'affiche qu'une campagne : la plus prioritaire.
   * Sans cette règle, deux popups peuvent se superposer.
   */
  private keepBestPerSlot(
    campaigns: ResolvedCampaign[],
    source: { id: string; isExclusive: boolean }[],
  ): ResolvedCampaign[] {
    const exclusiveById = new Map(
      source.map((item) => [item.id, item.isExclusive]),
    );
    const bySlot = new Map<string, ResolvedCampaign[]>();

    for (const campaign of campaigns) {
      const list = bySlot.get(campaign.slot) ?? [];
      list.push(campaign);
      bySlot.set(campaign.slot, list);
    }

    const result: ResolvedCampaign[] = [];

    for (const list of bySlot.values()) {
      const sorted = list.sort((a, b) => b.priority - a.priority);
      const best = sorted[0];

      if (best && exclusiveById.get(best.id)) {
        result.push(best);
      } else {
        result.push(...sorted);
      }
    }

    return result;
  }

  /** `/fr/meubles/*` correspond à `/fr/meubles/canapes`. */
  private matchPath(pattern: string, path: string): boolean {
    if (pattern === '*' || pattern === path) {
      return true;
    }

    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');

    return new RegExp(`^${escaped}$`).test(path);
  }

  private toMinutes(time: string): number {
    const [hours, minutes] = time
      .split(':')
      .map((value) => parseInt(value, 10));
    return hours * 60 + (minutes || 0);
  }

  private seenKey(campaignId: string, visitorId: string): string {
    return `campaign:seen:${campaignId}:${visitorId}`;
  }

  private dismissKey(campaignId: string, visitorId: string): string {
    return `campaign:dismissed:${campaignId}:${visitorId}`;
  }
}
