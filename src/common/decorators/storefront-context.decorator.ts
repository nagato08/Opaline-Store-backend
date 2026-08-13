import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Locale } from '../../generated/prisma/enums';
import type { RequestWithUser } from './current-user.decorator';

export type StorefrontContext = {
  locale: Locale;
  currencyCode: string;
  /** Pays de destination présumé, utilisé pour le taux de TVA à l'affichage. */
  countryCode: string;
  customerGroupId: string | null;
};

const SUPPORTED_LOCALES: Locale[] = ['FR', 'EN'];
const DEFAULT_LOCALE: Locale = 'FR';
const DEFAULT_CURRENCY = 'EUR';
const DEFAULT_COUNTRY = 'FR';

/**
 * Contexte de consultation de la boutique. Ordre de priorité : paramètre de
 * requête explicite, puis préférences du compte connecté, puis en-têtes du
 * navigateur, puis valeurs par défaut de la boutique.
 */
export const Storefront = createParamDecorator(
  (_data: unknown, context: ExecutionContext): StorefrontContext => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const query = request.query as Record<string, string | undefined>;

    return {
      locale: resolveLocale(
        query['locale'],
        request.user?.locale,
        request.header('accept-language'),
      ),
      currencyCode: (
        query['currency'] ??
        request.user?.currencyCode ??
        DEFAULT_CURRENCY
      ).toUpperCase(),
      countryCode: (query['country'] ?? DEFAULT_COUNTRY).toUpperCase(),
      customerGroupId: request.user?.groupId ?? null,
    };
  },
);

function resolveLocale(
  fromQuery?: string,
  fromUser?: string,
  fromHeader?: string,
): Locale {
  const candidates = [fromQuery, fromUser, fromHeader?.slice(0, 2)];

  for (const candidate of candidates) {
    const normalized = candidate?.toUpperCase() as Locale | undefined;
    if (normalized && SUPPORTED_LOCALES.includes(normalized)) {
      return normalized;
    }
  }

  return DEFAULT_LOCALE;
}
