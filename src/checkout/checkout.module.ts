import { Module } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { AdminCheckoutController } from './admin-checkout.controller';
import { CheckoutService } from './checkout.service';
import { CartModule } from '../cart/cart.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [CartModule, OrdersModule],
  controllers: [CheckoutController, AdminCheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}
