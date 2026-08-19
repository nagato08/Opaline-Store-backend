import { Body, Controller, Post } from '@nestjs/common';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CheckoutService } from './checkout.service';
import { Roles } from '../common/decorators/roles.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';

class CreateManualOrderDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(80)
  firstName: string;

  @IsString()
  @MaxLength(80)
  lastName: string;

  @IsString()
  @MaxLength(180)
  line1: string;

  @IsString()
  @MaxLength(20)
  postalCode: string;

  @IsString()
  @MaxLength(100)
  city: string;

  @IsString()
  @Length(2, 2)
  countryCode: string;

  @IsString()
  @MaxLength(64)
  sku: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  customerNote?: string;
}

/**
 * Vente par téléphone ou au comptoir, saisie par le personnel.
 *
 * Séparé du `CheckoutController` public : ce dernier vit dans le même module
 * pour réutiliser `CheckoutService`, mais cette route n'est jamais ouverte au
 * client — elle crée une commande sans passage par le panier du navigateur.
 */
@Controller('admin/checkout')
@Roles('SUPPORT', 'FULFILLMENT', 'MANAGER', 'ADMIN')
export class AdminCheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('manual-order')
  @Idempotent('checkout.manual-order')
  create(@Body() dto: CreateManualOrderDto) {
    return this.checkout.createManualOrder(dto);
  }
}
