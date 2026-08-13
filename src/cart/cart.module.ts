import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartCalculatorService } from './cart-calculator.service';

@Module({
  controllers: [CartController],
  providers: [CartService, CartCalculatorService],
  exports: [CartService, CartCalculatorService],
})
export class CartModule {}
