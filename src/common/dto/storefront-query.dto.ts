import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { PaginationDto } from './pagination.dto';

/**
 * Paramètres de contexte acceptés sur toutes les routes boutique. Ils sont lus
 * par le décorateur `@Storefront` ; les déclarer ici évite que la validation
 * stricte (`forbidNonWhitelisted`) ne les rejette.
 */
export class StorefrontQueryDto extends PaginationDto {
  @IsOptional()
  @IsIn(['FR', 'EN', 'fr', 'en'])
  locale?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;
}
