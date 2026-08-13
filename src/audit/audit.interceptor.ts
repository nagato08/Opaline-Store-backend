import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';
import type { RequestWithUser } from '../common/decorators/current-user.decorator';

/** Méthodes qui modifient l'état. Les lectures ne sont pas journalisées. */
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Journalise automatiquement toute écriture faite depuis l'administration.
 *
 * L'approche est volontairement globale plutôt que par décorateur sur chaque
 * route : une route oubliée serait une action non tracée, et c'est justement
 * celle-là qu'on cherchera le jour d'un litige.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();

    if (!this.shouldAudit(request)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: (response) => {
          // Seules les opérations réussies sont journalisées : une requête
          // rejetée n'a rien modifié, et la tracer noierait le journal.
          void this.write(request, response, context);
        },
      }),
    );
  }

  private shouldAudit(request: RequestWithUser): boolean {
    return (
      MUTATING_METHODS.has(request.method) &&
      request.path.startsWith('/api/admin/') &&
      Boolean(request.user)
    );
  }

  private async write(
    request: RequestWithUser,
    response: unknown,
    context: ExecutionContext,
  ): Promise<void> {
    const controller = context.getClass().name.replace(/Controller$/, '');
    const handler = context.getHandler().name;

    const entityId =
      (request.params as Record<string, string>)?.id ??
      (response as { id?: string } | null)?.id ??
      null;

    await this.audit
      .record({
        actorId: request.user?.id,
        action: `${controller}.${handler}`,
        entityType: controller,
        entityId,
        before: {
          method: request.method,
          path: request.path,
          body: request.body as unknown,
        },
        after: response,
        ip: request.ip,
        userAgent: request.header('user-agent'),
      })
      // Une panne d'écriture du journal ne doit jamais faire échouer
      // l'opération métier déjà commitée.
      .catch(() => undefined);
  }
}
