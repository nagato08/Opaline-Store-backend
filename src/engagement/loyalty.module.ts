import { Global, Module } from '@nestjs/common';
import { LoyaltyService } from './services/loyalty.service';

/**
 * Module dédié et global : les commandes créditent des points, et le module
 * d'engagement dépend des commandes. Isoler la fidélité évite une dépendance
 * circulaire entre les deux.
 */
@Global()
@Module({
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
