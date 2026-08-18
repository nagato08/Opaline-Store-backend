import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OrdersService } from './orders.service';
import { OrderAccessService } from './order-access.service';
import { Public } from '../common/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { PaymentsService } from '../payments/payments.service';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { PaginationDto } from '../common/dto/pagination.dto';
import { OrderStatus } from '../generated/prisma/enums';

class CancelOrderDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

class TransitionDto {
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}

class RefundDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountCents: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

class ShipmentItemDto {
  @IsString()
  orderItemId: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity: number;
}

class CreateShipmentDto {
  @IsOptional()
  @IsString()
  carrierId?: string;

  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShipmentItemDto)
  items: ShipmentItemDto[];
}

class AdminOrderQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  lotNumber?: string;
}

class TrackOrderDto {
  @IsString()
  @MaxLength(40)
  number: string;

  @IsEmail()
  email: string;
}

class ClaimOrderDto {
  @IsOptional()
  @IsString()
  token?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  number?: string;
}

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly access: OrderAccessService,
  ) {}

  /**
   * Suivi d'une commande passée sans compte, via le lien signé reçu par email.
   */
  @Public()
  @Get('track')
  trackByToken(@Query('token') token: string) {
    return this.orders.findOneInternal(this.access.verifyToken(token));
  }

  /**
   * Suivi par numéro + email. Fortement limité en fréquence : c'est la seule
   * route qui accepte des identifiants devinables.
   */
  @Public()
  @Post('track')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  async trackByNumber(@Body() dto: TrackOrderDto) {
    const orderId = await this.access.resolveByNumberAndEmail(
      dto.number,
      dto.email,
    );
    return this.orders.findOneInternal(orderId);
  }

  /**
   * Rattachement d'une commande invité au compte qui vient d'être créé.
   * Proposé juste après l'achat : c'est ce qui convertit sans bloquer la vente.
   */
  @Post('claim')
  @HttpCode(HttpStatus.OK)
  async claim(
    @Body() dto: ClaimOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const orderId = dto.token
      ? this.access.verifyToken(dto.token)
      : await this.access.resolveByNumberAndEmail(dto.number ?? '', user.email);

    return this.access.claim(orderId, user.id, user.email);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() dto: PaginationDto) {
    return this.orders.listForCustomer(user.id, dto);
  }

  @Get(':number')
  detail(
    @Param('number') number: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.findByNumber(number, {
      userId: user.id,
      role: user.role,
    });
  }

  @Post(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.cancelByCustomer(id, user.id, dto.reason);
  }
}

@Controller('admin/orders')
@Roles('SUPPORT', 'FULFILLMENT', 'MANAGER', 'ADMIN')
export class AdminOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
  ) {}

  @Get()
  list(@Query() dto: AdminOrderQueryDto) {
    return this.orders.listForAdmin(dto, {
      status: dto.status,
      search: dto.search,
      email: dto.email,
      lotNumber: dto.lotNumber,
    });
  }

  @Get('payment-providers')
  providers() {
    return this.payments.availableProviders();
  }

  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.findOne(id, { role: user.role });
  }

  /**
   * Encaissement constaté à la main : virement reçu, espèces à la livraison.
   * Réservé aux rôles habilités à toucher à l'argent.
   */
  @Post(':id/mark-paid')
  @Roles('MANAGER', 'ADMIN')
  markPaid(@Param('id') id: string) {
    return this.orders.markAsPaid(id);
  }

  @Patch(':id/status')
  transition(
    @Param('id') id: string,
    @Body() dto: TransitionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.transition(id, dto.status, user.id, dto.reason);
  }

  @Post(':id/refund')
  @Roles('MANAGER', 'ADMIN')
  refund(
    @Param('id') id: string,
    @Body() dto: RefundDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.refund(id, dto.amountCents, user.id, dto.reason);
  }

  @Post(':id/shipments')
  ship(@Param('id') id: string, @Body() dto: CreateShipmentDto) {
    return this.orders.createShipment(id, dto);
  }
}
