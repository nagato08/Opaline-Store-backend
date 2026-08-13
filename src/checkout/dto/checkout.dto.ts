import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaymentProvider } from '../../generated/prisma/enums';
import { AddressInputDto } from '../../cart/dto/cart.dto';

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

  @IsString()
  shippingMethodId: string;

  @IsOptional()
  @IsString()
  deliverySlotId?: string;

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
