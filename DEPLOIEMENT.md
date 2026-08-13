# Déploiement sur VPS

L'API tourne dans quatre conteneurs : Postgres, Redis, l'API, et Caddy en
proxy TLS. **Seul Caddy expose des ports** — la base et le cache vivent sur un
réseau Docker marqué `internal`, inatteignable depuis Internet même en cas
d'erreur de pare-feu.

## Prérequis sur le VPS

```bash
# Docker + compose
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # puis se reconnecter

# Pare-feu : uniquement SSH, HTTP et HTTPS
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```

## DNS

Trois enregistrements `A` vers l'IP du VPS :

| Sous-domaine | Sert |
|---|---|
| `api.…` | cette API |
| `boutique.…` (ou le domaine nu) | la boutique client |
| `admin.…` | le back-office |

Caddy demande les certificats Let's Encrypt tout seul **une fois que le DNS
est propagé** : inutile de toucher à certbot. Vérifier avant de démarrer,
sinon Caddy échoue et réessaie avec un délai croissant.

## Installation

```bash
git clone <dépôt> comptoir && cd comptoir/back_ecommerce
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

Puis :

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

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

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Les migrations rejouent seules ; celles déjà appliquées sont ignorées.

## Sauvegardes

Le service Postgres monte `./backups`. Sur l'hôte :

```bash
crontab -e
15 3 * * * cd /chemin/comptoir/back_ecommerce && \
  docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -T postgres pg_dump -U comptoir -Fc comptoir > backups/comptoir-$(date +\%F).dump
```

**Restaurer au moins une fois avant la mise en production** : une sauvegarde
jamais restaurée n'est pas une sauvegarde. Voir `scripts/restore.sh`.

Les médias vivent chez Cloudinary, rien à sauvegarder côté fichiers.

## Exploitation courante

```bash
# Journaux
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api

# État de santé
curl https://api.<domaine>/api/health

# Console SQL
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec postgres psql -U comptoir -d comptoir
```

`/api/health` interroge la base et Redis. `/api/health/live` répond sans les
toucher : c'est cette route que Docker utilise pour la sonde, afin qu'une base
momentanément indisponible ne fasse pas redémarrer l'API en boucle.

## Ce qui a été vérifié

Pile complète montée localement, base vide, puis :

- migrations appliquées par le conteneur dédié, **114 tables** créées
- API saine, base et Redis joignables
- **aucun port publié** pour Postgres et Redis
- HTTPS servi par Caddy, redirection 308 depuis HTTP
- en-têtes `Strict-Transport-Security`, `X-Content-Type-Options`,
  `Referrer-Policy` présents, en-tête `Server` supprimé
- CORS : origine boutique acceptée, origine inconnue refusée
- connexion, recherche et calcul de TVA fonctionnels dans le conteneur

## Points ouverts

- **Pas de supervision** : ni Sentry, ni alerte si un conteneur tombe. Prévoir
  au minimum une sonde externe sur `/api/health`.
- **Pas de limite de ressources** sur les conteneurs : une fuite mémoire peut
  saturer le VPS. Ajouter `deploy.resources.limits` si la machine est petite.
- L'image pèse **591 Mo**, l'essentiel venant de Prisma. Studio et l'outillage
  de développement sont déjà élagués.
- Le conteneur `migrate` embarque le CLI Prisma, donc de quoi réécrire le
  schéma. Il ne tourne que le temps de la migration, mais son image reste sur
  la machine.
