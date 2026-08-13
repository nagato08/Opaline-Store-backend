import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';
import { join } from 'node:path';
import { AppModule } from './app.module';

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

  if (config.get<string>('env') !== 'production') {
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
