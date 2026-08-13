import { Module } from '@nestjs/common';
import { AdminSearchController, SearchController } from './search.controller';
import { SearchService } from './search.service';
import { SearchAdminService } from './search-admin.service';

@Module({
  controllers: [SearchController, AdminSearchController],
  providers: [SearchService, SearchAdminService],
  exports: [SearchService],
})
export class SearchModule {}
