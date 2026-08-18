import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { InventoryService } from './inventory.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { StockMovementType } from '../generated/prisma/enums';

class AdjustStockDto {
  @IsString()
  variantId: string;

  @IsString()
  locationId: string;

  /** Signée : négative pour une sortie (casse, perte, péremption). */
  @Type(() => Number)
  @IsNumber()
  quantity: number;

  @IsEnum(StockMovementType)
  type: StockMovementType;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  lotNumber?: string;

  @IsOptional()
  @IsString()
  expiresAt?: string;
}

class ListStockDto {
  @IsOptional()
  @IsIn(['out', 'low', 'ok'])
  level?: 'out' | 'low' | 'ok';

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;
}

@Controller('admin/inventory')
@Roles('FULFILLMENT', 'MANAGER', 'ADMIN')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list(@Query() dto: ListStockDto) {
    return this.inventory.listStock(dto);
  }

  @Get('locations')
  locations() {
    return this.inventory.listLocations();
  }

  @Post('adjust')
  adjust(@Body() dto: AdjustStockDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventory.adjust({ ...dto, actorId: user.id });
  }

  @Get('movements/:variantId')
  movements(@Param('variantId') variantId: string) {
    return this.inventory.listMovements(variantId);
  }

  @Get('expiring')
  expiring(@Query('days') days?: string) {
    return this.inventory.expiringLots(days ? parseInt(days, 10) : 30);
  }
}
