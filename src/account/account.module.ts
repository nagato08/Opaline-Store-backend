import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AdminPrivacyController } from './admin-privacy.controller';
import { AddressesService } from './addresses.service';
import { PrivacyService } from './privacy.service';

@Module({
  controllers: [AccountController, AdminPrivacyController],
  providers: [AddressesService, PrivacyService],
  exports: [AddressesService],
})
export class AccountModule {}
