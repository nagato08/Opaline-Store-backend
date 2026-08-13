import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { InventoryService } from '../inventory/inventory.service';
import { CartService } from '../cart/cart.service';

export const MAINTENANCE_QUEUE = 'maintenance';

export type MaintenanceJob =
  'release-expired-reservations' | 'flag-abandoned-carts';

/**
 * Tâches de fond. La libération des réservations expirées est critique :
 * sans elle, un panier abandonné en cours de paiement bloque le stock
 * indéfiniment et le produit apparaît en rupture à tort.
 */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly inventory: InventoryService,
    private readonly cart: CartService,
  ) {
    super();
  }

  async process(job: Job<unknown, unknown, MaintenanceJob>): Promise<unknown> {
    switch (job.name) {
      case 'release-expired-reservations': {
        const released = await this.inventory.releaseExpired();
        return { released };
      }
      case 'flag-abandoned-carts': {
        const flagged = await this.cart.flagAbandoned();
        if (flagged > 0) {
          this.logger.log(`${flagged} panier(s) marqué(s) abandonné(s).`);
        }
        return { flagged };
      }
      default:
        this.logger.warn(`Tâche inconnue : ${String(job.name)}`);
        return null;
    }
  }
}
