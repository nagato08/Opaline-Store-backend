/**
 * Slug URL : minuscules, accents retirés, séparateurs normalisés.
 * « Canapé d'angle 3 places » → « canape-d-angle-3-places ».
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/**
 * Rend le slug unique en suffixant `-2`, `-3`… tant qu'il est déjà pris.
 * `isTaken` reçoit le candidat et répond si la valeur existe déjà en base.
 */
export async function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const root = slugify(base) || 'item';
  let candidate = root;
  let suffix = 1;

  while (await isTaken(candidate)) {
    suffix += 1;
    candidate = `${root}-${suffix}`;
  }

  return candidate;
}
