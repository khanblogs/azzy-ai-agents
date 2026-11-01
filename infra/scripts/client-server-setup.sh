#!/usr/bin/env bash
# Prepare a client VPS so Azzy (Jimmy) can operate it over Tailscale SSH with a
# fixed menu of actions and nothing else.
#
#   sudo APP_DIR=/srv/myapp bash client-server-setup.sh [--tailscale-authkey tskey-...]
#
# Creates:
#   - user `azzy-deploy` (no password, docker group, no interactive use expected)
#   - /usr/local/bin/azzy-action   fixed dispatcher: status|restart|logs|deploy|rollback|disk|top
#   - /etc/azzy-action.conf        APP_DIR + compose file + image repo used by the dispatcher
#   - /etc/sudoers.d/azzy-deploy   NOPASSWD *only* for /usr/local/bin/azzy-action
#   - optional: tailscale up --ssh --advertise-tags=tag:servers
#
# The HQ box (tag:azzy) is allowed by infra/tailscale-acl.json to reach
# tag:servers on :22 as user azzy-deploy. Tailscale SSH does the auth; the
# dispatcher makes sure only allowlisted commands run. If you use classic
# OpenSSH keys instead, pin the key in /home/azzy-deploy/.ssh/authorized_keys as:
#   command="/usr/local/bin/azzy-action",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... azzy-hq
# azzy-action then reads the requested action from SSH_ORIGINAL_COMMAND.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root (sudo)" >&2
  exit 1
fi

APP_DIR="${APP_DIR:-/srv/app}"
COMPOSE_FILE="${COMPOSE_FILE:-$APP_DIR/docker-compose.yml}"
IMAGE_TAG_VAR="${IMAGE_TAG_VAR:-APP_VERSION}"   # variable in $APP_DIR/.env that holds the running version
DEPLOY_USER=azzy-deploy
TS_AUTHKEY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --tailscale-authkey) TS_AUTHKEY="${2:-}"; shift 2 ;;
    --app-dir) APP_DIR="$2"; COMPOSE_FILE="$APP_DIR/docker-compose.yml"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

echo "[client-setup] app dir: $APP_DIR"
mkdir -p "$APP_DIR"

# ---- user -------------------------------------------------------------------
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash --comment "AZZY AI AGENTS v2.0 deploy agent" "$DEPLOY_USER"
fi
passwd -l "$DEPLOY_USER" >/dev/null 2>&1 || true
if getent group docker >/dev/null 2>&1; then
  usermod -aG docker "$DEPLOY_USER"
fi
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"

# ---- config -----------------------------------------------------------------
cat > /etc/azzy-action.conf <<EOF
# Read by /usr/local/bin/azzy-action. Root-owned, not writable by azzy-deploy.
APP_DIR=$APP_DIR
COMPOSE_FILE=$COMPOSE_FILE
IMAGE_TAG_VAR=$IMAGE_TAG_VAR
EOF
chmod 644 /etc/azzy-action.conf

# ---- dispatcher -------------------------------------------------------------
cat > /usr/local/bin/azzy-action <<'DISPATCH'
#!/usr/bin/env bash
# azzy-action: the only thing azzy-deploy may run. Fixed commands, no shell.
#
#   azzy-action status|restart|logs [service]|deploy vX.Y.Z|rollback|disk|top
#   As SSH ForceCommand it reads the action from $SSH_ORIGINAL_COMMAND.
set -euo pipefail
umask 022

# shellcheck disable=SC1091
. /etc/azzy-action.conf
APP_DIR="${APP_DIR:?}"
COMPOSE_FILE="${COMPOSE_FILE:?}"
IMAGE_TAG_VAR="${IMAGE_TAG_VAR:-APP_VERSION}"
ENV_FILE="$APP_DIR/.env"
PREV_FILE="$APP_DIR/.azzy-previous-version"
LOG=/var/log/azzy-action.log
VERSION_RE='^v[0-9]+\.[0-9]+\.[0-9]+$'
SERVICE_RE='^[a-z][a-z0-9_-]{0,31}$'

