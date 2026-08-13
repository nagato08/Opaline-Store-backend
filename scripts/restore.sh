#!/usr/bin/env bash
#
# Restauration d'une sauvegarde.
#
# À exécuter au moins une fois avant la mise en production : une sauvegarde
# jamais restaurée n'est pas une sauvegarde.
#
#   DATABASE_URL='postgresql://…' ./scripts/restore.sh /var/backups/ecommerce/ecommerce-20260811-031500.dump

set -euo pipefail

ARCHIVE="${1:?Chemin de archive requis}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL est requis}"

echo "ATTENTION : le contenu actuel de la base sera remplacé."
read -r -p "Confirmer la restauration depuis $ARCHIVE ? [oui/non] " answer

if [ "$answer" != "oui" ]; then
  echo "Annulé."
  exit 1
fi

pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="$DATABASE_URL" "$ARCHIVE"

echo "Restauration terminée."
