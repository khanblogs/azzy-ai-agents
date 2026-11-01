#!/usr/bin/env bash
# Pull the latest code and roll the stack. Used by CI through SSM
# (`cd /opt/azzy-ai-agents && bash infra/scripts/deploy.sh`) and by hand.
#
#   bash infra/scripts/deploy.sh [branch]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$REPO_DIR/infra/docker-compose.yml"
BRANCH="${1:-$(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD)}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1/healthz}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}"

log() { echo "[deploy] $(date -Is) $*"; }

if [ ! -f "$REPO_DIR/infra/.env" ]; then
  log "ERROR: $REPO_DIR/infra/.env missing (bootstrap writes it from Secrets Manager)"
  exit 1
fi

before="$(git -C "$REPO_DIR" rev-parse --short HEAD)"
log "fetching origin/$BRANCH (currently $before)"
git -C "$REPO_DIR" fetch --prune origin "$BRANCH"
git -C "$REPO_DIR" checkout -q "$BRANCH"
git -C "$REPO_DIR" reset -q --hard "origin/$BRANCH"
after="$(git -C "$REPO_DIR" rev-parse --short HEAD)"
log "now at $after"

log "building + rolling services"
docker compose -f "$COMPOSE_FILE" build --pull
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

log "waiting for $HEALTH_URL (timeout ${HEALTH_TIMEOUT}s)"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
until curl -fsS "$HEALTH_URL" >/dev/null 2>&1; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    log "ERROR: stack not healthy after ${HEALTH_TIMEOUT}s"
    docker compose -f "$COMPOSE_FILE" ps
    docker compose -f "$COMPOSE_FILE" logs --tail=100 api web nginx
    exit 1
  fi
  sleep 5
done

log "pruning dangling images"
docker image prune -f >/dev/null 2>&1 || true

docker compose -f "$COMPOSE_FILE" ps
log "ok ($before -> $after)"
