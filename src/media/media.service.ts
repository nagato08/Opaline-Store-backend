import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  STORAGE_PROVIDER,
  type ImageVariant,
  type StorageProvider,
} from './storage/storage.types';
import type { Locale, MediaType } from '../generated/prisma/enums';
import { PaginationDto, paginate } from '../common/dto/pagination.dto';

/**
 * Types acceptés.
 *
 * Le SVG en est volontairement exclu : il peut embarquer du JavaScript, et
 * servi depuis le domaine de la boutique il devient une faille XSS. Les
 * pictogrammes doivent passer par le code du front, pas par la médiathèque.
 */
const ALLOWED_MIME_TYPES: Record<string, MediaType> = {
  'image/jpeg': 'IMAGE',
  'image/png': 'IMAGE',
  'image/webp': 'IMAGE',
  'image/avif': 'IMAGE',
  'image/gif': 'IMAGE',
  'video/mp4': 'VIDEO',
  'video/webm': 'VIDEO',
  'application/pdf': 'DOCUMENT',
};

const MAX_SIZE_BYTES = 15 * 1024 * 1024;

export type MediaWithVariants = {
  id: string;
  type: MediaType;
  url: string;
  variants: Record<ImageVariant, string> | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  mimeType: string | null;
  folder: string | null;
  translations: {
    locale: Locale;
    alt: string | null;
    caption: string | null;
  }[];
  createdAt: Date;
};

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  /**
   * Téléverse un fichier chez l'hébergeur configuré et enregistre sa fiche.
   * Le chemin renvoyé par l'hébergeur est conservé tel quel : c'est lui qui
   * permet de reconstruire les déclinaisons et de supprimer le fichier.
   */
  async upload(
    file: Express.Multer.File,
    options: { folder?: string; alt?: string; locale?: Locale } = {},
  ): Promise<MediaWithVariants> {
    if (!file) {
      throw new BadRequestException('Aucun fichier reçu.');
    }

    const type = ALLOWED_MIME_TYPES[file.mimetype];

    if (!type) {
      throw new BadRequestException(
        `Type de fichier non autorisé : ${file.mimetype}.`,
      );
    }

    if (file.size > MAX_SIZE_BYTES) {
      throw new BadRequestException('Fichier trop volumineux (15 Mo maximum).');
    }

    const folder =
      (options.folder ?? 'general').replace(/[^a-z0-9/_-]/gi, '') || 'general';

    const stored = await this.storage.upload(
      {
        buffer: file.buffer,
        mimeType: file.mimetype,
        originalName: file.originalname,
      },
      { folder },
    );

    const media = await this.prisma.media.create({
      data: {
        type,
        url: stored.url,
        path: stored.path,
        mimeType: file.mimetype,
        sizeBytes: stored.sizeBytes,
        width: stored.width,
        height: stored.height,
        folder,
        translations: options.alt
          ? { create: { locale: options.locale ?? 'FR', alt: options.alt } }
          : undefined,
      },
      include: { translations: true },
    });

    return this.present(media);
  }

  async list(dto: PaginationDto, folder?: string) {
    const where = folder ? { folder } : {};

    const [items, total] = await Promise.all([
      this.prisma.media.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: dto.skip,
        take: dto.perPage,
        include: { translations: true },
      }),
      this.prisma.media.count({ where }),
    ]);

    return paginate(
      items.map((item) => this.present(item)),
      total,
      dto,
    );
  }

  async findOne(id: string) {
    const media = await this.prisma.media.findUniqueOrThrow({
      where: { id },
      include: { translations: true },
    });

    return this.present(media);
  }

  async setAlt(id: string, locale: Locale, alt: string, caption?: string) {
    return this.prisma.mediaTranslation.upsert({
      where: { mediaId_locale: { mediaId: id, locale } },
      update: { alt, caption },
      create: { mediaId: id, locale, alt, caption },
    });
  }

  /**
   * Supprime la fiche puis le fichier distant. L'ordre compte : une fiche
   * orpheline est invisible, un fichier orphelin ne coûte que du stockage.
   */
  async remove(id: string): Promise<void> {
    const media = await this.prisma.media.delete({ where: { id } });

    if (media.path) {
      await this.storage.remove(media.path);
    }
  }

  /** Déclinaisons prêtes à poser dans un `srcset` côté front. */
  buildVariants(media: { path: string | null; url: string; type: MediaType }) {
    if (media.type !== 'IMAGE' || !media.path) {
      return null;
    }

    const variants: ImageVariant[] = [
      'placeholder',
      'thumbnail',
      'card',
      'zoom',
    ];

    return Object.fromEntries(
      variants.map((variant) => [
        variant,
        this.storage.urlFor(media.path as string, media.url, variant),
      ]),
    ) as Record<ImageVariant, string>;
  }

  /**
   * Raccourci pour les listings : vignette de catalogue, ou l'original si
   * l'hébergeur ne transforme pas, ou `null` s'il n'y a pas d'image.
   */
  cardUrl(
    media:
      { path: string | null; url: string; type: MediaType } | null | undefined,
  ): string | null {
    if (!media) {
      return null;
    }

    return this.buildVariants(media)?.card ?? media.url;
  }

  private present(media: {
    id: string;
    type: MediaType;
    url: string;
    path: string | null;
    width: number | null;
    height: number | null;
    sizeBytes: number | null;
    mimeType: string | null;
    folder: string | null;
    createdAt: Date;
    translations: {
      locale: Locale;
      alt: string | null;
      caption: string | null;
    }[];
  }): MediaWithVariants {
    return {
      id: media.id,
      type: media.type,
      url: media.url,
      variants: this.buildVariants(media),
      width: media.width,
      height: media.height,
      sizeBytes: media.sizeBytes,
      mimeType: media.mimeType,
      folder: media.folder,
      translations: media.translations,
      createdAt: media.createdAt,
    };
  }
}
