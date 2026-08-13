import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ReviewsService } from './services/reviews.service';
import { WishlistService } from './services/wishlist.service';
import { LoyaltyService } from './services/loyalty.service';
import { ReturnsService } from './services/returns.service';
import { OrderAccessService } from '../orders/order-access.service';
import { OptionalAuth, Public } from '../common/decorators/public.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import {
  Storefront,
  type StorefrontContext,
} from '../common/decorators/storefront-context.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  AddWishlistItemDto,
  BackInStockRequestDto,
  CreateReturnDto,
  CreateReviewDto,
  ReviewQueryDto,
} from './dto/engagement.dto';

@Controller()
export class EngagementController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly wishlist: WishlistService,
    private readonly loyalty: LoyaltyService,
    private readonly returns: ReturnsService,
    private readonly orderAccess: OrderAccessService,
  ) {}

  // --- Avis -----------------------------------------------------------------

  @OptionalAuth()
  @Get('products/:productId/reviews')
  productReviews(
    @Param('productId') productId: string,
    @Query() query: ReviewQueryDto,
  ) {
    return this.reviews.listForProduct(productId, query);
  }

  @OptionalAuth()
  @Post('reviews')
  createReview(
    @Body() dto: CreateReviewDto,
    @Storefront() context: StorefrontContext,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.reviews.create(dto, user?.id ?? null, context.locale);
  }

  @Public()
  @Post('reviews/:id/helpful')
  markHelpful(@Param('id') id: string) {
    return this.reviews.markHelpful(id);
  }

  @Delete('reviews/:id')
  removeReview(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reviews.remove(id, user.id, user.role);
  }

  // --- Liste d'envies -------------------------------------------------------

  @Get('wishlist')
  getWishlist(
    @CurrentUser() user: AuthenticatedUser,
    @Storefront() context: StorefrontContext,
  ) {
    return this.wishlist.get(user.id, context);
  }

  @Post('wishlist/items')
  addToWishlist(
    @Body() dto: AddWishlistItemDto,
    @CurrentUser() user: AuthenticatedUser,
    @Storefront() context: StorefrontContext,
  ) {
    return this.wishlist.addItem(user.id, dto, context);
  }

  @Delete('wishlist/items/:itemId')
  removeFromWishlist(
    @Param('itemId') itemId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Storefront() context: StorefrontContext,
  ) {
    return this.wishlist.removeItem(user.id, itemId, context);
  }

  @Post('wishlist/share')
  shareWishlist(@CurrentUser() user: AuthenticatedUser) {
    return this.wishlist.share(user.id);
  }

  @Public()
  @Get('wishlist/shared/:token')
  sharedWishlist(
    @Param('token') token: string,
    @Storefront() context: StorefrontContext,
  ) {
    return this.wishlist.findShared(token, context);
  }

  /** Alerte de réapprovisionnement, ouverte aux visiteurs sans compte. */
  @OptionalAuth()
  @Post('back-in-stock')
  requestBackInStock(
    @Body() dto: BackInStockRequestDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.wishlist.requestBackInStock(dto, user?.id);
  }

  // --- Fidélité -------------------------------------------------------------

  @Get('loyalty')
  loyaltyBalance(@CurrentUser() user: AuthenticatedUser) {
    return this.loyalty.balance(user.id);
  }

  @Get('loyalty/history')
  loyaltyHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: PaginationDto,
  ) {
    return this.loyalty.history(user.id, dto);
  }

  // --- Retours --------------------------------------------------------------

  @Post('returns')
  createReturn(
    @Body() dto: CreateReturnDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.returns.create(dto, { userId: user.id });
  }

  /** Retour pour un achat sans compte, autorisé par le jeton reçu par email. */
  @Public()
  @Post('returns/guest')
  createGuestReturn(
    @Body() dto: CreateReturnDto,
    @Query('token') token: string,
  ) {
    return this.returns.create(dto, {
      guestOrderId: this.orderAccess.verifyToken(token),
    });
  }

  /** Suivi d'un retour sans compte, via le même jeton. */
  @Public()
  @Get('returns/guest/:id')
  getGuestReturn(@Param('id') id: string, @Query('token') token: string) {
    return this.returns.findOne(id, {
      guestOrderId: this.orderAccess.verifyToken(token),
    });
  }

  @Get('returns')
  listReturns(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: PaginationDto,
  ) {
    return this.returns.listForCustomer(user.id, dto);
  }

  @Get('returns/:id')
  getReturn(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.returns.findOne(id, {
      userId: user.id,
      isStaff: user.role !== 'CUSTOMER',
    });
  }
}
