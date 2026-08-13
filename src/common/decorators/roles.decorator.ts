import { SetMetadata } from '@nestjs/common';
import { Role } from '../../generated/prisma/enums';

export const ROLES_KEY = 'roles';

/** Restreint la route aux rôles listés. Vide = tout utilisateur authentifié. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Raccourci : réservé au personnel de la boutique. */
export const StaffOnly = () =>
  Roles('SUPPORT', 'FULFILLMENT', 'MANAGER', 'ADMIN');
