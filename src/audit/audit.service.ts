import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { paginate, type PaginationDto } from '../common/dto/pagination.dto';
import { Prisma } from '../generated/prisma/client';

export type AuditEntry = {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
};

/**
 * Champs jamais journalisés. Un journal d'audit se consulte largement en
 * interne : y laisser un mot de passe ou un jeton transformerait l'outil de
 * traçabilité en fuite de secrets.
 */
const REDACTED_FIELDS = [
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'refreshToken',
  'accessToken',
  'tokenHash',
  'clientSecret',
  'apiKey',
  'codeHash',
  'totpSecret',
];

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? undefined,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? undefined,
        before: this.sanitize(entry.before),
        after: this.sanitize(entry.after),
        ip: entry.ip,
        userAgent: entry.userAgent,
      },
    });
  }

  async list(
    dto: PaginationDto,
    filters: {
      actorId?: string;
      entityType?: string;
      entityId?: string;
      action?: string;
    },
  ) {
    const where: Prisma.AuditLogWhereInput = {
      actorId: filters.actorId,
      entityType: filters.entityType,
      entityId: filters.entityId,
      action: filters.action
        ? { contains: filters.action, mode: 'insensitive' }
        : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: dto.skip,
        take: dto.perPage,
        include: {
          actor: {
            select: { id: true, email: true, firstName: true, role: true },
          },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return paginate(items, total, dto);
  }

  /** Historique complet d'une entité : « qui a touché à ce produit ? ». */
  history(entityType: string, entityId: string, take = 100) {
    return this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take,
      include: { actor: { select: { email: true, firstName: true } } },
    });
  }

  /**
   * Purge des entrées trop anciennes. Le journal grossit vite ; une rétention
   * bornée évite qu'il ne devienne la plus grosse table de la base.
   */
  async purgeOlderThan(days: number): Promise<number> {
    const result = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - days * 86_400_000) } },
    });

    return result.count;
  }

  private sanitize(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    const cleaned = this.redact(value);

    return JSON.parse(JSON.stringify(cleaned)) as Prisma.InputJsonValue;
  }

  private redact(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item));
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          REDACTED_FIELDS.includes(key) ? '[masqué]' : this.redact(item),
        ]),
      );
    }

    return value;
  }
}
