import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ProductsService } from '../services/products.service';
import { CategoriesService } from '../services/categories.service';
import { TaxonomyService } from '../services/taxonomy.service';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AdminProductQueryDto,
  CreateProductDto,
  UpdateProductDto,
} from '../dto/product.dto';
import { CreateCategoryDto, UpdateCategoryDto } from '../dto/category.dto';
import {
  CreateAttributeDto,
  CreateBrandDto,
  CreateCollectionDto,
  CreateOptionTypeDto,
  CreateOptionValueDto,
  SetCollectionProductsDto,
  SetProductAttributesDto,
  UpdateBrandDto,
} from '../dto/taxonomy.dto';

@Controller('admin/catalog')
@Roles('MANAGER', 'ADMIN')
export class AdminCatalogController {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly taxonomy: TaxonomyService,
  ) {}

  // --- Produits -------------------------------------------------------------

  @Get('products')
  listProducts(@Query() query: AdminProductQueryDto) {
    return this.products.listAdmin(query);
  }

  @Get('products/:id')
  getProduct(@Param('id') id: string) {
    return this.products.findOneAdmin(id);
  }

  @Post('products')
  createProduct(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto);
  }

  @Put('products/:id/attributes')
  setAttributes(@Param('id') id: string, @Body() dto: SetProductAttributesDto) {
    return this.taxonomy.setProductAttributes(id, dto);
  }

  @Delete('products/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  archiveProduct(@Param('id') id: string) {
    return this.products.archive(id);
  }

  // --- Catégories -----------------------------------------------------------

  @Get('categories')
  listCategories() {
    return this.categories.listAdmin();
  }

  @Post('categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCategory(@Param('id') id: string) {
    return this.categories.remove(id);
  }

  // --- Marques --------------------------------------------------------------

  @Get('brands')
  listBrands() {
    return this.taxonomy.listBrands();
  }

  @Post('brands')
  createBrand(@Body() dto: CreateBrandDto) {
    return this.taxonomy.createBrand(dto);
  }

  @Patch('brands/:id')
  updateBrand(@Param('id') id: string, @Body() dto: UpdateBrandDto) {
    return this.taxonomy.updateBrand(id, dto);
  }

  @Delete('brands/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeBrand(@Param('id') id: string) {
    return this.taxonomy.removeBrand(id);
  }

  // --- Options et attributs -------------------------------------------------

  @Get('option-types')
  listOptionTypes() {
    return this.taxonomy.listOptionTypes();
  }

  @Post('option-types')
  createOptionType(@Body() dto: CreateOptionTypeDto) {
    return this.taxonomy.createOptionType(dto);
  }

  @Post('option-types/:id/values')
  createOptionValue(
    @Param('id') id: string,
    @Body() dto: CreateOptionValueDto,
  ) {
    return this.taxonomy.createOptionValue(id, dto);
  }

  @Delete('option-types/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeOptionType(@Param('id') id: string) {
    return this.taxonomy.removeOptionType(id);
  }

  @Get('attributes')
  listAttributes() {
    return this.taxonomy.listAttributes();
  }

  @Post('attributes')
  createAttribute(@Body() dto: CreateAttributeDto) {
    return this.taxonomy.createAttribute(dto);
  }

  // --- Collections ----------------------------------------------------------

  @Get('collections')
  listCollections() {
    return this.taxonomy.listCollections();
  }

  @Post('collections')
  createCollection(@Body() dto: CreateCollectionDto) {
    return this.taxonomy.createCollection(dto);
  }

  @Put('collections/:id/products')
  setCollectionProducts(
    @Param('id') id: string,
    @Body() dto: SetCollectionProductsDto,
  ) {
    return this.taxonomy.setCollectionProducts(id, dto);
  }

  @Delete('collections/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCollection(@Param('id') id: string) {
    return this.taxonomy.removeCollection(id);
  }
}
