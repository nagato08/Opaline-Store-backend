# Déploiement sur VPS

Ce VPS héberge plusieurs projets derrière un **unique reverse proxy partagé**,
nginx-proxy-manager (conteneur `npm`) : c'est lui qui occupe les ports 80 et
443 et gère les certificats Let's Encrypt, pas un Caddy dédié à cette API.
L'API tourne dans trois conteneurs — Postgres, Redis, `opaline-api` — reliés
par un réseau `interne` (marqué `internal`, inatteignable depuis Internet) et
un réseau `web` externe, **partagé avec les autres projets du VPS**, où NPM
atteint `opaline-api` par son nom de conteneur. Aucun de ces trois conteneurs
ne publie de port sur l'hôte.

Les en-têtes de sécurité (HSTS, nosniff…) sont posés par `helmet()` côté
application (`src/main.ts`), pas par le proxy : ils restent vrais quel que
soit ce qui tourne devant.

Les images ne sont **pas construites sur le VPS**. GitHub Actions les
construit et les publie sur `ghcr.io/<compte>/opaline-api` et
`opaline-api-migrator` ; le VPS se contente de les tirer. Voir
`.github/workflows/ci-cd.yml`.

## Prérequis sur le VPS

Docker et compose sont déjà installés sur ce VPS, ainsi que
nginx-proxy-manager (`~/npm`) et le réseau externe `web` qu'il utilise :

```bash
docker network ls | grep web   # doit exister déjà
```

S'il n'existe pas encore : `docker network create web`.

L'authentification à GHCR doit être configurée une fois sur le VPS pour que
`docker compose pull` fonctionne :

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u <compte-github> --password-stdin
```

(Un jeton d'accès personnel GitHub avec le scope `read:packages` suffit.)

## DNS

Trois enregistrements `A` vers l'IP du VPS, déjà en place :

| Sous-domaine | Sert |
|---|---|
| `api.opaline.…` | cette API |
| `opaline.…` | la boutique client |
| `admin.opaline.…` | le back-office |

## Proxy — à faire une fois dans l'interface NPM

NPM ne lit pas ce dépôt : chaque domaine se déclare à la main dans son
interface d'administration (`http://<vps>:81`), **Proxy Hosts → Add Proxy
Host**, un hôte par sous-domaine :

| Domain Names | Forward Hostname / IP | Forward Port | SSL |
|---|---|---|---|
| `api.opaline.tadjo.dev` | `opaline-api` | `3000` | Let's Encrypt, Force SSL |

Le nom de conteneur (`opaline-api`) ne se résout que si NPM et l'API sont sur
le même réseau Docker (`web`) — c'est le cas dès que `docker compose up`
tourne une première fois avec le fichier de ce dépôt.

## Installation

```bash
git clone https://github.com/<compte>/Opaline-Store.git opaline-api
cd opaline-api
cp .env.production.example .env.production
```

Remplir `.env.production`. Les secrets se génèrent avec :

```bash
openssl rand -hex 32     # une valeur par secret JWT
openssl rand -base64 24  # mots de passe Postgres et Redis
```

Points de vigilance :

- **`DATABASE_URL` et `REDIS_URL` utilisent les noms de services** (`postgres`,
  `redis`), pas `localhost` : ils sont résolus dans le réseau Docker.
- Les secrets JWT font **32 caractères minimum**, sinon l'application refuse
  de démarrer — c'est volontaire.
- `STOREFRONT_URL` et `ADMIN_URL` déterminent la politique CORS. Une URL
  inexacte et les deux interfaces ne pourront pas appeler l'API.

Puis, une fois qu'un premier passage de `.github/workflows/ci-cd.yml` a publié
les images (pousser sur `main` suffit à le déclencher) :

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

Avant ce premier passage, les images n'existent pas encore sur GHCR : ajouter
`--build` reconstruit localement à la place, une seule fois.

L'ordre est géré : Postgres démarre, devient sain, `migrate` applique les
migrations et s'arrête, puis l'API démarre. Si une migration échoue, l'API ne
démarre pas — c'est le comportement souhaité.

**Le seed n'est pas exécuté automatiquement.** Première installation seulement :

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  run --rm migrate npx prisma db seed
```

Il crée les devises, pays, taux de taxe, transporteurs, réglages et le compte
administrateur. **Changer le mot de passe admin immédiatement après.**

## Mise à jour

**Automatique** : un push sur `main` déclenche `.github/workflows/ci-cd.yml`,
qui construit les images, les publie sur GHCR, puis se connecte en SSH au VPS
pour les tirer et redémarrer les services. Rien à faire à la main.

Manuellement si besoin :

```bash
cd opaline-api && git pull
docker compose -f docker-compose.prod.yml --env-file .env.production pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

Les migrations rejouent seules ; celles déjà appliquées sont ignorées.

## Sauvegardes

Le service Postgres monte `./backups`. Sur l'hôte :

```bash
crontab -e
15 3 * * * cd /home/nagato/opaline-api && \
  docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -T postgres pg_dump -U opaline -Fc opaline > backups/opaline-$(date +\%F).dump
```

**Restaurer au moins une fois avant la mise en production** : une sauvegarde
jamais restaurée n'est pas une sauvegarde. Voir `scripts/restore.sh`.

Les médias vivent chez Cloudinary, rien à sauvegarder côté fichiers.

## Exploitation courante

```bash
# Journaux
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api

# État de santé
curl https://api.opaline.tadjo.dev/api/health

# Console SQL
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec postgres psql -U opaline -d opaline
```

`/api/health` interroge la base et Redis. `/api/health/live` répond sans les
toucher : c'est cette route que Docker utilise pour la sonde, afin qu'une base
momentanément indisponible ne fasse pas redémarrer l'API en boucle.

## Ce qui a été vérifié

Pile complète montée localement, base vide, puis :

- migrations appliquées par le conteneur dédié, **114 tables** créées
- API saine, base et Redis joignables
- **aucun port publié** pour Postgres, Redis et l'API elle-même
- en-têtes `Strict-Transport-Security`, `X-Content-Type-Options`,
  `Referrer-Policy` présents (posés par `helmet()`)
- CORS : origine boutique acceptée, origine inconnue refusée
- connexion, recherche et calcul de TVA fonctionnels dans le conteneur

Le VPS lui-même héberge une quinzaine d'autres projets derrière le même NPM
(7,8 Gio de RAM, ~4 Gio libres au moment de l'ajout de ce projet) : cette API
partage la machine, elle ne la possède pas.

## Points ouverts

- **Pas de supervision** : ni Sentry, ni alerte si un conteneur tombe. Prévoir
  au minimum une sonde externe sur `/api/health`.
- **Pas de limite de ressources** sur les conteneurs : une fuite mémoire peut
  affecter les autres projets du même VPS, pas seulement celui-ci. Ajouter
  `deploy.resources.limits` serait plus prudent sur une machine partagée.
- L'image pèse **591 Mo**, l'essentiel venant de Prisma. Studio et l'outillage
  de développement sont déjà élagués.
- Le conteneur `migrate` embarque le CLI Prisma, donc de quoi réécrire le
  schéma. Il ne tourne que le temps de la migration, mais son image reste sur
  la machine.
- **Les en-têtes de sécurité posés par NPM lui-même ne sont pas vérifiés** —
  seuls ceux de `helmet()` le sont. Si NPM ajoute ses propres en-têtes en
  amont, vérifier qu'ils ne se contredisent pas.
