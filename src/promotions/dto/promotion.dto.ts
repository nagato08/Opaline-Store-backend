import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  Locale,
  PromotionScope,
  PromotionStatus,
} from '../../generated/prisma/enums';

export class PromotionTranslationDto {
  @IsEnum(Locale)
  locale: Locale;

  @IsString()
  @MaxLength(120)
  label: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreatePromotionDto {
  @IsString()
  @MaxLength(60)
  code: string;

  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(PromotionScope)
  scope?: PromotionScope;

  @IsOptional()
  @IsEnum(PromotionStatus)
  status?: PromotionStatus;

  /** Arbre de conditions du moteur de règles. */
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  conditions?: Record<string, unknown>;

  /**
   * Liste d'actions : remise en pourcentage, montant fixe, port offert, X+Y.
   * `@Type(() => Object)` est indispensable : sans type explicite, la
   * conversion implicite du ValidationPipe transforme chaque objet du tableau
   * en tableau vide.
   */
  @IsArray()
  @Type(() => Object)
  actions: Record<string, unknown>[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number;

  /** Bloque le cumul avec toute autre promotion. */
  @IsOptional()
  @IsBoolean()
  isExclusive?: boolean;

  /** Fausse pour une offre qui ne s'active que par saisie d'un code. */
  @IsOptional()
  @IsBoolean()
  isAutomatic?: boolean;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perCustomerLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minimumCents?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  customerGroupIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PromotionTranslationDto)
  translations?: PromotionTranslationDto[];
}

export class UpdatePromotionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(PromotionStatus)
  status?: PromotionStatus;

  @IsOptional()
  @IsObject()
  @Type(() => Object)
  conditions?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @Type(() => Object)
  actions?: Record<string, unknown>[];

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
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minimumCents?: number;
}

export class CreateCouponDto {
  @IsString()
  @MaxLength(40)
  code: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class GenerateCouponsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  prefix?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usageLimit?: number;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class ApplyCouponDto {
  @IsString()
  @MaxLength(40)
  code: string;
}
