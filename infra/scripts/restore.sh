#!/usr/bin/env bash
# Restore a Postgres dump made by backup.sh.
#
#   bash infra/scripts/restore.sh /var/backups/azzy/azzy-host-20250101T030000Z.sql.gz
#   bash infra/scripts/restore.sh s3://<bucket>/postgres/azzy-host-20250101T030000Z.sql.gz
#   bash infra/scripts/restore.sh --latest          # newest object in s3://$BACKUP_BUCKET/postgres/
#
# Stops api + worker, drops and recreates the `azzy` database, loads the dump,
# then starts the stack again. Asks for confirmation unless FORCE=1.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE=(docker compose -f "$INFRA_DIR/docker-compose.yml")
SRC="${1:-}"

log() { echo "[restore] $(date -Is) $*"; }

if [ -z "$SRC" ]; then
  echo "usage: $0 <file.sql.gz | s3://bucket/key.sql.gz | --latest>" >&2
  exit 2
fi

if [ -z "${BACKUP_BUCKET:-}" ] && [ -f "$INFRA_DIR/.env" ]; then
  BACKUP_BUCKET="$(grep -E '^BACKUP_BUCKET=' "$INFRA_DIR/.env" | tail -n1 | cut -d= -f2- | tr -d '"' || true)"
fi
BACKUP_BUCKET="${BACKUP_BUCKET:-}"

workdir="$(mktemp -d)"
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT

if [ "$SRC" = "--latest" ]; then
  if [ -z "$BACKUP_BUCKET" ]; then
    log "ERROR: --latest needs BACKUP_BUCKET"
    exit 1
  fi
  key="$(aws s3 ls "s3://$BACKUP_BUCKET/postgres/" | sort | tail -n1 | awk '{print $4}')"
  if [ -z "$key" ]; then
    log "ERROR: no dumps found in s3://$BACKUP_BUCKET/postgres/"
    exit 1
  fi
  SRC="s3://$BACKUP_BUCKET/postgres/$key"
fi

case "$SRC" in
  s3://*)
    local_file="$workdir/$(basename "$SRC")"
    log "downloading $SRC"
    aws s3 cp "$SRC" "$local_file" --only-show-errors
    ;;
  *)
    local_file="$SRC"
    ;;
esac

if [ ! -s "$local_file" ]; then
  log "ERROR: $local_file is missing or empty"
  exit 1
fi
gzip -t "$local_file"

if [ "${FORCE:-0}" != "1" ]; then
  echo "This will DROP and recreate the 'azzy' database from: $local_file"
  read -r -p "Type 'restore' to continue: " answer
  if [ "$answer" != "restore" ]; then
    log "aborted"
    exit 1
  fi
fi

log "stopping api and worker"
"${COMPOSE[@]}" stop worker api
"${COMPOSE[@]}" up -d postgres
until "${COMPOSE[@]}" exec -T postgres pg_isready -U azzy -d postgres >/dev/null 2>&1; do sleep 2; done

log "recreating database"
"${COMPOSE[@]}" exec -T postgres psql -U azzy -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'azzy' AND pid <> pg_backend_pid();" >/dev/null
"${COMPOSE[@]}" exec -T postgres psql -U azzy -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS azzy;"
"${COMPOSE[@]}" exec -T postgres psql -U azzy -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE azzy OWNER azzy;"
"${COMPOSE[@]}" exec -T postgres psql -U azzy -d azzy -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS vector;"

log "loading dump"
gunzip -c "$local_file" | "${COMPOSE[@]}" exec -T postgres psql -U azzy -d azzy -v ON_ERROR_STOP=1 -q

log "starting api and worker"
"${COMPOSE[@]}" up -d api worker
log "done"
