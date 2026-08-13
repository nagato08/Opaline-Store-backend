import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class AddCartItemDto {
  @IsString()
  variantId: string;

  /** Décimale : l'alimentaire se vend au poids (0,5 kg). */
  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity: number;

  @IsOptional()
  customization?: Record<string, unknown>;
}

export class UpdateCartItemDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity: number;
}

export class AddressInputDto {
  @IsString()
  @MaxLength(80)
  firstName: string;

  @IsString()
  @MaxLength(80)
  lastName: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  company?: string;

  @IsString()
  @MaxLength(180)
  line1: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  line2?: string;

  @IsString()
  @MaxLength(20)
  postalCode: string;

  @IsString()
  @MaxLength(100)
  city: string;

  /** Obligatoire aux États-Unis et au Canada pour calculer la taxe locale. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  region?: string;

  @IsString()
  @Length(2, 2)
  countryCode: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  vatNumber?: string;

  /** Étage, digicode, ascenseur : indispensable pour livrer un meuble. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class SetCartContactDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressInputDto)
  shippingAddress?: AddressInputDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressInputDto)
  billingAddress?: AddressInputDto;

  @IsOptional()
  @IsBoolean()
  billingSameAsShipping?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  customerNote?: string;
}

export class SetShippingMethodDto {
  @IsString()
  methodId: string;

  @IsOptional()
  @IsString()
  slotId?: string;
}
