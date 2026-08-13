import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MailService } from './mail.service';
import { UnsubscribeService } from './unsubscribe.service';
import { MailProcessor } from './mail.processor';
import { ResendMailProvider } from './providers/resend.provider';
import { MAIL_PROVIDER, MAIL_QUEUE } from './mail.types';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: MAIL_QUEUE })],
  providers: [
    ResendMailProvider,
    { provide: MAIL_PROVIDER, useExisting: ResendMailProvider },
    MailService,
    UnsubscribeService,
    MailProcessor,
  ],
  exports: [MailService, UnsubscribeService],
})
export class MailModule {}
