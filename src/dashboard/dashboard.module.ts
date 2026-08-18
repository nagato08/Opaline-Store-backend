import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * Agrégats de pilotage. `InventoryService` est fourni globalement par
 * `InventoryModule`, il n'y a donc rien à importer ici.
 */
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
