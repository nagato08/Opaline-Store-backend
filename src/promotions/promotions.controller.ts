import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PromotionsAdminService } from './promotions-admin.service';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  CreateCouponDto,
  CreatePromotionDto,
  GenerateCouponsDto,
  UpdatePromotionDto,
} from './dto/promotion.dto';

@Controller('admin/promotions')
@Roles('MANAGER', 'ADMIN')
export class PromotionsAdminController {
  constructor(private readonly promotions: PromotionsAdminService) {}

  @Get()
  list(@Query() dto: PaginationDto) {
    return this.promotions.list(dto);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.promotions.findOne(id);
  }

  @Get(':id/stats')
  stats(@Param('id') id: string) {
    return this.promotions.stats(id);
  }

  @Post()
  create(@Body() dto: CreatePromotionDto) {
    return this.promotions.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePromotionDto) {
    return this.promotions.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.promotions.remove(id);
  }

  @Get(':id/coupons')
  coupons(@Param('id') id: string, @Query() dto: PaginationDto) {
    return this.promotions.listCoupons(id, dto);
  }

  @Post(':id/coupons')
  createCoupon(@Param('id') id: string, @Body() dto: CreateCouponDto) {
    return this.promotions.createCoupon(id, dto);
  }

  @Post(':id/coupons/generate')
  generateCoupons(@Param('id') id: string, @Body() dto: GenerateCouponsDto) {
    return this.promotions.generateCoupons(id, dto);
  }

  @Delete('coupons/:couponId')
  deactivateCoupon(@Param('couponId') couponId: string) {
    return this.promotions.deactivateCoupon(couponId);
  }
}
