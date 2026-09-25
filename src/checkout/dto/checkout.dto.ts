import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaymentProvider } from '../../generated/prisma/enums';
import { AddressInputDto } from '../../cart/dto/cart.dto';

export class CheckoutShipmentDto {
  @IsIn(['COLD_CHAIN', 'OVERSIZED', 'STANDARD'])
  constraint: string;

  @IsString()
  methodId: string;

  @IsOptional()
  @IsString()
  slotId?: string;
}

export class PlaceOrderDto {
  @IsEmail()
  email: string;

  @ValidateNested()
  @Type(() => AddressInputDto)
  shippingAddress: AddressInputDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressInputDto)
  billingAddress?: AddressInputDto;

  @IsOptional()
  @IsBoolean()
  billingSameAsShipping?: boolean;

  /* Facultatif depuis l'expédition multiple : un panier scindé porte un mode
     par groupe dans `shipments`. L'un des deux est exigé, jamais les deux —
     la vérification se fait dans le service, où les totaux sont connus. */
  @IsOptional()
  @IsString()
  shippingMethodId?: string;

  @IsOptional()
  @IsString()
  deliverySlotId?: string;

  /** Un mode par groupe physique, pour une commande en plusieurs colis. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutShipmentDto)
  shipments?: CheckoutShipmentDto[];

  @IsEnum(PaymentProvider)
  paymentProvider: PaymentProvider;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  customerNote?: string;

  /** Consentement CGV : horodaté et conservé comme preuve. */
  @IsBoolean()
  acceptsTerms: boolean;

  @IsOptional()
  @IsBoolean()
  acceptsMarketing?: boolean;
}
