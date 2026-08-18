import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AdminPrivacyController } from './admin-privacy.controller';
import { AdminCustomersController } from './admin-customers.controller';
import { AddressesService } from './addresses.service';
import { PrivacyService } from './privacy.service';
import { CustomersService } from './customers.service';

@Module({
  controllers: [
    AccountController,
    AdminPrivacyController,
    AdminCustomersController,
  ],
  providers: [AddressesService, PrivacyService, CustomersService],
  exports: [AddressesService],
})
export class AccountModule {}
