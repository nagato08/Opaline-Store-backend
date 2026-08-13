import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CartService } from './cart.service';
import { OptionalAuth } from '../common/decorators/public.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import {
  Storefront,
  type StorefrontContext,
} from '../common/decorators/storefront-context.decorator';
import { ApplyCouponDto } from '../promotions/dto/promotion.dto';
import {
  AddCartItemDto,
  SetCartContactDto,
  SetShippingMethodDto,
  UpdateCartItemDto,
} from './dto/cart.dto';

export const CART_COOKIE = 'cart_token';

/**
 * Panier accessible sans compte : le jeton est porté par un cookie, ou par
 * l'en-tête `X-Cart-Token` pour les clients non navigateur.
 */
@Controller('cart')
@OptionalAuth()
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  async get(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Storefront() context: StorefrontContext,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const cart = await this.cart.getOrCreate(
      this.token(request),
      context,
      user?.id,
    );
    this.setToken(response, cart.token);
    return this.cart.summary(cart.id, context);
  }

  @Post('items')
  async addItem(
    @Body() dto: AddCartItemDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Storefront() context: StorefrontContext,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const cart = await this.cart.getOrCreate(
      this.token(request),
      context,
      user?.id,
    );
    this.setToken(response, cart.token);
    return this.cart.addItem(cart.id, dto, context);
  }

  @Patch('items/:itemId')
  async updateItem(
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
    @Req() request: Request,
    @Storefront() context: StorefrontContext,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const cart = await this.cart.getOrCreate(
      this.token(request),
      context,
      user?.id,
    );
    return this.cart.updateItem(cart.id, itemId, dto.quantity, context);
  }

  @Delete('items/:itemId')
  async removeItem(
    @Param('itemId') itemId: string,
    @Req() request: Request,
    @Storefront() context: StorefrontContext,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const cart = await this.cart.getOrCreate(
      this.token(request),
      context,
      user?.id,
    );
    return this.cart.removeItem(cart.id, itemId, context);
  }

  @Delete()
  async clear(
    @Req() request: Request,
    @Storefront() context: StorefrontContext,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const cart = await this.cart.getOrCreate(
      this.token(request),
      context,
      user?.id,
    );
    return this.cart.clear(cart.id, context);
  }

  @Patch('contact')
  async setContact(
    @Body() dto: SetCartContactDto,
    @Req() request: Request,
    @Storefront() context: StorefrontContext,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const cart = await this.cart.getOrCreate(
      this.token(request),
      context,
      user?.id,
    );
    return this.cart.setContact(cart.id, dto, context);
  }

  @Get('shipping-options')
  async shippingOptions(
    @Req() request: Request,
    @Storefront() context: StorefrontContext,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const cart = await this.cart.getOrCreate(
      this.token(request),
      context,
      user?.id,
    );
    return this.cart.shippingOptions(cart.id, context);
  }

  @Patch('shipping-method')
  async setShippingMethod(
    @Body() dto: SetShippingMethodDto,
    @Req() request: Request,
    @Storefront() context: StorefrontContext,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const cart = await this.cart.getOrCreate(
      this.token(request),
      context,
      user?.id,
    );
    return this.cart.setShippingMethod(cart.id, dto, context);
  }

  @Post('coupons')
  async applyCoupon(
    @Body() dto: ApplyCouponDto,
    @Req() request: Request,
    @Storefront() context: StorefrontContext,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const cart = await this.cart.getOrCreate(
      this.token(request),
      context,
      user?.id,
    );
    return this.cart.applyCoupon(cart.id, dto.code, context);
  }

  @Delete('coupons/:code')
  async removeCoupon(
    @Param('code') code: string,
    @Req() request: Request,
    @Storefront() context: StorefrontContext,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const cart = await this.cart.getOrCreate(
      this.token(request),
      context,
      user?.id,
    );
    return this.cart.removeCoupon(cart.id, code, context);
  }

  /** Appelé par le front juste après connexion pour absorber le panier invité. */
  @Post('merge')
  async merge(
    @Req() request: Request,
    @Storefront() context: StorefrontContext,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.cart.merge(this.token(request) ?? '', user.id, context);
  }

  private token(request: Request): string | undefined {
    return (
      request.header('x-cart-token') ??
      (request.cookies as Record<string, string> | undefined)?.[CART_COOKIE]
    );
  }

  private setToken(response: Response, token: string): void {
    response.cookie(CART_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86_400_000,
    });
    // Exposé aussi en en-tête pour les clients qui ne gèrent pas les cookies.
    response.setHeader('X-Cart-Token', token);
  }
}
