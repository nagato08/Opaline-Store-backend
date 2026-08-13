/**
 * Ciblage et règles d'affichage d'une campagne.
 *
 * Répartition des responsabilités : le serveur décide **si** une campagne est
 * éligible (planning, audience, page, plafond de répétition) ; le navigateur
 * décide **quand** l'afficher dans la page (délai, scroll, intention de
 * sortie). Faire l'inverse exposerait toute la programmation marketing dans le
 * bundle front et rendrait le plafonnage contournable.
 */

export type CampaignAudience =
  'ALL' | 'NEW_VISITOR' | 'RETURNING_VISITOR' | 'CUSTOMER' | 'GUEST';

export type CampaignTargeting = {
  /** Motifs de chemin, joker `*` autorisé : `/fr/meubles/*`. */
  pages?: string[];
  excludedPages?: string[];
  devices?: ('mobile' | 'tablet' | 'desktop')[];
  locales?: string[];
  countries?: string[];
  audience?: CampaignAudience;
  customerGroups?: string[];
  utmSources?: string[];
  /** Panier minimum, pour une relance ciblée en cours de tunnel. */
  minCartCents?: number;
  categories?: string[];
};

export type CampaignTrigger = 'IMMEDIATE' | 'DELAY' | 'SCROLL' | 'EXIT_INTENT';

export type CampaignDisplayRules = {
  trigger?: CampaignTrigger;
  delayMs?: number;
  scrollPercent?: number;
  /** Nombre maximal d'affichages par visiteur, tous passages confondus. */
  maxPerVisitor?: number;
  /** Délai minimal avant réaffichage au même visiteur. */
  cooldownHours?: number;
  dismissible?: boolean;
  position?: string;
};

/**
 * Planification récurrente, exprimée dans le fuseau de la campagne.
 * Exemple : tous les vendredis de 18 h à 23 h.
 */
export type CampaignRecurrence = {
  daysOfWeek?: number[];
  startTime?: string;
  endTime?: string;
  daysOfMonth?: number[];
};

export type VisitorContext = {
  path: string;
  device: 'mobile' | 'tablet' | 'desktop';
  locale: string;
  countryCode: string;
  visitorId: string | null;
  userId: string | null;
  customerGroupId: string | null;
  isReturning: boolean;
  utmSource: string | null;
  cartTotalCents: number;
  categoryIds: string[];
};
