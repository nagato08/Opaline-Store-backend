import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { Role } from '../../generated/prisma/enums';

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: Role;
  locale: string;
  currencyCode: string;
  groupId: string | null;
};

export type RequestWithUser = Request & { user?: AuthenticatedUser };

/** Injecte l'utilisateur authentifié, ou `undefined` sur une route @OptionalAuth. */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    return data && user ? user[data] : user;
  },
);
