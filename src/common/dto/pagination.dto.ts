import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  /// Plafonné : sans limite haute, un client peut demander 100 000 produits.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  perPage = 24;

  get skip(): number {
    return (this.page - 1) * this.perPage;
  }
}

export type Paginated<T> = {
  items: T[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
};

export function paginate<T>(
  items: T[],
  total: number,
  dto: PaginationDto,
): Paginated<T> {
  return {
    items,
    meta: {
      page: dto.page,
      perPage: dto.perPage,
      total,
      totalPages: Math.ceil(total / dto.perPage) || 1,
    },
  };
}
