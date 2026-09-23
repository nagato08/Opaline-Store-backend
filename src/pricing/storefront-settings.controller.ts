import { Controller, Get } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { Public } from '../common/decorators/public.decorator';

/**
 * Réglages lisibles par la boutique.
 *
 * Séparé de `AdminSettingsController`, qui est réservé à `ADMIN` et expose
 * tout : le régime de taxe, les paramètres de fidélité, le préfixe des numéros
 * de commande. Cette route-ci ne rend qu'une liste blanche, et la sépare
 * physiquement pour qu'on ne puisse pas l'élargir par inadvertance en
 * retouchant l'autre.
 *
 * Sans elle, l'enseigne du client restait écrite en dur dans le code de la
 * boutique — ce que les conventions du projet interdisent explicitement.
 */
@Controller('settings')
export class StorefrontSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Public()
  @Get()
  read() {
    return this.settings.publicSettings();
  }
}
