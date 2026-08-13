import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ReviewsService } from './services/reviews.service';
import { ReturnsService } from './services/returns.service';
import { LoyaltyService } from './services/loyalty.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import {
  AdjustLoyaltyDto,
  AdminReviewQueryDto,
  ModerateReviewDto,
  ProcessReturnDto,
} from './dto/engagement.dto';
import type { ReturnStatus } from '../generated/prisma/enums';

@Controller('admin')
@Roles('SUPPORT', 'MANAGER', 'ADMIN')
export class AdminEngagementController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly returns: ReturnsService,
    private readonly loyalty: LoyaltyService,
  ) {}

  // --- Modération des avis --------------------------------------------------

  @Get('reviews')
  listReviews(@Query() query: AdminReviewQueryDto) {
    return this.reviews.listForAdmin(query);
  }

  @Patch('reviews/:id')
  moderate(@Param('id') id: string, @Body() dto: ModerateReviewDto) {
    return this.reviews.moderate(id, dto);
  }

  // --- Retours --------------------------------------------------------------

  @Get('returns')
  listReturns(
    @Query() dto: PaginationDto,
    @Query('status') status?: ReturnStatus,
  ) {
    return this.returns.listForAdmin(dto, status);
  }

  @Get('returns/:id')
  getReturn(@Param('id') id: string) {
    return this.returns.findOne(id, { isStaff: true });
  }

  @Post('returns/:id/approve')
  approve(
    @Param('id') id: string,
    @Body('adminComment') adminComment?: string,
  ) {
    return this.returns.approve(id, adminComment);
  }

  @Post('returns/:id/reject')
  reject(@Param('id') id: string, @Body('adminComment') adminComment?: string) {
    return this.returns.reject(id, adminComment);
  }

  /** Réception du colis : remise en stock optionnelle puis remboursement. */
  @Post('returns/:id/receive')
  @Roles('MANAGER', 'ADMIN')
  receive(
    @Param('id') id: string,
    @Body() dto: ProcessReturnDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.returns.receive(id, dto, user.id);
  }

  // --- Fidélité -------------------------------------------------------------

  @Post('loyalty/adjust')
  @Roles('MANAGER', 'ADMIN')
  adjustLoyalty(@Body() dto: AdjustLoyaltyDto) {
    return this.loyalty.adjust(dto.userId, dto.points, dto.reason);
  }
}
