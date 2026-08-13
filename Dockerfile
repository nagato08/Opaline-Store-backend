# syntax=docker/dockerfile:1

# Image de production de l'API.
#
# Base Debian slim plutôt qu'Alpine : le moteur de migration Prisma est lié à
# la glibc, et le faire tourner sur musl demande des contorsions pour un gain
# de taille dérisoire.

ARG NODE_VERSION=24-bookworm-slim

# --- Étape 1 : dépendances complètes -----------------------------------------
# Séparée du code source pour que le cache Docker ne soit invalidé que lorsque
# les dépendances changent, pas à chaque modification d'un fichier .ts.
FROM node:${NODE_VERSION} AS deps

WORKDIR /app

# `openssl` est requis par Prisma pour la détection de plateforme.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci


# --- Étape 2 : compilation ---------------------------------------------------
FROM deps AS build

WORKDIR /app

COPY prisma ./prisma
COPY prisma.config.ts tsconfig*.json nest-cli.json ./
COPY src ./src

# Le client Prisma est généré dans src/generated : il doit exister avant que
# TypeScript compile, puisque le code l'importe.
RUN npx prisma generate
RUN npm run build


# --- Étape 3 : dépendances de production uniquement --------------------------
FROM deps AS prod-deps

WORKDIR /app
RUN npm ci --omit=dev

# `prisma` est une dépendance obligatoire de `@prisma/client` en v7, mais il
# embarque Prisma Studio et l'outillage de développement — une soixantaine de
# mégaoctets qui ne servent jamais à l'exécution. Les migrations tournent dans
# l'image `migrator`, qui conserve l'installation complète.
RUN rm -rf node_modules/@prisma/studio-core \
           node_modules/@prisma/dev \
 # Le paquet argon2 livre les binaires précompilés de toutes les plateformes ;
 # le conteneur n'en utilise qu'un.
 && find node_modules/argon2/prebuilds -mindepth 1 -maxdepth 1 \
      ! -name 'linux-x64' -exec rm -rf {} + 2>/dev/null || true


# --- Étape 4 : migrateur -----------------------------------------------------
# Image dédiée aux migrations, lancée en tâche ponctuelle avant l'API.
#
# Migrer depuis un conteneur séparé plutôt qu'au démarrage de l'API évite deux
# ennuis : plusieurs réplicas qui migrent en même temps, et une API qui refuse
# de démarrer parce qu'une migration a échoué alors qu'elle pourrait encore
# servir l'ancien schéma.
FROM build AS migrator

WORKDIR /app
USER node
CMD ["npx", "prisma", "migrate", "deploy"]


# --- Étape 5 : image finale --------------------------------------------------
FROM node:${NODE_VERSION} AS runner

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Les exports RGPD sont écrits sur disque : le dossier doit exister et
# appartenir à l'utilisateur non privilégié.
RUN mkdir -p /app/storage/exports && chown -R node:node /app/storage

# Jamais root : une exécution de code arbitraire se retrouverait sinon avec
# tous les droits dans le conteneur.
USER node

EXPOSE 3000

# La sonde interroge la route de vivacité, qui ne touche ni la base ni Redis :
# une dépendance momentanément indisponible ne doit pas faire redémarrer l'API
# en boucle alors qu'elle est capable de répondre.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health/live || exit 1

CMD ["node", "dist/main.js"]
