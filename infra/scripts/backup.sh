#!/usr/bin/env bash
# Nightly Postgres backup: pg_dump inside the postgres container -> gzip ->
# /var/backups/azzy (keep last 7) -> s3://$BACKUP_BUCKET/postgres/ when set.
#
#   bash infra/scripts/backup.sh
# Env: BACKUP_BUCKET (or read from infra/.env), BACKUP_DIR (default /var/backups/azzy), KEEP_LOCAL (7)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE=(docker compose -f "$INFRA_DIR/docker-compose.yml")
BACKUP_DIR="${BACKUP_DIR:-/var/backups/azzy}"
KEEP_LOCAL="${KEEP_LOCAL:-7}"

log() { echo "[backup] $(date -Is) $*"; }

# BACKUP_BUCKET may come from the environment or from infra/.env.
if [ -z "${BACKUP_BUCKET:-}" ] && [ -f "$INFRA_DIR/.env" ]; then
  BACKUP_BUCKET="$(grep -E '^BACKUP_BUCKET=' "$INFRA_DIR/.env" | tail -n1 | cut -d= -f2- | tr -d '"' || true)"
fi
BACKUP_BUCKET="${BACKUP_BUCKET:-}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
host="$(hostname -s 2>/dev/null || echo azzy)"
file="$BACKUP_DIR/azzy-${host}-${stamp}.sql.gz"

log "dumping database -> $file"
"${COMPOSE[@]}" exec -T postgres pg_dump -U azzy -d azzy --no-owner --no-privileges \
  | gzip -9 > "$file.partial"
mv "$file.partial" "$file"
size="$(du -h "$file" | cut -f1)"
log "dump ok ($size)"

if [ -n "$BACKUP_BUCKET" ]; then
  key="postgres/$(basename "$file")"
  log "uploading to s3://$BACKUP_BUCKET/$key"
  aws s3 cp "$file" "s3://$BACKUP_BUCKET/$key" --only-show-errors --sse AES256
  log "upload ok"
else
  log "BACKUP_BUCKET not set; local copy only"
fi

# Keep only the newest $KEEP_LOCAL dumps locally.
mapfile -t old < <(ls -1t "$BACKUP_DIR"/azzy-*.sql.gz 2>/dev/null | tail -n +"$((KEEP_LOCAL + 1))")
if [ "${#old[@]}" -gt 0 ]; then
  log "removing ${#old[@]} old local dump(s)"
  rm -f -- "${old[@]}"
fi

log "done"
