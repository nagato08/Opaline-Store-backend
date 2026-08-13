import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  StreamableFile,
} from '@nestjs/common';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { Request } from 'express';
import { AddressesService } from './addresses.service';
import { PrivacyService } from './privacy.service';
import { AddressInputDto } from '../cart/dto/cart.dto';
import { OptionalAuth, Public } from '../common/decorators/public.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { ConsentType, DataRequestType } from '../generated/prisma/enums';

class SaveAddressDto extends AddressInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string;
}

class RecordConsentDto {
  @IsEnum(ConsentType)
  type: ConsentType;

  @IsBoolean()
  isGranted: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  version?: string;
}

class DataRequestDto {
  @IsEnum(DataRequestType)
  type: DataRequestType;
}

@Controller('account')
export class AccountController {
  constructor(
    private readonly addresses: AddressesService,
    private readonly privacy: PrivacyService,
  ) {}

  // --- Carnet d'adresses ----------------------------------------------------

  @Get('addresses')
  listAddresses(@CurrentUser() user: AuthenticatedUser) {
    return this.addresses.list(user.id);
  }

  @Post('addresses')
  createAddress(
    @Body() dto: SaveAddressDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.addresses.create(user.id, dto);
  }

  @Patch('addresses/:id')
  updateAddress(
    @Param('id') id: string,
    @Body() dto: SaveAddressDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.addresses.update(user.id, id, dto);
  }

  @Post('addresses/:id/default-shipping')
  setDefaultShipping(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.addresses.setDefault(user.id, id, 'SHIPPING');
  }

  @Post('addresses/:id/default-billing')
  setDefaultBilling(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.addresses.setDefault(user.id, id, 'BILLING');
  }

  @Delete('addresses/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAddress(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.addresses.remove(user.id, id);
  }

  // --- Consentements et données personnelles --------------------------------

  /**
   * Enregistrement d'un consentement, y compris pour un visiteur anonyme :
   * la bannière cookies s'affiche avant toute connexion.
   */
  @Public()
  @OptionalAuth()
  @Post('consents')
  recordConsent(
    @Body() dto: RecordConsentDto,
    @Req() request: Request,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.privacy.recordConsent({
      ...dto,
      userId: user?.id,
      ip: request.ip,
      userAgent: request.header('user-agent'),
    });
  }

  @Get('consents')
  consentHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.privacy.consentHistory(user.id);
  }

  @Post('data-requests')
  requestData(
    @Body() dto: DataRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.privacy.requestData(user.id, dto.type);
  }

  @Get('data-requests')
  listDataRequests(@CurrentUser() user: AuthenticatedUser) {
    return this.privacy.listRequests(user.id);
  }

  /**
   * Téléchargement de l'export. Le fichier vit hors du répertoire servi en
   * statique : il contient tout l'historique d'achat.
   */
  @Get('data-requests/:id/download')
  @Header('Content-Type', 'application/json')
  @Header('Content-Disposition', 'attachment; filename="mes-donnees.json"')
  async download(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return new StreamableFile(await this.privacy.readExport(id, user.id));
  }
}
