import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { DashboardService } from './dashboard.service';
import { Roles } from '../common/decorators/roles.decorator';

class OverviewDto {
  /**
   * Périodes fermées plutôt qu'un entier libre : chaque valeur déclenche une
   * poignée d'agrégats sur toute la table des commandes, et `?days=100000`
   * mettrait la base à genoux depuis une simple URL.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([7, 30, 90])
  days = 7;
}

@Controller('admin/dashboard')
@Roles('MANAGER', 'ADMIN')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  overview(@Query() dto: OverviewDto) {
    return this.dashboard.overview(dto.days);
  }
}
