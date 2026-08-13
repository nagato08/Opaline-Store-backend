import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { slugify, uniqueSlug } from '../../common/utils/slug';
import type { Locale } from '../../generated/prisma/enums';
import type {
  CreateAttributeDto,
  CreateBrandDto,
  CreateCollectionDto,
  CreateOptionTypeDto,
  CreateOptionValueDto,
  SetCollectionProductsDto,
  SetProductAttributesDto,
  UpdateBrandDto,
} from '../dto/taxonomy.dto';

/** Marques, options, attributs et collections : le référentiel du catalogue. */
@Injectable()
export class TaxonomyService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Marques -------------------------------------------------------------

  async createBrand(dto: CreateBrandDto) {
    return this.prisma.brand.create({
      data: {
        name: dto.name,
        slug: await uniqueSlug(dto.slug ?? dto.name, async (candidate) =>
          Boolean(
            await this.prisma.brand.findUnique({ where: { slug: candidate } }),
          ),
        ),
        logoId: dto.logoId,
        website: dto.website,
        isActive: dto.isActive ?? true,
        translations: dto.translations?.length
          ? { create: dto.translations }
          : undefined,
      },
      include: { translations: true },
    });
  }

  async updateBrand(id: string, dto: UpdateBrandDto) {
    await this.prisma.brand.update({
      where: { id },
      data: {
        name: dto.name,
        slug: dto.slug ? slugify(dto.slug) : undefined,
        logoId: dto.logoId,
        website: dto.website,
        isActive: dto.isActive,
      },
    });

    for (const translation of dto.translations ?? []) {
      await this.prisma.brandTranslation.upsert({
        where: { brandId_locale: { brandId: id, locale: translation.locale } },
        update: {
          name: translation.name,
          description: translation.description,
        },
        create: { brandId: id, ...translation },
      });
    }

    return this.prisma.brand.findUniqueOrThrow({
      where: { id },
      include: { translations: true },
    });
  }

  listBrands(activeOnly = false) {
    return this.prisma.brand.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: { name: 'asc' },
      include: {
        logo: { select: { url: true } },
        _count: { select: { products: true } },
      },
    });
  }

  async removeBrand(id: string): Promise<void> {
    await this.prisma.brand.delete({ where: { id } });
  }

  // --- Options (couleur, taille…) ------------------------------------------

  createOptionType(dto: CreateOptionTypeDto) {
    return this.prisma.optionType.create({
      data: {
        code: dto.code,
        displayAs: dto.displayAs ?? 'dropdown',
        position: dto.position ?? 0,
        translations: {
          create: dto.translations.map((translation) => ({
            locale: translation.locale,
            name: translation.label,
          })),
        },
      },
      include: { translations: true },
    });
  }

  createOptionValue(optionTypeId: string, dto: CreateOptionValueDto) {
    return this.prisma.optionValue.create({
      data: {
        optionTypeId,
        code: dto.code,
        hexColor: dto.hexColor,
        imageId: dto.imageId,
        position: dto.position ?? 0,
        translations: {
          create: dto.translations.map((translation) => ({
            locale: translation.locale,
            label: translation.label,
          })),
        },
      },
      include: { translations: true },
    });
  }

  listOptionTypes() {
    return this.prisma.optionType.findMany({
      orderBy: { position: 'asc' },
      include: {
        translations: true,
        values: {
          orderBy: { position: 'asc' },
          include: { translations: true },
        },
      },
    });
  }

  async removeOptionType(id: string): Promise<void> {
    await this.prisma.optionType.delete({ where: { id } });
  }

  // --- Attributs techniques -------------------------------------------------

  createAttribute(dto: CreateAttributeDto) {
    return this.prisma.attributeDefinition.create({
      data: {
        code: dto.code,
        valueType: dto.valueType ?? 'TEXT',
        unit: dto.unit,
        isFilterable: dto.isFilterable ?? false,
        isComparable: dto.isComparable ?? false,
        position: dto.position ?? 0,
        translations: {
          create: dto.translations.map((translation) => ({
            locale: translation.locale,
            name: translation.label,
          })),
        },
      },
      include: { translations: true },
    });
  }

  listAttributes() {
    return this.prisma.attributeDefinition.findMany({
      orderBy: { position: 'asc' },
      include: { translations: true },
    });
  }

  async setProductAttributes(productId: string, dto: SetProductAttributesDto) {
    await this.prisma.productAttributeValue.deleteMany({
      where: { productId },
    });

    if (dto.values.length === 0) {
      return [];
    }

    await this.prisma.productAttributeValue.createMany({
      data: dto.values.map((value) => ({
        productId,
        attributeId: value.attributeId,
        locale: value.locale,
        valueText: value.valueText,
        valueNumber: value.valueNumber,
        valueBoolean: value.valueBoolean,
        valueDate: value.valueDate ? new Date(value.valueDate) : undefined,
      })),
    });

    return this.prisma.productAttributeValue.findMany({
      where: { productId },
      include: { attribute: { include: { translations: true } } },
    });
  }

  // --- Collections ----------------------------------------------------------

  async createCollection(dto: CreateCollectionDto) {
    return this.prisma.collection.create({
      data: {
        code: dto.code,
        type: dto.type ?? 'MANUAL',
        rules: dto.rules as Prisma.InputJsonValue,
        imageId: dto.imageId,
        isActive: dto.isActive ?? true,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        translations: {
          create: await Promise.all(
            dto.translations.map(async (translation) => ({
              locale: translation.locale,
              name: translation.name,
              slug: await uniqueSlug(
                translation.slug ?? translation.name,
                async (candidate) =>
                  Boolean(
                    await this.prisma.collectionTranslation.findUnique({
                      where: {
                        locale_slug: {
                          locale: translation.locale,
                          slug: candidate,
                        },
                      },
                    }),
                  ),
              ),
              description: translation.description,
              seoTitle: translation.seoTitle,
              seoDescription: translation.seoDescription,
            })),
          ),
        },
      },
      include: { translations: true },
    });
  }

  async setCollectionProducts(
    collectionId: string,
    dto: SetCollectionProductsDto,
  ) {
    await this.prisma.collectionProduct.deleteMany({ where: { collectionId } });

    if (dto.productIds.length > 0) {
      await this.prisma.collectionProduct.createMany({
        data: dto.productIds.map((productId, index) => ({
          collectionId,
          productId,
          position: index,
        })),
      });
    }

    return this.prisma.collection.findUniqueOrThrow({
      where: { id: collectionId },
      include: { translations: true, _count: { select: { products: true } } },
    });
  }

  listCollections(locale?: Locale) {
    return this.prisma.collection.findMany({
      orderBy: { position: 'asc' },
      include: {
        translations: locale ? { where: { locale } } : true,
        image: { select: { url: true } },
        _count: { select: { products: true } },
      },
    });
  }

  async removeCollection(id: string): Promise<void> {
    await this.prisma.collection.delete({ where: { id } });
  }
}
