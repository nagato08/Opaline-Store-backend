import { Module } from '@nestjs/common';
import { ContentController } from './content.controller';
import { AdminContentController } from './admin-content.controller';
import { CampaignsService } from './services/campaigns.service';
import { ContentService } from './services/content.service';
import { ContentAdminService } from './services/content-admin.service';
import { NewsletterService } from './services/newsletter.service';

@Module({
  controllers: [ContentController, AdminContentController],
  providers: [
    CampaignsService,
    ContentService,
    ContentAdminService,
    NewsletterService,
  ],
  exports: [CampaignsService, ContentService],
})
export class ContentModule {}
