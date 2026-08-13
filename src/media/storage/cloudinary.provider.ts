import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import {
  VARIANT_WIDTHS,
  type ImageVariant,
  type StorageProvider,
  type StoredFile,
} from './storage.types';

@Injectable()
export class CloudinaryStorageProvider implements StorageProvider {
  readonly name = 'cloudinary';
  /** Cloudinary redimensionne et convertit à la volée depuis l'URL. */
  readonly supportsTransformations = true;

  private readonly logger = new Logger(CloudinaryStorageProvider.name);

  constructor(private readonly config: ConfigService) {
    cloudinary.config({
      cloud_name: this.config.get<string>('media.cloudinary.cloudName'),
      api_key: this.config.get<string>('media.cloudinary.apiKey'),
      api_secret: this.config.get<string>('media.cloudinary.apiSecret'),
      secure: true,
      // Sans ça, le SDK ajoute un paramètre de télémétrie à chaque URL, qui
      // pollue le cache du navigateur et le CDN pour rien.
      analytics: false,
    });
  }

  async upload(
    file: { buffer: Buffer; mimeType: string; originalName: string },
    options: { folder: string },
  ): Promise<StoredFile> {
    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `${this.prefix()}/${options.folder}`,
          // `auto` couvre images, vidéos et PDF sans avoir à trier en amont.
          resource_type: 'auto',
          // Le nom d'origine n'est jamais réutilisé : il peut contenir des
          // caractères de traversée de chemin ou trahir un chemin interne.
          use_filename: false,
          unique_filename: true,
          overwrite: false,
        },
        (error, response) => {
          if (error || !response) {
            reject(
              error instanceof Error
                ? error
                : new Error(
                    error?.message ?? 'Échec du téléversement Cloudinary.',
                  ),
            );
            return;
          }

          resolve(response);
        },
      );

      stream.end(file.buffer);
    }).catch((error: Error) => {
      this.logger.error(`Téléversement Cloudinary échoué : ${error.message}`);
      throw new InternalServerErrorException(
        "Le téléversement de l'image a échoué.",
      );
    });

    return {
      path: result.public_id,
      url: result.secure_url,
      width: result.width ?? null,
      height: result.height ?? null,
      sizeBytes: result.bytes,
      format: result.format ?? null,
    };
  }

  async remove(path: string): Promise<void> {
    await cloudinary.uploader
      .destroy(path, { invalidate: true })
      // Un fichier déjà absent chez l'hébergeur ne doit pas empêcher la
      // suppression de la fiche en base.
      .catch((error: Error) => {
        this.logger.warn(
          `Suppression Cloudinary échouée pour ${path} : ${error.message}`,
        );
      });
  }

  /**
   * URL transformée. `f_auto` sert du WebP ou de l'AVIF selon le navigateur,
   * `q_auto` ajuste la compression : c'est là que se joue l'essentiel du gain
   * de poids, sans retraiter les fichiers ni les stocker en plusieurs tailles.
   */
  urlFor(path: string, originalUrl: string, variant: ImageVariant): string {
    if (!path) {
      return originalUrl;
    }

    const transformation = [
      `w_${VARIANT_WIDTHS[variant]}`,
      'c_limit',
      'f_auto',
      variant === 'placeholder' ? 'q_auto:low,e_blur:400' : 'q_auto',
    ].join(',');

    return cloudinary.url(path, {
      transformation: [{ raw_transformation: transformation }],
    });
  }

  private prefix(): string {
    return this.config.get<string>('media.cloudinary.folder') ?? 'boutique';
  }
}
