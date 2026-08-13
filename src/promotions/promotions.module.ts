import { Global, Module } from '@nestjs/common';
import { RuleEngineService } from './rule-engine.service';
import { PromotionsService } from './promotions.service';
import { PromotionsAdminService } from './promotions-admin.service';
import { PromotionsAdminController } from './promotions.controller';

/**
 * Le moteur de règles est exporté globalement : les campagnes d'affichage
 * (bannières, popups planifiés) réutiliseront le même évaluateur.
 */
@Global()
@Module({
  controllers: [PromotionsAdminController],
  providers: [RuleEngineService, PromotionsService, PromotionsAdminService],
  exports: [RuleEngineService, PromotionsService],
})
export class PromotionsModule {}
