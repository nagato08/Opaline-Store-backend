import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { IsDefined, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { SettingsService } from './settings.service';
import { Roles } from '../common/decorators/roles.decorator';

class ListSettingsDto {
  /** Sans filtre, tous les groupes remontent. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  group?: string;
}

class SetSettingDto {
  /**
   * `Setting.value` est une colonne JSON : un réglage peut être un booléen,
   * un nombre, une chaîne, un tableau ou un objet.
   *
   * Deux décorateurs, et aucun n'est superflu :
   *
   * - `@IsDefined()` parce que `forbidNonWhitelisted` supprime puis rejette
   *   toute propriété sans décorateur **de validation**. `@Type()` seul ne
   *   compte pas — c'est de la transformation — et la requête repartait en
   *   400 « property value should not exist ».
   * - `@Type(() => Object)` parce que `enableImplicitConversion` réduit
   *   sinon un objet ou un tableau à une valeur vide, le piège déjà rencontré
   *   sur les actions de promotion.
   */
  @IsDefined()
  @Type(() => Object)
  value: unknown;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  group?: string;
}

/**
 * Réglages de la boutique.
 *
 * Réservé à `ADMIN` et non au personnel : ces valeurs décident du régime de
 * taxe et de l'identité affichée sur les factures. Une erreur ici ne se voit
 * pas tout de suite et se corrige mal une fois des commandes passées.
 */
@Controller('admin/settings')
@Roles('ADMIN')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  list(@Query() dto: ListSettingsDto) {
    return this.settings.list(dto.group);
  }

  @Patch(':key')
  async set(@Param('key') key: string, @Body() dto: SetSettingDto) {
    await this.settings.set(key, dto.value, dto.group);
    return this.settings.find(key);
  }
}
