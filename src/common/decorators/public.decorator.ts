import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Route accessible sans jeton : le garde JWT global la laisse passer. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const IS_OPTIONAL_AUTH_KEY = 'isOptionalAuth';

/**
 * Route publique qui exploite l'utilisateur s'il est connecté (panier invité,
 * prix par groupe client) sans jamais rejeter une requête anonyme.
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);
