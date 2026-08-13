import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { Observable, from, map, of, switchMap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import type { RequestWithUser } from '../decorators/current-user.decorator';
import { IDEMPOTENT_KEY } from '../decorators/idempotent.decorator';

/** Durée pendant laquelle une réponse est rejouable pour la même clé. */
const RETENTION_HOURS = 24;

/**
 * Rejoue la réponse d'origine quand un client renvoie la même requête avec le
 * même header `Idempotency-Key` : un double-clic ou un retry réseau ne crée
 * pas deux commandes ni deux paiements.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const scope = this.reflector.getAllAndOverride<string>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!scope) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const key = request.header('Idempotency-Key');

    if (!key) {
      return next.handle();
    }

    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          url: request.originalUrl,
          body: (request.body as unknown) ?? {},
        }),
      )
      .digest('hex');

    return from(this.resolve(scope, key, requestHash, request.user?.id)).pipe(
      switchMap((existing) => {
        if (existing?.completedAt) {
          return of(existing.responseBody as unknown);
        }

        return next.handle().pipe(
          // La réponse est enregistrée AVANT d'être émise : si l'écriture
          // échouait en tâche de fond, la clé resterait bloquée « en cours »
          // et tout rejeu serait refusé.
          switchMap((body) =>
            from(
              this.complete(
                scope,
                key,
                body,
                context.switchToHttp().getResponse<{ statusCode: number }>()
                  .statusCode,
              ),
            ).pipe(map((): unknown => body)),
          ),
        );
      }),
    );
  }

  private async complete(
    scope: string,
    key: string,
    body: unknown,
    statusCode: number,
  ): Promise<void> {
    // Les entités Prisma contiennent des Decimal et des Date que la colonne
    // JSON ne sait pas stocker telles quelles : on repasse par une
    // sérialisation JSON classique.
    const serialized = JSON.parse(JSON.stringify(body ?? null)) as object;

    await this.prisma.idempotencyKey.update({
      where: { scope_key: { scope, key } },
      data: { statusCode, responseBody: serialized, completedAt: new Date() },
    });
  }

  private async resolve(
    scope: string,
    key: string,
    requestHash: string,
    userId?: string,
  ) {
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { scope_key: { scope, key } },
    });

    if (existing) {
      // Même clé mais charge utile différente : le client s'est trompé, on refuse
      // plutôt que de lui renvoyer la réponse d'une autre opération.
      if (existing.requestHash !== requestHash) {
        throw new ConflictException(
          'Cette clé d’idempotence a déjà été utilisée avec une requête différente.',
        );
      }

      if (!existing.completedAt) {
        throw new ConflictException(
          'Une requête identique est déjà en cours de traitement.',
        );
      }

      return existing;
    }

    const expiresAt = new Date(Date.now() + RETENTION_HOURS * 3600 * 1000);

    await this.prisma.idempotencyKey.create({
      data: { scope, key, requestHash, userId, expiresAt },
    });

    return null;
  }
}
