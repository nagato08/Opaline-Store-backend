import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ContentAdminService } from './services/content-admin.service';
import { NewsletterService } from './services/newsletter.service';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  CreateBannerDto,
  CreateCampaignDto,
  CreatePageDto,
  CreatePostDto,
  CreateRedirectDto,
  MenuItemInputDto,
  UpdateCampaignDto,
} from './dto/content.dto';

@Controller('admin/content')
@Roles('MANAGER', 'ADMIN')
export class AdminContentController {
  constructor(
    private readonly content: ContentAdminService,
    private readonly newsletter: NewsletterService,
  ) {}

  // --- Campagnes ------------------------------------------------------------

  @Get('campaigns')
  listCampaigns(@Query() dto: PaginationDto) {
    return this.content.listCampaigns(dto);
  }

  @Get('campaigns/:id')
  campaign(@Param('id') id: string) {
    return this.content.findCampaign(id);
  }

  @Get('campaigns/:id/stats')
  campaignStats(@Param('id') id: string, @Query('days') days?: string) {
    return this.content.campaignStats(id, days ? parseInt(days, 10) : 30);
  }

  @Post('campaigns')
  createCampaign(@Body() dto: CreateCampaignDto) {
    return this.content.createCampaign(dto);
  }

  @Patch('campaigns/:id')
  updateCampaign(@Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.content.updateCampaign(id, dto);
  }

  @Delete('campaigns/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCampaign(@Param('id') id: string) {
    return this.content.removeCampaign(id);
  }

  // --- Bannières ------------------------------------------------------------

  @Get('banners')
  banners(@Query('slot') slot?: string) {
    return this.content.listBanners(slot);
  }

  @Post('banners')
  createBanner(@Body() dto: CreateBannerDto) {
    return this.content.createBanner(dto);
  }

  @Delete('banners/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeBanner(@Param('id') id: string) {
    return this.content.removeBanner(id);
  }

  // --- Pages et articles ----------------------------------------------------

  @Get('pages')
  pages(@Query() dto: PaginationDto) {
    return this.content.listPages(dto);
  }

  @Post('pages')
  createPage(@Body() dto: CreatePageDto) {
    return this.content.createPage(dto);
  }

  @Patch('pages/:id')
  updatePage(@Param('id') id: string, @Body() dto: CreatePageDto) {
    return this.content.updatePage(id, dto);
  }

  @Delete('pages/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePage(@Param('id') id: string) {
    return this.content.removePage(id);
  }

  @Get('posts')
  posts(@Query() dto: PaginationDto) {
    return this.content.listPosts(dto);
  }

  @Post('posts')
  createPost(@Body() dto: CreatePostDto) {
    return this.content.createPost(dto);
  }

  @Delete('posts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePost(@Param('id') id: string) {
    return this.content.removePost(id);
  }

  // --- Menus et redirections ------------------------------------------------

  @Put('menus/:code')
  upsertMenu(
    @Param('code') code: string,
    @Body('items') items: MenuItemInputDto[],
  ) {
    return this.content.upsertMenu(code, items);
  }

  @Get('redirects')
  redirects(@Query() dto: PaginationDto) {
    return this.content.listRedirects(dto);
  }

  @Post('redirects')
  createRedirect(@Body() dto: CreateRedirectDto) {
    return this.content.createRedirect(dto);
  }

  @Delete('redirects/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeRedirect(@Param('id') id: string) {
    return this.content.removeRedirect(id);
  }

  // --- Newsletter -----------------------------------------------------------

  @Get('newsletter')
  subscribers(@Query() dto: PaginationDto, @Query('status') status?: string) {
    return this.newsletter.list(dto, status);
  }
}
