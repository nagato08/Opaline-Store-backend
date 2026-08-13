import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SearchService } from './search.service';
import { SearchAdminService } from './search-admin.service';
import { OptionalAuth } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import {
  Storefront,
  type StorefrontContext,
} from '../common/decorators/storefront-context.decorator';
import { SearchQueryDto, SuggestQueryDto } from './dto/search.dto';
import { Locale } from '../generated/prisma/enums';

class SynonymDto {
  @IsString()
  @MaxLength(60)
  term: string;

  @IsArray()
  @IsString({ each: true })
  synonyms: string[];

  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;
}

class PinDto {
  @IsString()
  @MaxLength(60)
  term: string;

  @IsString()
  productId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;
}

@Controller('search')
@OptionalAuth()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  find(
    @Query() query: SearchQueryDto,
    @Storefront() context: StorefrontContext,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.search.search(query, context, user?.id);
  }

  @Get('suggest')
  suggest(
    @Query() query: SuggestQueryDto,
    @Storefront() context: StorefrontContext,
  ) {
    return this.search.suggest(query.q, context.locale);
  }
}

@Controller('admin/search')
@Roles('MANAGER', 'ADMIN')
export class AdminSearchController {
  constructor(
    private readonly search: SearchService,
    private readonly admin: SearchAdminService,
  ) {}

  /** Requêtes sans résultat : chaque ligne est une vente potentiellement perdue. */
  @Get('zero-results')
  zeroResults(@Query('days') days?: string) {
    return this.search.zeroResultQueries(days ? parseInt(days, 10) : 30);
  }

  @Get('top-queries')
  topQueries(@Query('days') days?: string) {
    return this.search.topQueries(days ? parseInt(days, 10) : 30);
  }

  @Get('synonyms')
  listSynonyms() {
    return this.admin.listSynonyms();
  }

  @Post('synonyms')
  upsertSynonym(@Body() dto: SynonymDto) {
    return this.admin.upsertSynonym(dto.term, dto.synonyms, dto.locale ?? 'FR');
  }

  @Delete('synonyms/:id')
  removeSynonym(@Param('id') id: string) {
    return this.admin.removeSynonym(id);
  }

  @Get('pins')
  listPins(@Query('term') term?: string) {
    return this.admin.listPins(term);
  }

  @Post('pins')
  createPin(@Body() dto: PinDto) {
    return this.admin.pinProduct(
      dto.term,
      dto.productId,
      dto.position ?? 0,
      dto.locale ?? 'FR',
    );
  }

  @Delete('pins/:id')
  removePin(@Param('id') id: string) {
    return this.admin.removePin(id);
  }
}
