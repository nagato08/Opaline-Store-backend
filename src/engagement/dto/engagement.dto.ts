import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  Locale,
  ReturnResolution,
  ReviewStatus,
} from '../../generated/prisma/enums';
import { StorefrontQueryDto } from '../../common/dto/storefront-query.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateReviewDto {
  @IsString()
  productId: string;

  /** Rattachement à une ligne de commande : atteste l'achat vérifié. */
  @IsOptional()
  @IsString()
  orderItemId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  authorName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaIds?: string[];
}

export class ModerateReviewDto {
  @IsEnum(ReviewStatus)
  status: ReviewStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reply?: string;
}

export class ReviewQueryDto extends StorefrontQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  verifiedOnly?: boolean;
}

export class AdminReviewQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;

  @IsOptional()
  @IsString()
  productId?: string;
}

export class AddWishlistItemDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  wishlistName?: string;
}

export class BackInStockRequestDto {
  @IsString()
  variantId: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;
}

export class ReturnItemInputDto {
  @IsString()
  orderItemId: string;

  @Type(() => Number)
  @Min(0.001)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class CreateReturnDto {
  @IsString()
  orderId: string;

  @IsOptional()
  @IsEnum(ReturnResolution)
  resolution?: ReturnResolution;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customerComment?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnItemInputDto)
  items: ReturnItemInputDto[];
}

export class ProcessReturnDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminComment?: string;

  /** Remet les articles en stock : à refuser si l'article revient abîmé. */
  @IsOptional()
  @IsBoolean()
  restock?: boolean;

  /** Montant à rembourser ; par défaut, la valeur des articles retournés. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  refundAmountCents?: number;
}

export class AdjustLoyaltyDto {
  @IsString()
  userId: string;

  @Type(() => Number)
  @IsInt()
  points: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
