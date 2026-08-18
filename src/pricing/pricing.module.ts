import { Global, Module } from '@nestjs/common';
import { PriceResolverService } from './price-resolver.service';
import { TaxService } from './tax.service';
import { SettingsService } from './settings.service';
import { AdminSettingsController } from './admin-settings.controller';

/**
 * Prix, taxes et réglages boutique : consommés par le catalogue, le panier,
 * le checkout et les commandes. Global pour éviter de le réimporter partout.
 */
@Global()
@Module({
  controllers: [AdminSettingsController],
  providers: [PriceResolverService, TaxService, SettingsService],
  exports: [PriceResolverService, TaxService, SettingsService],
})
export class PricingModule {}
