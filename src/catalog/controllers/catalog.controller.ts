import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductsService } from '../services/products.service';
import { CategoriesService } from '../services/categories.service';
import { TaxonomyService } from '../services/taxonomy.service';
import { OptionalAuth, Public } from '../../common/decorators/public.decorator';
import {
  Storefront,
  type StorefrontContext,
} from '../../common/decorators/storefront-context.decorator';
import { ProductQueryDto } from '../dto/product.dto';

/**
 * Catalogue public. `@OptionalAuth` : un visiteur anonyme est servi normalement,
 * mais un client connecté reçoit les tarifs de son groupe et sa langue.
 */
@Controller('catalog')
@OptionalAuth()
export class CatalogController {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly taxonomy: TaxonomyService,
  ) {}

  @Get('products')
  listProducts(
    @Query() query: ProductQueryDto,
    @Storefront() context: StorefrontContext,
  ) {
    return this.products.listStorefront(query, context);
  }

  @Get('products/:slug')
  getProduct(
    @Param('slug') slug: string,
    @Storefront() context: StorefrontContext,
  ) {
    return this.products.findBySlug(slug, context);
  }

  @Get('categories')
  categoryTree(@Storefront() context: StorefrontContext) {
    return this.categories.tree(context.locale);
  }

  @Get('categories/:slug')
  category(
    @Param('slug') slug: string,
    @Storefront() context: StorefrontContext,
  ) {
    return this.categories.findBySlug(slug, context.locale);
  }

  @Public()
  @Get('brands')
  brands() {
    return this.taxonomy.listBrands(true);
  }

  @Get('collections')
  collections(@Storefront() context: StorefrontContext) {
    return this.taxonomy.listCollections(context.locale);
  }
}
