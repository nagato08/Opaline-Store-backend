import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { slugify, uniqueSlug } from '../../common/utils/slug';
import type { Locale } from '../../generated/prisma/enums';
import type { CreateCategoryDto, UpdateCategoryDto } from '../dto/category.dto';

export type CategoryNode = {
  id: string;
  name: string;
  slug: string;
  position: number;
  imageUrl: string | null;
  productCount: number;
  children: CategoryNode[];
};

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCategoryDto) {
    const parent = dto.parentId
      ? await this.prisma.category.findUniqueOrThrow({
          where: { id: dto.parentId },
        })
      : null;

    const category = await this.prisma.category.create({
      data: {
        parentId: dto.parentId,
        imageId: dto.imageId,
        position: dto.position ?? 0,
        isActive: dto.isActive ?? true,
        showInMenu: dto.showInMenu ?? true,
        depth: parent ? parent.depth + 1 : 0,
        path: '/',
        translations: {
          create: await this.buildTranslations(dto.translations),
        },
      },
      include: { translations: true },
    });

    // Le chemin matérialisé se calcule après coup : il a besoin de l'id généré.
    return this.prisma.category.update({
      where: { id: category.id },
      data: {
        path: `${parent ? parent.path.replace(/\/$/, '') : ''}/${category.id}/`,
      },
      include: { translations: true },
    });
  }

  async update(id: string, dto: UpdateCategoryDto) {
    if (dto.parentId === id) {
      throw new BadRequestException(
        'Une catégorie ne peut pas être sa propre parente.',
      );
    }

    if (dto.parentId) {
      const target = await this.prisma.category.findUniqueOrThrow({
        where: { id: dto.parentId },
      });

      // Déplacer une catégorie sous l'un de ses descendants créerait un cycle.
      if (target.path.includes(`/${id}/`)) {
        throw new BadRequestException(
          'Impossible de déplacer une catégorie sous l’une de ses sous-catégories.',
        );
      }
    }

    await this.prisma.category.update({
      where: { id },
      data: {
        parentId: dto.parentId,
        imageId: dto.imageId,
        position: dto.position,
        isActive: dto.isActive,
        showInMenu: dto.showInMenu,
      },
    });

    if (dto.translations?.length) {
      await this.upsertTranslations(id, dto.translations);
    }

    if (dto.parentId !== undefined) {
      await this.rebuildPaths();
    }

    return this.findOneAdmin(id);
  }

  async findOneAdmin(id: string) {
    return this.prisma.category.findUniqueOrThrow({
      where: { id },
      include: {
        translations: true,
        image: true,
        _count: { select: { products: true, children: true } },
      },
    });
  }

  async listAdmin() {
    return this.prisma.category.findMany({
      orderBy: [{ depth: 'asc' }, { position: 'asc' }],
      include: {
        translations: true,
        _count: { select: { products: true } },
      },
    });
  }

  /** Arbre destiné à la navigation de la boutique, dans la langue demandée. */
  async tree(locale: Locale): Promise<CategoryNode[]> {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ depth: 'asc' }, { position: 'asc' }],
      include: {
        translations: { where: { locale } },
        image: { select: { url: true } },
        _count: { select: { products: true } },
      },
    });

    const nodes = new Map<string, CategoryNode>();
    const roots: CategoryNode[] = [];

    for (const category of categories) {
      const translation = category.translations[0];

      nodes.set(category.id, {
        id: category.id,
        name: translation?.name ?? '',
        slug: translation?.slug ?? '',
        position: category.position,
        imageUrl: category.image?.url ?? null,
        productCount: category._count.products,
        children: [],
      });
    }

    for (const category of categories) {
      const node = nodes.get(category.id) as CategoryNode;
      const parent = category.parentId
        ? nodes.get(category.parentId)
        : undefined;

      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async findBySlug(slug: string, locale: Locale) {
    const translation = await this.prisma.categoryTranslation.findUnique({
      where: { locale_slug: { locale, slug } },
      include: { category: { include: { image: true } } },
    });

    if (!translation || !translation.category.isActive) {
      throw new NotFoundException('Catégorie introuvable.');
    }

    return {
      id: translation.categoryId,
      name: translation.name,
      slug: translation.slug,
      description: translation.description,
      seoTitle: translation.seoTitle,
      seoDescription: translation.seoDescription,
      imageUrl: translation.category.image?.url ?? null,
      path: translation.category.path,
    };
  }

  /** Ids de la catégorie et de toutes ses descendantes. */
  async descendantIds(categoryId: string): Promise<string[]> {
    const category = await this.prisma.category.findUniqueOrThrow({
      where: { id: categoryId },
      select: { path: true },
    });

    const descendants = await this.prisma.category.findMany({
      where: { path: { startsWith: category.path } },
      select: { id: true },
    });

    return descendants.map((item) => item.id);
  }

  async remove(id: string): Promise<void> {
    const children = await this.prisma.category.count({
      where: { parentId: id },
    });

    if (children > 0) {
      throw new BadRequestException(
        'Supprimez ou déplacez les sous-catégories avant de supprimer celle-ci.',
      );
    }

    await this.prisma.category.delete({ where: { id } });
  }

  private async buildTranslations(
    translations: CreateCategoryDto['translations'],
  ) {
    return Promise.all(
      translations.map(async (translation) => ({
        locale: translation.locale,
        name: translation.name,
        slug: await uniqueSlug(
          translation.slug ?? translation.name,
          (candidate) => this.isSlugTaken(translation.locale, candidate),
        ),
        description: translation.description,
        seoTitle: translation.seoTitle,
        seoDescription: translation.seoDescription,
      })),
    );
  }

  private async upsertTranslations(
    categoryId: string,
    translations: NonNullable<UpdateCategoryDto['translations']>,
  ): Promise<void> {
    for (const translation of translations) {
      const slug = translation.slug
        ? slugify(translation.slug)
        : await uniqueSlug(translation.name, (candidate) =>
            this.isSlugTaken(translation.locale, candidate, categoryId),
          );

      await this.prisma.categoryTranslation.upsert({
        where: {
          categoryId_locale: { categoryId, locale: translation.locale },
        },
        update: {
          name: translation.name,
          slug,
          description: translation.description,
          seoTitle: translation.seoTitle,
          seoDescription: translation.seoDescription,
        },
        create: {
          categoryId,
          locale: translation.locale,
          name: translation.name,
          slug,
          description: translation.description,
          seoTitle: translation.seoTitle,
          seoDescription: translation.seoDescription,
        },
      });
    }
  }

  private async isSlugTaken(
    locale: Locale,
    slug: string,
    exceptCategoryId?: string,
  ): Promise<boolean> {
    const existing = await this.prisma.categoryTranslation.findUnique({
      where: { locale_slug: { locale, slug } },
      select: { categoryId: true },
    });

    return Boolean(existing) && existing?.categoryId !== exceptCategoryId;
  }

  /** Recalcule chemins et profondeurs après un déplacement dans l'arbre. */
  private async rebuildPaths(): Promise<void> {
    const categories = await this.prisma.category.findMany({
      select: { id: true, parentId: true },
    });

    const byId = new Map(categories.map((category) => [category.id, category]));

    for (const category of categories) {
      const segments: string[] = [];
      let current: { id: string; parentId: string | null } | undefined =
        category;
      let guard = 0;

      while (current && guard < 20) {
        segments.unshift(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
        guard += 1;
      }

      await this.prisma.category.update({
        where: { id: category.id },
        data: { path: `/${segments.join('/')}/`, depth: segments.length - 1 },
      });
    }
  }
}
