/**
 * Port de stockage des médias.
 *
 * L'application ne connaît qu'un identifiant opaque (`path`) et une URL de
 * base. Changer d'hébergeur — disque local en développement, Cloudinary en
 * production — ne touche qu'une classe d'adaptateur.
 */

export type StoredFile = {
  /** Identifiant chez l'hébergeur : chemin relatif ou `public_id` Cloudinary. */
  path: string;
  url: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  format: string | null;
};

/** Déclinaisons servies au navigateur, du plus léger au plus lourd. */
export type ImageVariant = 'placeholder' | 'thumbnail' | 'card' | 'zoom';

export const VARIANT_WIDTHS: Record<ImageVariant, number> = {
  placeholder: 24,
  thumbnail: 160,
  card: 600,
  zoom: 1600,
};

/**
 * Hauteur imposée, quand l'emplacement d'affichage en a une.
 *
 * `card` sort au format 4/5 de la grille et `thumbnail` au carré de la
 * galerie, tous deux complétés sur les côtés plutôt que rognés. `zoom` sert
 * la photo dans ses proportions d'origine, et `placeholder` n'est qu'une
 * tache floue : ni l'un ni l'autre n'a de hauteur à respecter.
 */
export const VARIANT_HEIGHTS: Record<ImageVariant, number | null> = {
  placeholder: null,
  thumbnail: 160,
  card: 750,
  zoom: null,
};

export interface StorageProvider {
  readonly name: string;
  /** Vrai si l'hébergeur redimensionne lui-même : inutile alors de le faire ici. */
  readonly supportsTransformations: boolean;

  upload(
    file: { buffer: Buffer; mimeType: string; originalName: string },
    options: { folder: string },
  ): Promise<StoredFile>;

  remove(path: string): Promise<void>;

  /**
   * URL d'une déclinaison. Sans transformation côté hébergeur, l'original est
   * renvoyé tel quel : l'affichage reste correct, seul le poids ne l'est pas.
   */
  urlFor(path: string, originalUrl: string, variant: ImageVariant): string;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
