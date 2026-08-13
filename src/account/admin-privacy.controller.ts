import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PrivacyService } from './privacy.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import type { DataRequestStatus } from '../generated/prisma/enums';

/**
 * Traitement des demandes RGPD. Réservé aux administrateurs : l'effacement
 * d'un compte est irréversible et modifie des données comptables.
 */
@Controller('admin/privacy')
@Roles('ADMIN')
export class AdminPrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('data-requests')
  list(@Query('status') status?: DataRequestStatus) {
    return this.privacy.listAllRequests(status);
  }

  @Post('data-requests/:id/process')
  process(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.privacy.process(id, user.id);
  }
}
