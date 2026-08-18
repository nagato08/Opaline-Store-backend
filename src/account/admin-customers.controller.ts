import { Controller, Get, Param, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CustomersService, type CustomerKind } from './customers.service';
import { Roles } from '../common/decorators/roles.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';

class ListCustomersDto extends PaginationDto {
  @IsOptional()
  @IsIn(['account', 'guest'])
  kind?: CustomerKind;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

/**
 * Clientèle, côté back-office.
 *
 * `SUPPORT` y a accès : c'est le rôle qui répond au téléphone et a besoin de
 * retrouver une commande à partir d'un nom. Aucune écriture n'est exposée ici
 * — modifier un client passe par les routes RGPD, tracées.
 */
@Controller('admin/customers')
@Roles('SUPPORT', 'MANAGER', 'ADMIN')
export class AdminCustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Query() dto: ListCustomersDto) {
    return this.customers.list(dto, { kind: dto.kind, search: dto.search });
  }

  /**
   * Le courriel sert de clé : c'est le seul identifiant qu'un acheteur invité
   * possède. Il arrive encodé dans l'URL.
   */
  @Get(':email')
  find(@Param('email') email: string) {
    return this.customers.findByEmail(decodeURIComponent(email));
  }
}
