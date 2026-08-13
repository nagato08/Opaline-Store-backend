# Comptoir — API

Backend d'un site e-commerce **mono-boutique** appartenant à un client unique.

**Comptoir** est le nom du logiciel. L'enseigne du client est un réglage
(`store.name`) : elle ne doit jamais être écrite en dur dans le code.
Ce n'est pas une place de marché : aucune notion de vendeur, de tenant ou de
boutique multiple n'existe dans le schéma, et il ne faut pas en introduire.

NestJS 11 · Prisma 7 · PostgreSQL 17 · Redis 7 · TypeScript strict.
113 modèles, ~180 routes, 22 modules.

## Les trois dépôts

| Dossier | Rôle | État |
|---|---|---|
| `back_ecommerce` (ici) | API | opérationnel |
| `../front-ecommerce` | Boutique client (Next.js 16) | scaffold |
| `../admin_ecommerce` | Back-office (Next.js 16) | système de design + tableau de bord |

Le **système de design** des deux interfaces est documenté dans
`../admin_ecommerce/CLAUDE.md`.

## Démarrer

```bash
npm run db:up          # Postgres :5434 + Redis :6379 via Docker
npm run db:migrate
npm run db:seed
npm run start:dev      # http://localhost:3000/api — doc : /api/docs
```

Compte d'administration de développement : `admin@example.com` / `Admin123!`.

Postgres écoute sur **5434** et non 5432 : les ports 5432 et 5433 étaient déjà
occupés sur la machine de développement.

## Ce que vend la boutique

Meubles, électronique et **produits alimentaires**, en France et au Canada.
Cette combinaison explique la plupart des choix de modélisation :

- **Quantités décimales** — l'alimentaire se vend au poids. `Decimal(12,3)`
  partout, jamais d'entier. `Variant.stepQuantity` impose le pas de vente.
- **Lots et dates limites** — `StockLot` avec `expiresAt`, consommation en
  FEFO, et `OrderItem.lotNumbers` pour qu'un rappel produit soit ciblable.
- **Hors gabarit et chaîne du froid** — les modes de livraison portent
  `supportsOversized` et `supportsColdChain` ; le filtrage se fait sur les
  contraintes physiques **avant** le tarif.
- **Éco-participation** (`Product.ecoTaxCents`), obligation légale française
  sur le mobilier et l'électronique.

## Règles non négociables

Ces points ont chacun coûté un bug ou une reprise. Ne pas les contourner.

**L'argent est un entier en centimes.** `Int` + code devise ISO. Jamais de
flottant, jamais de `Decimal` pour un montant.

**La commande fige tout.** Libellé, SKU, prix, taux de taxe, remise, adresses.
Modifier un produit ne doit jamais altérer une commande passée. Ne jamais
joindre `Product` pour afficher un historique.

**Les remises s'appliquent avant la taxe.** Une remise réduit la base taxable.
Calculer la TVA sur le prix plein puis retrancher donne un montant faux et une
facture non conforme.

**Le régime d'affichage dépend du pays, pas de la boutique.** La France impose
l'affichage TTC, le Canada affiche hors taxe et ajoute TPS/TVQ/TVH à la caisse.
C'est `Country.pricesIncludeTax`, pas un réglage global.

**Le stock se réserve sous verrou.** `InventoryService.reserveForOrder` fait un
`SELECT … FOR UPDATE`. Sans lui, deux commandes simultanées sur le dernier
article passent toutes les deux.

**Les écritures sensibles sont idempotentes.** `@Idempotent('scope')` sur le
checkout et les paiements ; le client envoie un en-tête `Idempotency-Key`.

**La numérotation passe par des séquences Postgres.** `order_number_seq` et
`invoice_number_seq`. Un `count() + 1` produit des doublons sous concurrence,
et la numérotation de factures doit être continue pour être opposable.

## Pièges de la stack

Trois comportements du `ValidationPipe` qui produisent des bugs silencieux :

1. **Tout paramètre non déclaré dans un DTO est rejeté** (`forbidNonWhitelisted`).
   Un `?folder=` ou `?locale=` oublié rend la route inutilisable.
2. **Un objet imbriqué sans `@ValidateNested()` est supprimé** silencieusement.
   C'est ce qui avait vidé les adresses du checkout.
3. **`enableImplicitConversion` transforme les objets d'un tableau typé `Array`
   en tableaux vides.** Mettre `@Type(() => Object)` sur tout champ JSON libre
   (`actions`, `conditions`, `targeting`).

Autre piège : avec `target: ES2023`, une propriété de classe **sans décorateur**
existe sur l'instance et déclenche donc le rejet du point 1. Ne jamais déclarer
un champ interne dans un DTO — le passer en argument de méthode.

## Architecture

Trois sous-systèmes suivent le même patron **port + adaptateurs**, pour que
changer de prestataire ne touche qu'une classe :

| Port | Adaptateurs |
|---|---|
| `PaymentProviderAdapter` | `MANUAL` (virement, à la livraison). Stripe non branché — le client n'a pas de société. |
| `MailProvider` | Resend, domaine `tadjo.dev` vérifié |
| `StorageProvider` | Cloudinary (actif), disque local (repli développement) |

**Le moteur de règles** ([promotions/rule-engine.service.ts](src/promotions/rule-engine.service.ts))
est partagé entre les promotions et les campagnes d'affichage. Il ne connaît ni
Prisma ni HTTP : il prend un contexte et un arbre de conditions JSON, et rend
une remise **ventilée par ligne** — indispensable pour recalculer la base
taxable.

**Les campagnes** séparent les responsabilités : le serveur décide *si* une
campagne est éligible (planning, récurrence avec fuseau, ciblage, plafond par
visiteur via Redis), le navigateur décide *quand* l'afficher (délai, scroll,
intention de sortie). L'inverse exposerait la programmation marketing dans le
bundle front.

