/**
 * Référentiel pays / TVA.
 *
 * ATTENTION : les taux ci-dessous sont un point de départ pour le développement.
 * Ils changent régulièrement et les taux réduits alimentaires comportent de
 * nombreuses exceptions par catégorie de denrée. À vérifier auprès d'un expert
 * comptable avant toute mise en production, ou à déléguer à Stripe Tax / Avalara.
 */

export type EuVatCountry = {
  code: string;
  name: string;
  nameEn: string;
  currencyCode: string;
  /** Taux normal. */
  standard: number;
  /** Taux applicable à l'essentiel des denrées alimentaires. */
  food: number;
};

export const EU_VAT_RATES: EuVatCountry[] = [
  { code: 'AT', name: 'Autriche', nameEn: 'Austria', currencyCode: 'EUR', standard: 20, food: 10 },
  { code: 'BE', name: 'Belgique', nameEn: 'Belgium', currencyCode: 'EUR', standard: 21, food: 6 },
  { code: 'BG', name: 'Bulgarie', nameEn: 'Bulgaria', currencyCode: 'EUR', standard: 20, food: 20 },
  { code: 'CY', name: 'Chypre', nameEn: 'Cyprus', currencyCode: 'EUR', standard: 19, food: 5 },
  { code: 'CZ', name: 'Tchéquie', nameEn: 'Czechia', currencyCode: 'EUR', standard: 21, food: 12 },
  { code: 'DE', name: 'Allemagne', nameEn: 'Germany', currencyCode: 'EUR', standard: 19, food: 7 },
  { code: 'DK', name: 'Danemark', nameEn: 'Denmark', currencyCode: 'EUR', standard: 25, food: 25 },
  { code: 'EE', name: 'Estonie', nameEn: 'Estonia', currencyCode: 'EUR', standard: 22, food: 22 },
  { code: 'ES', name: 'Espagne', nameEn: 'Spain', currencyCode: 'EUR', standard: 21, food: 10 },
  { code: 'FI', name: 'Finlande', nameEn: 'Finland', currencyCode: 'EUR', standard: 25.5, food: 14 },
  { code: 'FR', name: 'France', nameEn: 'France', currencyCode: 'EUR', standard: 20, food: 5.5 },
  { code: 'GR', name: 'Grèce', nameEn: 'Greece', currencyCode: 'EUR', standard: 24, food: 13 },
  { code: 'HR', name: 'Croatie', nameEn: 'Croatia', currencyCode: 'EUR', standard: 25, food: 13 },
  { code: 'HU', name: 'Hongrie', nameEn: 'Hungary', currencyCode: 'EUR', standard: 27, food: 27 },
  { code: 'IE', name: 'Irlande', nameEn: 'Ireland', currencyCode: 'EUR', standard: 23, food: 0 },
  { code: 'IT', name: 'Italie', nameEn: 'Italy', currencyCode: 'EUR', standard: 22, food: 10 },
  { code: 'LT', name: 'Lituanie', nameEn: 'Lithuania', currencyCode: 'EUR', standard: 21, food: 21 },
  { code: 'LU', name: 'Luxembourg', nameEn: 'Luxembourg', currencyCode: 'EUR', standard: 17, food: 3 },
  { code: 'LV', name: 'Lettonie', nameEn: 'Latvia', currencyCode: 'EUR', standard: 21, food: 21 },
  { code: 'MT', name: 'Malte', nameEn: 'Malta', currencyCode: 'EUR', standard: 18, food: 0 },
  { code: 'NL', name: 'Pays-Bas', nameEn: 'Netherlands', currencyCode: 'EUR', standard: 21, food: 9 },
  { code: 'PL', name: 'Pologne', nameEn: 'Poland', currencyCode: 'EUR', standard: 23, food: 5 },
  { code: 'PT', name: 'Portugal', nameEn: 'Portugal', currencyCode: 'EUR', standard: 23, food: 6 },
  { code: 'RO', name: 'Roumanie', nameEn: 'Romania', currencyCode: 'EUR', standard: 21, food: 11 },
  { code: 'SE', name: 'Suède', nameEn: 'Sweden', currencyCode: 'EUR', standard: 25, food: 12 },
  { code: 'SI', name: 'Slovénie', nameEn: 'Slovenia', currencyCode: 'EUR', standard: 22, food: 9.5 },
  { code: 'SK', name: 'Slovaquie', nameEn: 'Slovakia', currencyCode: 'EUR', standard: 23, food: 19 },
];

/**
 * Pays hors UE ouverts à la facturation. `requiresRegion` impose la saisie de
 * l'État ou de la province : aux États-Unis et au Canada, la taxe se calcule à
 * ce niveau (sales tax locale, GST/TVQ/HST) et ne peut pas être codée en dur —
 * il faut un prestataire fiscal.
 */
export const NON_EU_COUNTRIES = [
  {
    code: 'US',
    name: 'États-Unis',
    nameEn: 'United States',
    currencyCode: 'USD',
    isEuMember: false,
    isShippingActive: false,
    requiresRegion: true,
  },
  {
    code: 'CA',
    name: 'Canada',
    nameEn: 'Canada',
    currencyCode: 'CAD',
    isEuMember: false,
    // Deuxième marché ouvert au lancement, avec la France.
    isShippingActive: true,
    requiresRegion: true,
  },
  {
    code: 'GB',
    name: 'Royaume-Uni',
    nameEn: 'United Kingdom',
    currencyCode: 'GBP',
    isEuMember: false,
    isShippingActive: false,
    requiresRegion: false,
  },
  {
    code: 'CH',
    name: 'Suisse',
    nameEn: 'Switzerland',
    currencyCode: 'EUR',
    isEuMember: false,
    isShippingActive: false,
    requiresRegion: false,
  },
];
