import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { PrismaClientKnownRequestError } from '../../generated/prisma/internal/prismaNamespace';

/** Traduit les erreurs Prisma en réponses HTTP plutôt qu'en 500 opaques. */
@Catch(PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    const { status, message } = this.translate(exception);

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`${exception.code} ${exception.message}`);
    }

    response.status(status).json({
      statusCode: status,
      message,
      code: exception.code,
    });
  }

  private translate(exception: PrismaClientKnownRequestError): {
    status: HttpStatus;
    message: string;
  } {
    switch (exception.code) {
      case 'P2002': {
        const target = (
          exception.meta?.['target'] as string[] | undefined
        )?.join(', ');
        return {
          status: HttpStatus.CONFLICT,
          message: target
            ? `Cette valeur existe déjà : ${target}.`
            : 'Cette valeur existe déjà.',
        };
      }
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Référence invalide vers une ressource inexistante.',
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'Ressource introuvable.',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Erreur de base de données.',
        };
    }
  }
}
