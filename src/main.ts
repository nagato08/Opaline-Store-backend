import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

/**
 * Garde la documentation Swagger derrière une authentification HTTP Basic.
 *
 * Comparaison en temps constant, même geste que pour les jetons d'accès
 * invité (`order-access.service.ts`) : une comparaison naïve `===` sur des
 * identifiants laisse fuir leur longueur et leur préfixe correct via le
 * temps de réponse.
 */
function basicAuthGuard(user: string, password: string) {
  const expected = Buffer.from(`${user}:${password}`);

  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const received = header.startsWith('Basic ')
      ? Buffer.from(Buffer.from(header.slice(6), 'base64').toString('utf8'))
      : Buffer.alloc(0);

    const authorized =
      received.length === expected.length &&
      timingSafeEqual(expected, received);

    if (!authorized) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Documentation"');
      res.status(401).send('Authentification requise.');
      return;
    }

    next();
  };
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');

  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());

  // Médias uploadés servis en statique. À remplacer par un stockage objet
  // (S3, Blob) + CDN en production.
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });

  // Derrière un reverse proxy, sans ça `request.ip` vaut l'IP du proxy et le
  // rate limiting devient global au lieu d'être par client.
  app.set('trust proxy', 1);

  // Analyse étendue de la chaîne de requête : sans elle, `categoryIds[]=a&…`
  // arrive comme une propriété littérale « categoryIds[] » que la validation
  // rejette, et les filtres à facettes deviennent inutilisables.
  app.set('query parser', 'extended');

  app.enableCors({
    origin: [
      config.getOrThrow<string>('storefrontUrl'),
      config.getOrThrow<string>('adminUrl'),
    ],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableShutdownHooks();

  const isProduction = config.get<string>('env') === 'production';
  const swaggerUser = config.get<string>('swagger.user');
  const swaggerPassword = config.get<string>('swagger.password');

  // En développement, Swagger reste ouvert pour ne pas ralentir le travail
  // quotidien. En production, il ne se monte que si des identifiants sont
  // fournis — par défaut il n'existe donc pas du tout, plutôt que d'exister
  // sans protection.
  if (!isProduction || (swaggerUser && swaggerPassword)) {
    if (isProduction) {
      app.use('/api/docs', basicAuthGuard(swaggerUser!, swaggerPassword!));
    }

    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('API e-commerce')
        .setDescription('Backend de la boutique')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = config.getOrThrow<number>('port');
  await app.listen(port);
}

void bootstrap();
