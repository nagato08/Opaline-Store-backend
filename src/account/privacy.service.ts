import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { Prisma } from '../generated/prisma/client';
import type { ConsentType, DataRequestType } from '../generated/prisma/enums';

const EXPORT_DIR = join(process.cwd(), 'storage', 'exports');

/**
 * Durée légale de conservation des pièces comptables en France : 10 ans.
 * Une demande d'effacement ne peut donc pas supprimer les commandes ; elle
 * anonymise les données personnelles et laisse les écritures intactes.
 */
const ACCOUNTING_RETENTION_YEARS = 10;

@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Enregistre un consentement horodaté : c'est la preuve exigée par le RGPD. */
  async recordConsent(input: {
    type: ConsentType;
    isGranted: boolean;
    userId?: string;
    sessionId?: string;
    version?: string;
    ip?: string;
    userAgent?: string;
  }) {
    return this.prisma.consentLog.create({
      data: {
        type: input.type,
        isGranted: input.isGranted,
        userId: input.userId,
        sessionId: input.sessionId,
        version: input.version,
        ip: input.ip,
        userAgent: input.userAgent,
      },
      select: { id: true, type: true, isGranted: true, createdAt: true },
    });
  }

  consentHistory(userId: string) {
    return this.prisma.consentLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async requestData(userId: string, type: DataRequestType) {
    const pending = await this.prisma.dataRequest.findFirst({
      where: { userId, type, status: { in: ['PENDING', 'PROCESSING'] } },
    });

    if (pending) {
      throw new BadRequestException('Une demande identique est déjà en cours.');
    }

    return this.prisma.dataRequest.create({
      data: { userId, type, status: 'PENDING' },
    });
  }

  listRequests(userId: string) {
    return this.prisma.dataRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Traite une demande en attente. Séparé de la création : l'export peut être
   * long, et l'effacement doit rester une opération explicite et tracée.
   */
  async process(requestId: string, actorId?: string) {
    const request = await this.prisma.dataRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { user: true },
    });

    if (request.status === 'COMPLETED') {
      throw new BadRequestException('Cette demande est déjà traitée.');
    }

    await this.prisma.dataRequest.update({
      where: { id: requestId },
      data: { status: 'PROCESSING' },
    });

    const result =
      request.type === 'EXPORT'
        ? await this.exportUserData(request.userId)
        : await this.anonymizeUser(request.userId);

    await this.audit.record({
      actorId,
      action: `privacy.${request.type.toLowerCase()}`,
      entityType: 'User',
      entityId: request.userId,
      after: { requestId, ...result },
    });

    return this.prisma.dataRequest.update({
      where: { id: requestId },
      data: {
        status: 'COMPLETED',
        processedAt: new Date(),
        fileUrl: 'fileName' in result ? result.fileName : null,
      },
    });
  }

  /** Lecture du fichier d'export, réservée à son propriétaire. */
  async readExport(requestId: string, userId: string): Promise<Buffer> {
    const request = await this.prisma.dataRequest.findFirst({
      where: { id: requestId, userId, type: 'EXPORT', status: 'COMPLETED' },
    });

    if (!request?.fileUrl) {
      throw new NotFoundException('Export introuvable.');
    }

    return readFile(join(EXPORT_DIR, request.fileUrl));
  }

  /**
   * Rassemble toutes les données personnelles rattachées au compte.
   * Le fichier est écrit hors du répertoire servi en statique : un export
   * contient l'historique d'achat complet et ne doit jamais être devinable.
   */
  private async exportUserData(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        addresses: true,
        accounts: { select: { provider: true, email: true, createdAt: true } },
        consents: true,
        orders: {
          include: {
            items: true,
            addresses: true,
            invoices: true,
            payments: true,
          },
        },
        reviews: true,
        wishlists: { include: { items: true } },
        loyaltyAccount: { include: { transactions: true } },
        returnRequests: { include: { items: true } },
        notifications: true,
      },
    });

    const { passwordHash, totpSecret, ...safeUser } = user;
    void passwordHash;
    void totpSecret;

    const payload = {
      exportedAt: new Date().toISOString(),
      account: safeUser,
    };

    await mkdir(EXPORT_DIR, { recursive: true });

    const fileName = `${userId}-${randomUUID()}.json`;
    await writeFile(
      join(EXPORT_DIR, fileName),
      JSON.stringify(payload, null, 2),
      'utf8',
    );

    this.logger.log(`Export RGPD généré pour ${userId}.`);

    return { fileName, orders: user.orders.length };
  }

  /**
   * Effacement : les données identifiantes sont brouillées, les écritures
   * comptables restent. Supprimer une commande ferait disparaître une facture
   * que la loi oblige à conserver dix ans.
   */
  private async anonymizeUser(userId: string) {
    const anonymousEmail = `supprime-${randomUUID()}@anonyme.invalid`;

    // L'adresse d'origine est relevée avant écrasement : elle sert à couper
    // les abonnements marketing rattachés à cet email.
    const { email: previousEmail } = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });

    const orders = await this.prisma.order.findMany({
      where: { userId },
      select: { id: true, placedAt: true },
    });

    const retentionLimit = new Date();
    retentionLimit.setFullYear(
      retentionLimit.getFullYear() - ACCOUNTING_RETENTION_YEARS,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          email: anonymousEmail,
          firstName: null,
          lastName: null,
          phone: null,
          passwordHash: null,
          totpSecret: null,
          vatNumber: null,
          company: null,
          acceptsMarketing: false,
          status: 'DELETED',
          anonymizedAt: new Date(),
          deletedAt: new Date(),
        },
      });

      await tx.address.deleteMany({ where: { userId } });
      await tx.account.deleteMany({ where: { userId } });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.newsletterSubscriber.updateMany({
        where: { email: previousEmail },
        data: { status: 'UNSUBSCRIBED', unsubscribedAt: new Date() },
      });
      await tx.backInStockRequest.deleteMany({
        where: { email: previousEmail },
      });

      // Les avis restent publiés mais deviennent anonymes : les supprimer
      // fausserait la note moyenne des produits.
      await tx.review.updateMany({
        where: { userId },
        data: { authorName: 'Client supprimé' },
      });

      for (const order of orders) {
        const isOutsideRetention =
          order.placedAt !== null && order.placedAt < retentionLimit;

        await tx.order.update({
          where: { id: order.id },
          data: {
            email: anonymousEmail,
            phone: null,
            ip: null,
            userAgent: null,
            customerNote: null,
          },
        });

        // Au-delà de la durée légale, plus rien n'oblige à conserver
        // l'adresse de livraison : elle est effacée à son tour.
        if (isOutsideRetention) {
          await tx.orderAddress.updateMany({
            where: { orderId: order.id },
            data: {
              firstName: 'Anonyme',
              lastName: 'Anonyme',
              line1: '—',
              line2: null,
              phone: null,
              notes: null,
            },
          });
        }
      }
    });

    this.logger.log(
      `Compte ${userId} anonymisé (${orders.length} commande(s) conservée(s)).`,
    );

    return { anonymizedOrders: orders.length };
  }

  listAllRequests(status?: Prisma.DataRequestWhereInput['status']) {
    return this.prisma.dataRequest.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { email: true } } },
    });
  }
}
