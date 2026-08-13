import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  AttributeValueType,
  CollectionType,
  Locale,
} from '../../generated/prisma/enums';
import { TranslationDto } from './shared.dto';

export class BrandTranslationDto {
  @IsEnum(Locale)
  locale: Locale;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateBrandDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  logoId?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BrandTranslationDto)
  translations?: BrandTranslationDto[];
}

export class UpdateBrandDto extends CreateBrandDto {
  @IsOptional()
  @IsString()
  declare name: string;
}

export class LocalizedLabelDto {
  @IsEnum(Locale)
  locale: Locale;

  @IsString()
  @MaxLength(120)
  label: string;
}

export class CreateOptionTypeDto {
  @IsString()
  @MaxLength(60)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  displayAs?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  position?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocalizedLabelDto)
  translations: LocalizedLabelDto[];
}

export class CreateOptionValueDto {
  @IsString()
  @MaxLength(60)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(9)
  hexColor?: string;

  @IsOptional()
  @IsString()
  imageId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  position?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocalizedLabelDto)
  translations: LocalizedLabelDto[];
}

export class CreateAttributeDto {
  @IsString()
  @MaxLength(60)
  code: string;

  @IsOptional()
  @IsEnum(AttributeValueType)
  valueType?: AttributeValueType;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @IsBoolean()
  isFilterable?: boolean;

  @IsOptional()
  @IsBoolean()
  isComparable?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  position?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LocalizedLabelDto)
  translations: LocalizedLabelDto[];
}

export class ProductAttributeValueDto {
  @IsString()
  attributeId: string;

  @IsOptional()
  @IsEnum(Locale)
  locale?: Locale;

  @IsOptional()
  @IsString()
  valueText?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  valueNumber?: number;

  @IsOptional()
  @IsBoolean()
  valueBoolean?: boolean;

  @IsOptional()
  @IsDateString()
  valueDate?: string;
}

export class SetProductAttributesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductAttributeValueDto)
  values: ProductAttributeValueDto[];
}

export class CreateCollectionDto {
  @IsString()
  @MaxLength(60)
  code: string;

  @IsOptional()
  @IsEnum(CollectionType)
  type?: CollectionType;

  /** Règles d'appartenance quand la collection est automatique. */
  @IsOptional()
  rules?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  imageId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  startsAt?: string;

  @IsOptional()
  @IsString()
  endsAt?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TranslationDto)
  translations: TranslationDto[];
}

export class SetCollectionProductsDto {
  @IsArray()
  @IsString({ each: true })
  productIds: string[];
}
