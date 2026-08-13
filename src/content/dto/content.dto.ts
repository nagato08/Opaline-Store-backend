import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { StorefrontQueryDto } from '../../common/dto/storefront-query.dto';
import {
  CampaignStatus,
  CampaignType,
  Locale,
  PublishStatus,
} from '../../generated/prisma/enums';

export class ContentTranslationDto {
  @IsEnum(Locale)
  locale: Locale;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  slug?: string;

  @IsOptional()
  @IsString()
  excerpt?: string;

  /** Contenu structuré en blocs produit par l'éditeur admin. */
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  content?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  coverId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(70)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  seoDescription?: string;
}

export class CreatePageDto {
  @IsString()
  @MaxLength(60)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  template?: string;

  @IsOptional()
  @IsEnum(PublishStatus)
  status?: PublishStatus;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContentTranslationDto)
  translations: ContentTranslationDto[];
}

export class CreatePostDto {
  @IsOptional()
  @IsEnum(PublishStatus)
  status?: PublishStatus;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  authorName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsISO8601()
  publishedAt?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContentTranslationDto)
  translations: ContentTranslationDto[];
}

export class CampaignTranslationDto {
  @IsEnum(Locale)
  locale: Locale;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  ctaLabel?: string;

  @IsOptional()
  @IsString()
  ctaUrl?: string;
}

export class CampaignPlacementDto {
  /** Emplacement nommé du front : `home_hero`, `header_top_bar`… */
  @IsString()
  @MaxLength(60)
  slot: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  position?: number;
}

export class CreateCampaignDto {
  @IsString()
  @MaxLength(60)
  code: string;

  @IsEnum(CampaignType)
  type: CampaignType;

  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isExclusive?: boolean;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  /** Planification récurrente : jours, plage horaire. */
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  recurrence?: Record<string, unknown>;

  /** À qui : pages, appareil, pays, audience, segment, source UTM. */
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  targeting?: Record<string, unknown>;

  /** Comment : déclencheur, délai, plafond par visiteur, refermable. */
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  displayRules?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  promotionId?: string;

  @IsOptional()
  @IsString()
  collectionId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CampaignPlacementDto)
  placements?: CampaignPlacementDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CampaignTranslationDto)
  translations?: CampaignTranslationDto[];
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsEnum(CampaignStatus)
  status?: CampaignStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isExclusive?: boolean;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsObject()
  @Type(() => Object)
  recurrence?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  @Type(() => Object)
  targeting?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  @Type(() => Object)
  displayRules?: Record<string, unknown>;
}

export class BannerTranslationInputDto {
  @IsEnum(Locale)
  locale: Locale;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  ctaLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  alt?: string;
}

export class CreateBannerDto {
  @IsString()
  @MaxLength(60)
  code: string;

  @IsString()
  @MaxLength(60)
  slot: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  desktopId?: string;

  @IsOptional()
  @IsString()
  mobileId?: string;

  @IsOptional()
  @IsString()
  linkUrl?: string;

  /** Poids de rotation quand plusieurs bannières partagent l'emplacement. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  weight?: number;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BannerTranslationInputDto)
  translations?: BannerTranslationInputDto[];
}

export class MenuItemInputDto {
  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  targetType?: string;

  @IsOptional()
  @IsString()
  targetId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  position?: number;

  @IsArray()
  @Type(() => Object)
  translations: { locale: Locale; label: string }[];
}

export class CreateRedirectDto {
  @IsString()
  @MaxLength(255)
  fromPath: string;

  @IsString()
  @MaxLength(255)
  toPath: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  statusCode?: number;
}

/** Liste d'articles : pagination + contexte boutique + filtre par tag. */
export class PostQueryDto extends StorefrontQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  tag?: string;
}

export class SubscribeNewsletterDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  source?: string;
}

export class TrackCampaignDto {
  @IsString()
  @IsEnum(['IMPRESSION', 'CLICK', 'DISMISS'])
  type: 'IMPRESSION' | 'CLICK' | 'DISMISS';
}

export class StorefrontContextQueryDto {
  @IsString()
  @MaxLength(255)
  path: string;

  @IsOptional()
  @IsEnum(['mobile', 'tablet', 'desktop'])
  device?: 'mobile' | 'tablet' | 'desktop';

  /** Code pays ISO 3166-1 alpha-2. */
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  utmSource?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cartTotalCents?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];
}
