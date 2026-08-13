import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { StorefrontQueryDto } from '../../common/dto/storefront-query.dto';

/**
 * Un filtre à valeur unique arrive sous forme de chaîne (`?brandIds=x`) et non
 * de tableau : sans normalisation, la validation le rejette alors que c'est
 * le cas le plus courant.
 */
const toArray = ({ value }: { value: unknown }): unknown =>
  value === undefined || Array.isArray(value) ? value : [value];

export class SearchQueryDto extends StorefrontQueryDto {
  /** Terme saisi. Vide = navigation à facettes sans recherche. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
  categoryIds?: string[];

  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @IsString({ each: true })
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
  @Type(() => Boolean)
  @IsBoolean()
  inStockOnly?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;
}

export class SuggestQueryDto {
  @IsString()
  @MaxLength(120)
  q: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  locale?: string;
}
