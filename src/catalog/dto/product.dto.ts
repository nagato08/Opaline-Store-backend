import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  Locale,
  ProductStatus,
  ProductType,
} from '../../generated/prisma/enums';
import { PriceInputDto, TranslationDto } from './shared.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { StorefrontQueryDto } from '../../common/dto/storefront-query.dto';

export class VariantOptionValueDto {
  @IsString()
  optionValueId: string;
}

export class CreateVariantDto {
  @IsString()
  @MaxLength(64)
  sku: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  position?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  weightGrams?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lengthMm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  widthMm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  heightMm?: number;

  /** Meuble ou colis hors gabarit : impose un transporteur spécialisé. */
  @IsOptional()
  @IsBoolean()
  isOversized?: boolean;

  /** Vente au poids ou au volume : la quantité devient décimale. */
  @IsOptional()
  @IsBoolean()
  isSoldByMeasure?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  measureUnit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stepQuantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minQuantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  netContent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  netContentUnit?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  optionValueIds?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceInputDto)
  prices: PriceInputDto[];
}

export class FoodDetailTranslationDto {
  @IsEnum(Locale)
  locale: Locale;

  @IsOptional()
  @IsString()
  ingredients?: string;

  @IsOptional()
  @IsString()
  usageAdvice?: string;

  @IsOptional()
  @IsString()
  storageAdvice?: string;

  @IsOptional()
  @IsString()
  legalNotice?: string;
}

export class FoodDetailDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergens?: string[];

  @IsOptional()
  nutrition?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  storageTempMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  storageTempMax?: number;

  @IsOptional()
  @IsBoolean()
  requiresColdChain?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  shelfLifeDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  originCountry?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  alcoholDegree?: number;

  /** Mentions légales traduites : ingrédients, conseils de conservation. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FoodDetailTranslationDto)
  translations?: FoodDetailTranslationDto[];
}

export class CreateProductDto {
  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsString()
  brandId?: string;

  @IsOptional()
  @IsString()
  taxClassId?: string;

  @IsOptional()
  @IsBoolean()
  requiresShipping?: boolean;

  @IsOptional()
  @IsBoolean()
  isPerishable?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresSerial?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  hsCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryOfOrigin?: string;

  /** Éco-participation DEEE / mobilier, affichée séparément du prix. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ecoTaxCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  warrantyMonths?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  energyLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  dangerousGoods?: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  optionTypeIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaIds?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TranslationDto)
  translations: TranslationDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variants: CreateVariantDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => FoodDetailDto)
  foodDetail?: FoodDetailDto;
}

export class UpdateProductDto {
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsString()
  brandId?: string | null;

  @IsOptional()
  @IsString()
  taxClassId?: string | null;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresShipping?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ecoTaxCents?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mediaIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TranslationDto)
  translations?: TranslationDto[];
}

export enum ProductSort {
  NEWEST = 'newest',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
  NAME_ASC = 'name_asc',
  BEST_SELLING = 'best_selling',
  RATING = 'rating',
}

export class ProductQueryDto extends StorefrontQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  categorySlug?: string;

  @IsOptional()
  @IsString()
  collectionSlug?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Type(() => String)
  brandIds?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPriceCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPriceCents?: number;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  inStockOnly?: boolean;

  @IsOptional()
  @IsEnum(ProductSort)
  sort?: ProductSort;
}

export class AdminProductQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsOptional()
  @IsString()
  brandId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;
}