# When invoked by sshd as ForceCommand, the real request is in SSH_ORIGINAL_COMMAND.
if [ $# -eq 0 ] && [ -n "${SSH_ORIGINAL_COMMAND:-}" ]; then
  # shellcheck disable=SC2206
  set -- $SSH_ORIGINAL_COMMAND
  [ "${1:-}" = "azzy-action" ] && shift
fi

# Re-exec as root through the sudoers rule when started as azzy-deploy.
if [ "$(id -u)" -ne 0 ]; then
  exec sudo -n /usr/local/bin/azzy-action "$@"
fi

action="${1:-}"
shift || true

audit() { printf '%s user=%s action=%s args=%s\n' "$(date -Is)" "${SUDO_USER:-$(id -un)}" "$action" "$*" >> "$LOG"; }
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
die() { echo "azzy-action: $*" >&2; exit 2; }

[ -f "$COMPOSE_FILE" ] || die "compose file not found: $COMPOSE_FILE"

current_version() {
  if [ -f "$ENV_FILE" ]; then
    grep -E "^${IMAGE_TAG_VAR}=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '"' || true
  fi
}

set_version() {
  local v="$1"
  touch "$ENV_FILE"
  if grep -qE "^${IMAGE_TAG_VAR}=" "$ENV_FILE"; then
    sed -i -E "s|^${IMAGE_TAG_VAR}=.*|${IMAGE_TAG_VAR}=${v}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$IMAGE_TAG_VAR" "$v" >> "$ENV_FILE"
  fi
}

case "$action" in
  status)
    audit "$@"
    echo "version: $(current_version)"
    compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
    ;;
  restart)
    audit "$@"
    compose restart
    compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
    ;;
  logs)
    svc="${1:-}"
    audit "$svc"
    if [ -n "$svc" ]; then
      [[ "$svc" =~ $SERVICE_RE ]] || die "bad service name"
      compose logs --no-color --tail=200 "$svc"
    else
      compose logs --no-color --tail=200
    fi
    ;;
  deploy)
    v="${1:-}"
    [[ "$v" =~ $VERSION_RE ]] || die "deploy needs a version like v2.3.0"
    audit "$v"
    prev="$(current_version)"
    [ -n "$prev" ] && printf '%s\n' "$prev" > "$PREV_FILE"
    set_version "$v"
    compose pull --quiet
    compose up -d --remove-orphans
    echo "deployed: $v (previous: ${prev:-none})"
    compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
    ;;
  rollback)
    audit "$@"
    [ -s "$PREV_FILE" ] || die "no previous version recorded"
    prev="$(cat "$PREV_FILE")"
    [[ "$prev" =~ $VERSION_RE ]] || die "recorded previous version is invalid"
    cur="$(current_version)"
    set_version "$prev"
    [ -n "$cur" ] && printf '%s\n' "$cur" > "$PREV_FILE"
    compose pull --quiet
    compose up -d --remove-orphans
    echo "rolled back to: $prev (was: ${cur:-unknown})"
    compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
    ;;
  disk)
    audit "$@"
    df -h / "$APP_DIR" 2>/dev/null | awk '!seen[$0]++'
    docker system df
    ;;
  top)
    audit "$@"
    uptime
    docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}'
    ;;
  ""|help|-h|--help)
    echo "usage: azzy-action status|restart|logs [service]|deploy vX.Y.Z|rollback|disk|top"
    ;;
  *)
    audit "$@"
    die "action not allowed: $action"
    ;;
esac
DISPATCH
chmod 755 /usr/local/bin/azzy-action
chown root:root /usr/local/bin/azzy-action
touch /var/log/azzy-action.log
chmod 640 /var/log/azzy-action.log

# ---- sudoers ----------------------------------------------------------------
cat > /etc/sudoers.d/azzy-deploy <<'SUDO'
# AZZY AI AGENTS v2.0: azzy-deploy may run the fixed dispatcher as root, nothing else.
Defaults:azzy-deploy !requiretty
Defaults:azzy-deploy env_reset
azzy-deploy ALL=(root) NOPASSWD: /usr/local/bin/azzy-action
SUDO
chmod 440 /etc/sudoers.d/azzy-deploy
visudo -cf /etc/sudoers.d/azzy-deploy

# ---- tailscale (optional) ---------------------------------------------------
if [ -n "$TS_AUTHKEY" ]; then
  if ! command -v tailscale >/dev/null 2>&1; then
    curl -fsSL https://tailscale.com/install.sh | sh
  fi
  systemctl enable --now tailscaled
  tailscale up --authkey="$TS_AUTHKEY" --ssh --advertise-tags=tag:servers --accept-dns=false
  echo "[client-setup] joined tailnet as tag:servers"
else
  echo "[client-setup] skip tailscale (pass --tailscale-authkey to join); make sure the node carries tag:servers and has 'tailscale up --ssh'"
fi

echo "[client-setup] done. Test from HQ: ssh azzy-deploy@<tailscale-ip> azzy-action status"
