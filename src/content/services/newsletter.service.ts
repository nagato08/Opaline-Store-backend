import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { MailTemplate } from '../../mail/mail.types';
import { paginate, type PaginationDto } from '../../common/dto/pagination.dto';
import type { Locale } from '../../generated/prisma/enums';

@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Inscription en double opt-in : l'adresse reste `PENDING` tant qu'elle n'a
   * pas été confirmée par email. C'est exigé par le RGPD et indispensable pour
   * la délivrabilité — une liste d'adresses non confirmées finit en spam.
   */
  async subscribe(email: string, locale: Locale, source?: string) {
    const normalized = email.trim().toLowerCase();

    const existing = await this.prisma.newsletterSubscriber.findUnique({
      where: { email: normalized },
    });

    if (existing?.status === 'SUBSCRIBED') {
      return { status: 'ALREADY_SUBSCRIBED' as const };
    }

    const subscriber = await this.prisma.newsletterSubscriber.upsert({
      where: { email: normalized },
      update: { status: 'PENDING', locale, source, unsubscribedAt: null },
      create: { email: normalized, locale, source, status: 'PENDING' },
    });

    const token = randomBytes(24).toString('base64url');

    await this.prisma.verificationToken.create({
      data: {
        identifier: normalized,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        type: 'EMAIL_VERIFICATION',
        payload: { purpose: 'newsletter', subscriberId: subscriber.id },
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });

    await this.mail.enqueue({
      to: normalized,
      template: MailTemplate.NewsletterConfirm,
      locale,
      variables: {
        actionUrl: `${this.config.getOrThrow<string>('storefrontUrl')}/newsletter/confirmation?token=${token}`,
      },
      relatedType: 'newsletter',
      relatedId: subscriber.id,
    });

    return { status: 'CONFIRMATION_SENT' as const };
  }

  async confirm(token: string) {
    const record = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: createHash('sha256').update(token).digest('hex') },
    });

    const payload = record?.payload as { purpose?: string } | null;

    if (
      !record ||
      payload?.purpose !== 'newsletter' ||
      record.usedAt ||
      record.expiresAt < new Date()
    ) {
      throw new BadRequestException('Lien de confirmation invalide ou expiré.');
    }

    await this.prisma.$transaction([
      this.prisma.newsletterSubscriber.update({
        where: { email: record.identifier },
        data: { status: 'SUBSCRIBED', confirmedAt: new Date() },
      }),
      this.prisma.verificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { status: 'SUBSCRIBED' as const };
  }

  /** Désinscription : on conserve la trace pour ne plus jamais réécrire. */
  async unsubscribe(email: string) {
    await this.prisma.newsletterSubscriber.updateMany({
      where: { email: email.trim().toLowerCase() },
      data: { status: 'UNSUBSCRIBED', unsubscribedAt: new Date() },
    });

    return { status: 'UNSUBSCRIBED' as const };
  }

  async list(dto: PaginationDto, status?: string) {
    const where = status ? { status: status as 'SUBSCRIBED' } : {};

    const [items, total] = await Promise.all([
      this.prisma.newsletterSubscriber.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: dto.skip,
        take: dto.perPage,
      }),
      this.prisma.newsletterSubscriber.count({ where }),
    ]);

    return paginate(items, total, dto);
  }
}
