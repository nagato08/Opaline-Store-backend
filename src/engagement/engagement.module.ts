import { Module } from '@nestjs/common';
import { EngagementController } from './engagement.controller';
import { AdminEngagementController } from './admin-engagement.controller';
import { ReviewsService } from './services/reviews.service';
import { WishlistService } from './services/wishlist.service';
import { ReturnsService } from './services/returns.service';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [EngagementController, AdminEngagementController],
  providers: [ReviewsService, WishlistService, ReturnsService],
})
export class EngagementModule {}
