#!/usr/bin/env bash
#
# Sauvegarde PostgreSQL pour VPS.
#
# Format personnalisé (-Fc) : compressé, et surtout restaurable table par
# table avec pg_restore, ce qu'un dump SQL brut ne permet pas.
#
# Installation (cron quotidien à 3h15) :
#   crontab -e
#   15 3 * * * DATABASE_URL='postgresql://…' /chemin/scripts/backup.sh >> /var/log/ecommerce-backup.log 2>&1

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/ecommerce}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
DATABASE_URL="${DATABASE_URL:?DATABASE_URL est requis}"

STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE="$BACKUP_DIR/ecommerce-$STAMP.dump"

mkdir -p "$BACKUP_DIR"

echo "[$(date -Is)] Sauvegarde vers $ARCHIVE"
pg_dump --format=custom --no-owner --no-privileges --file="$ARCHIVE" "$DATABASE_URL"

# Une sauvegarde qu'on ne sait pas relire n'en est pas une : on vérifie que
# l'archive est lisible avant de la considérer valide.
pg_restore --list "$ARCHIVE" > /dev/null
echo "[$(date -Is)] Archive vérifiée ($(du -h "$ARCHIVE" | cut -f1))"

find "$BACKUP_DIR" -name 'ecommerce-*.dump' -mtime "+$RETENTION_DAYS" -delete

# Les médias vivent chez Cloudinary : rien à sauvegarder côté fichiers, hormis
# les exports RGPD, qui sont régénérables à la demande.
echo "[$(date -Is)] Terminé. Archives conservées : $(find "$BACKUP_DIR" -name 'ecommerce-*.dump' | wc -l)"
