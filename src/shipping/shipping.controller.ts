import { Controller, Get, Param, Query } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';

@Controller()
export class ShippingController {
  constructor(private readonly shipping: ShippingService) {}

  @Public()
  @Get('shipping/slots/:methodId')
  slots(@Param('methodId') methodId: string, @Query('days') days?: string) {
    return this.shipping.availableSlots(
      methodId,
      new Date(),
      days ? parseInt(days, 10) : 14,
    );
  }

  @Get('admin/shipping/zones')
  @Roles('MANAGER', 'ADMIN')
  zones() {
    return this.shipping.listZones();
  }
}
