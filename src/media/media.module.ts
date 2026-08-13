import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { CloudinaryStorageProvider } from './storage/cloudinary.provider';
import { LocalStorageProvider } from './storage/local.provider';
import { STORAGE_PROVIDER } from './storage/storage.types';

@Global()
@Module({
  imports: [
    // Stockage en mémoire : le service décide où écrire, ce qui permet de
    // changer d'hébergeur sans toucher aux contrôleurs.
    MulterModule.register({
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  ],
  controllers: [MediaController],
  providers: [
    CloudinaryStorageProvider,
    LocalStorageProvider,
    {
      /**
       * Cloudinary dès que les identifiants sont présents, disque local
       * sinon : un développeur sans compte peut travailler, et la production
       * bascule par simple variable d'environnement.
       */
      provide: STORAGE_PROVIDER,
      inject: [ConfigService, CloudinaryStorageProvider, LocalStorageProvider],
      useFactory: (
        config: ConfigService,
        cloudinary: CloudinaryStorageProvider,
        local: LocalStorageProvider,
      ) => {
        const isConfigured = Boolean(
          config.get<string>('media.cloudinary.cloudName') &&
          config.get<string>('media.cloudinary.apiKey') &&
          config.get<string>('media.cloudinary.apiSecret'),
        );

        if (!isConfigured) {
          new Logger('MediaModule').warn(
            'Cloudinary non configuré : stockage sur disque local, sans redimensionnement.',
          );
        }

        return isConfigured ? cloudinary : local;
      },
    },
    MediaService,
  ],
  exports: [MediaService],
})
export class MediaModule {}