**Le journal d'audit** est un intercepteur global sur `/api/admin/*`, pas un
décorateur par route : une route oubliée serait une action non tracée, et c'est
celle-là qu'on cherchera le jour d'un litige.

## Modules

```
auth        JWT + Google, refresh rotatif avec détection de vol
account     carnet d'adresses, consentements, export/effacement RGPD
audit       journal des actions d'administration
catalog     produits, variantes, options, catégories, collections, attributs
media       Cloudinary, déclinaisons placeholder/thumbnail/card/zoom
pricing     devises, prix par devise et groupe client, taxes, réglages
inventory   stock, lots, numéros de série, réservations
promotions  moteur de règles, coupons
cart        panier invité et connecté, calcul intégral à chaque lecture
checkout    transformation panier → commande, transaction unique
orders      machine à états, paiements, remboursements, factures, suivi invité
shipping    zones, méthodes, barèmes, créneaux, expéditions
engagement  avis, wishlist, fidélité, retours
content     pages, blog, menus, campagnes, bannières, newsletter, SEO
search      plein texte tsvector + trigramme, facettes, synonymes, épinglage
mail        file d'envoi, 11 gabarits FR/EN
jobs        réservations expirées, paniers abandonnés
```

## Conventions

- **Français** pour les commentaires, messages d'erreur et libellés. Code en
  anglais.
- Les commentaires expliquent **pourquoi**, jamais **quoi**. Un commentaire qui
  paraphrase la ligne suivante est du bruit.
- Un service par domaine ; les contrôleurs ne contiennent pas de logique.
- Tout texte visible par le client passe par une table `*Translation` (FR/EN).
- `npm run lint` et `npm run build` doivent passer avant de considérer une
  tâche terminée.

## Sécurité

- Mots de passe en argon2, refresh tokens stockés hachés avec rotation et
  révocation de famille en cas de rejeu.
- Messages d'erreur identiques sur login inconnu et mot de passe faux, et sur
  suivi de commande avec mauvais numéro ou mauvais email : sinon on permet
  l'énumération.
- SVG interdit au téléversement — il peut embarquer du JavaScript et servi
  depuis le domaine de la boutique c'est une faille XSS.
- Les liens d'accès invité (suivi de commande, désinscription) sont des jetons
  signés HMAC comparés en temps constant.
- Le journal d'audit masque mots de passe, jetons et clés avant écriture.

## Déploiement

Trois conteneurs : Postgres, Redis, l'API. Base et cache sur un réseau
`internal`, sans port publié. Le VPS mutualise un reverse proxy unique pour
plusieurs projets (nginx-proxy-manager, pas Caddy) : l'API rejoint son réseau
`web` externe et s'y fait atteindre par nom de conteneur (`opaline-api`),
sans publier de port elle non plus. Les en-têtes de sécurité sont donc posés
par `helmet()` côté application, pas par le proxy. Procédure complète dans
[DEPLOIEMENT.md](DEPLOIEMENT.md).

GitHub Actions ([.github/workflows/ci-cd.yml](.github/workflows/ci-cd.yml))
construit l'image, la publie sur GHCR, puis se connecte en SSH au VPS pour la
tirer et redémarrer — le VPS ne construit plus rien lui-même.

Trois choix structurants :

- **Les migrations tournent dans un conteneur dédié**, pas au démarrage de
  l'API. Sinon plusieurs réplicas migrent en même temps, et une migration
  ratée empêche l'API de servir l'ancien schéma alors qu'elle en serait
  capable.
- **La sonde de santé interroge `/api/health/live`**, qui ne touche ni la base
  ni Redis : une dépendance momentanément indisponible ne doit pas faire
  redémarrer l'API en boucle.
- **L'image est construite une fois en CI, jamais sur le VPS** : la machine
  héberge une quinzaine d'autres projets, et lui faire compiler à chaque push
  serait lui voler de la mémoire qui ne lui appartient pas.

## Exploitation

Sauvegardes : [scripts/backup.sh](scripts/backup.sh) en cron quotidien sur le
VPS, format `pg_dump -Fc`, rétention 30 jours, vérification de l'archive après
création. [scripts/restore.sh](scripts/restore.sh) à exécuter **au moins une
fois** avant la mise en production.

Les médias vivent chez Cloudinary : rien à sauvegarder côté fichiers.

## État — ce qui manque

À connaître avant de promettre une fonctionnalité :

| Manquant | Détail |
|---|---|
| **Prestataire de paiement** | Le client n'a pas de société, donc pas de compte. Seul `MANUAL` existe. Le port est prêt. |
| **Dashboard admin** | Aucune route de statistiques. Le client pilote à l'aveugle. |
| **Factures PDF** | Le numéro légal existe, le fichier non. Bloqué sur l'identité légale de l'entreprise. |
| **Fidélité dépensable** | Les points s'accumulent, l'utilisation au paiement n'est pas branchée. |
| **Créneaux de livraison** | `DeliverySlot.booked` jamais incrémenté : sur-réservation possible. |
| **Taux de change** | Table jamais alimentée. |
| **Parrainage, cartes cadeaux** | Modélisés, non implémentés — mis de côté par le client. |
| **Tests automatisés** | Tout a été validé par appels HTTP réels, ce qui ne protège pas des régressions. |
| **Sentry** | Non branché. |
| **Hors gabarit au Canada** | Aucun transporteur : un meuble ne peut pas y être commandé. |

**Les taux de TVA et de taxes canadiennes du seed sont un point de départ de
développement.** Ils changent, et les taux réduits comportent des exceptions.
À faire valider par un comptable avant toute vente réelle.
