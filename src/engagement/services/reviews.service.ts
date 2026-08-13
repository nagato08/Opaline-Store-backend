import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../pricing/settings.service';
import { paginate } from '../../common/dto/pagination.dto';
import { Prisma } from '../../generated/prisma/client';
import type { Locale } from '../../generated/prisma/enums';
import type {
  AdminReviewQueryDto,
  CreateReviewDto,
  ModerateReviewDto,
  ReviewQueryDto,
} from '../dto/engagement.dto';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Dépôt d'un avis.
   *
   * L'achat vérifié n'est pas déclaratif : il est établi à partir d'une ligne
   * de commande payée appartenant au client. Un avis sans achat reste possible
   * mais n'affiche pas le badge, et la modération décide de sa publication.
   */
  async create(dto: CreateReviewDto, userId: string | null, locale: Locale) {
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });

    if (!product) {
      throw new BadRequestException('Produit introuvable.');
    }

    let isVerifiedPurchase = false;

    if (dto.orderItemId && userId) {
      const orderItem = await this.prisma.orderItem.findFirst({
        where: {
          id: dto.orderItemId,
          productId: dto.productId,
          order: { userId, paymentStatus: 'PAID' },
        },
      });

      if (!orderItem) {
        throw new BadRequestException(
          'Cette ligne de commande ne correspond pas à un achat payé de ce produit.',
        );
      }

      const existing = await this.prisma.review.findFirst({
        where: { orderItemId: dto.orderItemId, userId },
      });

      if (existing) {
        throw new BadRequestException(
          'Vous avez déjà déposé un avis pour cet achat.',
        );
      }

      isVerifiedPurchase = true;
    }

    // Modération a priori par défaut : publier sans relecture expose la fiche
    // produit au spam et aux propos illicites.
    const autoApprove = await this.settings.get<boolean>(
      'reviews.autoApprove',
      false,
    );

    const review = await this.prisma.review.create({
      data: {
        productId: dto.productId,
        userId,
        orderItemId: dto.orderItemId,
        authorName: dto.authorName,
        rating: dto.rating,
        title: dto.title,
        body: dto.body,
        locale,
        status: autoApprove ? 'APPROVED' : 'PENDING',
        isVerifiedPurchase,
        media: dto.mediaIds?.length
          ? {
              create: dto.mediaIds.map((mediaId, index) => ({
                mediaId,
                position: index,
              })),
            }
          : undefined,
      },
      include: { media: true },
    });

    if (review.status === 'APPROVED') {
      await this.refreshProductRating(dto.productId);
    }

    return review;
  }

  async listForProduct(productId: string, query: ReviewQueryDto) {
    const where: Prisma.ReviewWhereInput = {
      productId,
      status: 'APPROVED',
      rating: query.rating,
      isVerifiedPurchase: query.verifiedOnly ? true : undefined,
    };

    const [items, total, distribution] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: [{ helpfulCount: 'desc' }, { createdAt: 'desc' }],
        skip: query.skip,
        take: query.perPage,
        include: {
          media: { include: { media: { select: { url: true } } } },
          user: { select: { firstName: true } },
        },
      }),
      this.prisma.review.count({ where }),
      this.prisma.review.groupBy({
        by: ['rating'],
        where: { productId, status: 'APPROVED' },
        _count: true,
      }),
    ]);

    return {
      ...paginate(
        items.map((review) => ({
          id: review.id,
          rating: review.rating,
          title: review.title,
          body: review.body,
          // Le nom complet n'est jamais exposé : prénom du compte, ou nom
          // déclaré, ou anonyme.
          author: review.user?.firstName ?? review.authorName ?? 'Client',
          isVerifiedPurchase: review.isVerifiedPurchase,
          helpfulCount: review.helpfulCount,
          reply: review.reply,
          repliedAt: review.repliedAt,
          media: review.media.map((item) => item.media.url),
          createdAt: review.createdAt,
        })),
        total,
        query,
      ),
      distribution: [5, 4, 3, 2, 1].map((rating) => ({
        rating,
        count:
          distribution.find((entry) => entry.rating === rating)?._count ?? 0,
      })),
    };
  }

  async listForAdmin(query: AdminReviewQueryDto) {
    const where: Prisma.ReviewWhereInput = {
      status: query.status,
      productId: query.productId,
    };

    const [items, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.perPage,
        include: {
          product: { include: { translations: true } },
          user: { select: { email: true, firstName: true } },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    return paginate(items, total, query);
  }

  async moderate(id: string, dto: ModerateReviewDto) {
    const review = await this.prisma.review.update({
      where: { id },
      data: {
        status: dto.status,
        reply: dto.reply,
        repliedAt: dto.reply ? new Date() : undefined,
      },
    });

    await this.refreshProductRating(review.productId);

    return review;
  }

  /** Vote « avis utile », sans compte : le tri des avis n'est pas critique. */
  async markHelpful(id: string) {
    return this.prisma.review.update({
      where: { id },
      data: { helpfulCount: { increment: 1 } },
      select: { id: true, helpfulCount: true },
    });
  }

  async remove(id: string, userId: string, role: string): Promise<void> {
    const review = await this.prisma.review.findUniqueOrThrow({
      where: { id },
    });

    if (role === 'CUSTOMER' && review.userId !== userId) {
      throw new ForbiddenException('Cet avis ne vous appartient pas.');
    }

    await this.prisma.review.delete({ where: { id } });
    await this.refreshProductRating(review.productId);
  }

  /**
   * Recalcule la note moyenne affichée sur la fiche produit.
   * Dénormalisée sur `Product` pour trier et filtrer sans agrégat à chaque
   * requête de listing.
   */
  private async refreshProductRating(productId: string): Promise<void> {
    const aggregate = await this.prisma.review.aggregate({
      where: { productId, status: 'APPROVED' },
      _avg: { rating: true },
      _count: true,
    });

    await this.prisma.product.update({
      where: { id: productId },
      data: {
        ratingAvg: aggregate._avg.rating ?? 0,
        ratingCount: aggregate._count,
      },
    });
  }
}
