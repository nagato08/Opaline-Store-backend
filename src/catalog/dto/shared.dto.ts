import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Locale } from '../../generated/prisma/enums';

/** Bloc de traduction générique : nom obligatoire, slug déduit si absent. */
export class TranslationDto {
  @IsEnum(Locale)
  locale: Locale;

  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  shortDescription?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(70)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  seoDescription?: string;
}

export class TranslationsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TranslationDto)
  translations: TranslationDto[];
}

export class PriceInputDto {
  @IsString()
  @MaxLength(3)
  currencyCode: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountCents: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  compareAtCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  costCents?: number;

  @IsOptional()
  @IsString()
  customerGroupId?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  minQuantity?: number;
}

export class ToggleDto {
  @IsBoolean()
  value: boolean;
}
