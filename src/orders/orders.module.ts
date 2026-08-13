import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrderNumberService } from './order-number.service';
import { OrderAccessService } from './order-access.service';
import { AdminOrdersController, OrdersController } from './orders.controller';

@Module({
  controllers: [OrdersController, AdminOrdersController],
  providers: [OrdersService, OrderNumberService, OrderAccessService],
  exports: [OrdersService, OrderNumberService, OrderAccessService],
})
export class OrdersModule {}
