import { Module } from '@nestjs/common';
import { CatalogController } from './controllers/catalog.controller';
import { AdminCatalogController } from './controllers/admin-catalog.controller';
import { ProductsService } from './services/products.service';
import { CategoriesService } from './services/categories.service';
import { TaxonomyService } from './services/taxonomy.service';

@Module({
  controllers: [CatalogController, AdminCatalogController],
  providers: [ProductsService, CategoriesService, TaxonomyService],
  exports: [ProductsService, CategoriesService],
})
export class CatalogModule {}
