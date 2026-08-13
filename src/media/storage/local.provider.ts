import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { StorageProvider, StoredFile } from './storage.types';

const UPLOAD_ROOT = join(process.cwd(), 'uploads');

/**
 * Stockage sur disque, pour le développement sans compte d'hébergeur.
 *
 * Non utilisable en production : le disque d'un conteneur est éphémère, et
 * aucune déclinaison n'est générée — l'original part tel quel au navigateur.
 */
@Injectable()
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';
  readonly supportsTransformations = false;

  constructor(private readonly config: ConfigService) {}

  async upload(
    file: { buffer: Buffer; mimeType: string; originalName: string },
    options: { folder: string },
  ): Promise<StoredFile> {
    const filename = `${randomUUID()}${extname(file.originalName).toLowerCase()}`;
    const relativePath = `${options.folder}/${filename}`;

    await mkdir(join(UPLOAD_ROOT, options.folder), { recursive: true });
    await writeFile(join(UPLOAD_ROOT, relativePath), file.buffer);

    return {
      path: relativePath,
      url: `${this.config.getOrThrow<string>('appUrl')}/uploads/${relativePath}`,
      width: null,
      height: null,
      sizeBytes: file.buffer.byteLength,
      format: extname(file.originalName).replace('.', '').toLowerCase() || null,
    };
  }

  async remove(path: string): Promise<void> {
    await unlink(join(UPLOAD_ROOT, path)).catch(() => undefined);
  }

  /** Aucune transformation sur disque : l'original est renvoyé tel quel. */
  urlFor(_path: string, originalUrl: string): string {
    return originalUrl;
  }
}
