import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  MAINTENANCE_QUEUE,
  MaintenanceProcessor,
} from './maintenance.processor';
import { CartModule } from '../cart/cart.module';

@Module({
  imports: [BullModule.registerQueue({ name: MAINTENANCE_QUEUE }), CartModule],
  providers: [MaintenanceProcessor],
})
export class JobsModule implements OnApplicationBootstrap {
  constructor(@InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue) {}

  /**
   * Les tâches répétées sont (ré)enregistrées au démarrage avec un identifiant
   * stable : relancer l'application ne crée pas de doublon de planification.
   */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'release-expired-reservations',
      { pattern: '* * * * *' },
      {
        name: 'release-expired-reservations',
        opts: { removeOnComplete: true },
      },
    );

    await this.queue.upsertJobScheduler(
      'flag-abandoned-carts',
      { pattern: '*/15 * * * *' },
      { name: 'flag-abandoned-carts', opts: { removeOnComplete: true } },
    );
  }
}
