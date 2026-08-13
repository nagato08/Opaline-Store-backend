import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CheckoutService } from './checkout.service';
import { PaymentsService } from '../payments/payments.service';
import { OptionalAuth } from '../common/decorators/public.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import {
  Storefront,
  type StorefrontContext,
} from '../common/decorators/storefront-context.decorator';
import { PlaceOrderDto } from './dto/checkout.dto';
import { CART_COOKIE } from '../cart/cart.controller';

@Controller('checkout')
@OptionalAuth()
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly payments: PaymentsService,
  ) {}

  @Get('payment-methods')
  paymentMethods() {
    return this.payments.availableProviders();
  }

  /**
   * Création de commande. Protégée par `Idempotency-Key` : un double envoi
   * renvoie la première commande au lieu d'en créer une seconde.
   */
  @Post('orders')
  @Idempotent('checkout.place-order')
  place(
    @Body() dto: PlaceOrderDto,
    @Req() request: Request,
    @Storefront() context: StorefrontContext,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const token =
      request.header('x-cart-token') ??
      (request.cookies as Record<string, string> | undefined)?.[CART_COOKIE];

    return this.checkout.placeOrder(token, dto, context, user?.id, {
      ip: request.ip,
      userAgent: request.header('user-agent'),
    });
  }
}
