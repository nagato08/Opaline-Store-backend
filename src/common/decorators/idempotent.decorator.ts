import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotentScope';

/**
 * Marque une route comme rejouable : le header `Idempotency-Key` envoyé par le
 * client garantit qu'un retry ne déclenche pas deux fois l'opération.
 * À poser sur le checkout, la création de paiement et les remboursements.
 */
export const Idempotent = (scope: string) => SetMetadata(IDEMPOTENT_KEY, scope);
