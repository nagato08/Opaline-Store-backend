import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CampaignsService } from './services/campaigns.service';
import { ContentService } from './services/content.service';
import { NewsletterService } from './services/newsletter.service';
import { UnsubscribeService } from '../mail/unsubscribe.service';
import { OptionalAuth, Public } from '../common/decorators/public.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import {
  Storefront,
  type StorefrontContext,
} from '../common/decorators/storefront-context.decorator';
import {
  PostQueryDto,
  StorefrontContextQueryDto,
  SubscribeNewsletterDto,
  TrackCampaignDto,
} from './dto/content.dto';
import type { VisitorContext } from './campaign-targeting.types';

const VISITOR_HEADER = 'x-visitor-id';

@Controller('content')
@OptionalAuth()
export class ContentController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly content: ContentService,
    private readonly newsletter: NewsletterService,
    private readonly unsubscribeService: UnsubscribeService,
  ) {}

  /**
   * Campagnes à afficher sur la page courante. Le front envoie son contexte
   * (chemin, appareil, panier) et un identifiant de visiteur anonyme, qui sert
   * uniquement à plafonner les répétitions.
   */
  @Get('campaigns')
  campaignsFor(
    @Query() query: StorefrontContextQueryDto,
    @Req() request: Request,
    @Storefront() storefront: StorefrontContext,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const context: VisitorContext = {
      path: query.path,
      device: query.device ?? this.detectDevice(request.header('user-agent')),
      locale: query.locale?.toUpperCase() ?? storefront.locale,
      countryCode: query.country?.toUpperCase() ?? storefront.countryCode,
      visitorId: request.header(VISITOR_HEADER) ?? null,
      userId: user?.id ?? null,
      customerGroupId: storefront.customerGroupId,
      isReturning: Boolean(request.header(VISITOR_HEADER)),
      utmSource: query.utmSource ?? null,
      cartTotalCents: query.cartTotalCents ?? 0,
      categoryIds: query.categoryIds ?? [],
    };

    return this.campaigns.resolveFor(context, storefront.locale);
  }

  @Post('campaigns/:id/track')
  track(
    @Param('id') id: string,
    @Body() dto: TrackCampaignDto,
    @Req() request: Request,
  ) {
    return this.campaigns.track(
      id,
      dto.type,
      request.header(VISITOR_HEADER) ?? null,
    );
  }

  @Get('banners/:slot')
  banners(
    @Param('slot') slot: string,
    @Storefront() context: StorefrontContext,
  ) {
    return this.campaigns.bannersForSlot(slot, context.locale);
  }

  @Get('pages/:slug')
  page(@Param('slug') slug: string, @Storefront() context: StorefrontContext) {
    return this.content.page(slug, context.locale);
  }

  @Get('posts')
  posts(@Query() dto: PostQueryDto, @Storefront() context: StorefrontContext) {
    return this.content.posts(context.locale, dto, dto.tag);
  }

  @Get('posts/:slug')
  post(@Param('slug') slug: string, @Storefront() context: StorefrontContext) {
    return this.content.post(slug, context.locale);
  }

  @Get('menus/:code')
  menu(@Param('code') code: string, @Storefront() context: StorefrontContext) {
    return this.content.menu(code, context.locale);
  }

  /** Consulté par le middleware du front avant de rendre un 404. */
  @Public()
  @Get('redirects')
  redirect(@Query('path') path: string) {
    return this.content.resolveRedirect(path);
  }

  @Get('sitemap')
  sitemap(@Storefront() context: StorefrontContext) {
    return this.content.sitemap(context.locale);
  }

  @Public()
  @Post('newsletter')
  subscribe(@Body() dto: SubscribeNewsletterDto) {
    return this.newsletter.subscribe(dto.email, dto.locale ?? 'FR', dto.source);
  }

  @Public()
  @Post('newsletter/confirm')
  confirm(@Body('token') token: string) {
    return this.newsletter.confirm(token);
  }

  /**
   * Désinscription en un clic depuis le pied de page d'un email : le jeton
   * signé identifie l'adresse sans exiger de connexion.
   */
  @Public()
  @Post('newsletter/unsubscribe')
  unsubscribe(@Body('token') token?: string, @Body('email') email?: string) {
    if (token) {
      return this.newsletter.unsubscribe(this.unsubscribeService.verify(token));
    }

    if (!email) {
      throw new BadRequestException('Adresse ou jeton requis.');
    }

    return this.newsletter.unsubscribe(email);
  }

  /** Détection sommaire, suffisante pour cibler un popup mobile. */
  private detectDevice(userAgent?: string): 'mobile' | 'tablet' | 'desktop' {
    if (!userAgent) return 'desktop';
    if (/tablet|ipad/i.test(userAgent)) return 'tablet';
    if (/mobile|android|iphone/i.test(userAgent)) return 'mobile';
    return 'desktop';
  }
}
