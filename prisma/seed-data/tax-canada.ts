/**
 * Fiscalité canadienne.
 *
 * ATTENTION : ces taux sont un point de départ pour le développement. Ils
 * changent, et la Nouvelle-Écosse a modifié le sien récemment. À faire valider
 * par un comptable avant toute vente réelle au Canada.
 *
 * Trois régimes coexistent :
 *  - TPS seule (5 %) dans les territoires et en Alberta ;
 *  - TVH, taxe unique fusionnant fédéral et provincial (Ontario, Maritimes) ;
 *  - TPS + taxe provinciale distincte (Québec, Colombie-Britannique,
 *    Manitoba, Saskatchewan), qui doivent apparaître **séparément** sur la
 *    facture — d'où deux lignes de taxe et non un taux combiné.
 *
 * Les produits alimentaires de base sont détaxés au Canada : contrairement à
 * l'UE où ils bénéficient d'un taux réduit, ils sont ici à 0 %.
 */

export type CanadianProvince = {
  /** Code ISO 3166-2 sans le préfixe « CA- ». */
  code: string;
  name: string;
  /** Lignes de taxe applicables au taux normal, dans l'ordre d'affichage. */
  standard: { name: string; rate: number }[];
};

export const CANADIAN_PROVINCES: CanadianProvince[] = [
  { code: 'AB', name: 'Alberta', standard: [{ name: 'TPS 5%', rate: 5 }] },
  {
    code: 'BC',
    name: 'Colombie-Britannique',
    standard: [
      { name: 'TPS 5%', rate: 5 },
      { name: 'PST 7%', rate: 7 },
    ],
  },
  {
    code: 'MB',
    name: 'Manitoba',
    standard: [
      { name: 'TPS 5%', rate: 5 },
      { name: 'RST 7%', rate: 7 },
    ],
  },
  { code: 'NB', name: 'Nouveau-Brunswick', standard: [{ name: 'TVH 15%', rate: 15 }] },
  { code: 'NL', name: 'Terre-Neuve-et-Labrador', standard: [{ name: 'TVH 15%', rate: 15 }] },
  { code: 'NS', name: 'Nouvelle-Écosse', standard: [{ name: 'TVH 14%', rate: 14 }] },
  { code: 'NT', name: 'Territoires du Nord-Ouest', standard: [{ name: 'TPS 5%', rate: 5 }] },
  { code: 'NU', name: 'Nunavut', standard: [{ name: 'TPS 5%', rate: 5 }] },
  { code: 'ON', name: 'Ontario', standard: [{ name: 'TVH 13%', rate: 13 }] },
  { code: 'PE', name: 'Île-du-Prince-Édouard', standard: [{ name: 'TVH 15%', rate: 15 }] },
  {
    code: 'QC',
    name: 'Québec',
    standard: [
      { name: 'TPS 5%', rate: 5 },
      { name: 'TVQ 9,975%', rate: 9.975 },
    ],
  },
  {
    code: 'SK',
    name: 'Saskatchewan',
    standard: [
      { name: 'TPS 5%', rate: 5 },
      { name: 'PST 6%', rate: 6 },
    ],
  },
  { code: 'YT', name: 'Yukon', standard: [{ name: 'TPS 5%', rate: 5 }] },
];
