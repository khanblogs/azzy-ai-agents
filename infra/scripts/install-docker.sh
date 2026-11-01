#!/usr/bin/env bash
# Prepare an existing VM for AZZY AI AGENTS v2.0 (manual deployment path).
#
#   sudo bash infra/scripts/install-docker.sh
#
# Ubuntu 22.04 / 24.04 (and Debian 12): installs docker-ce + the compose plugin
# from Docker's apt repository, adds the invoking user to the `docker` group,
# enables the service, and creates a 2 GiB swapfile when the box has none.
# Amazon Linux 2023: installs docker + compose plugin from the AL repos.
# Idempotent: safe to re-run.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root: sudo bash $0" >&2
  exit 1
fi

TARGET_USER="${SUDO_USER:-${USER:-}}"
. /etc/os-release
ID_LIKE="${ID_LIKE:-}"
log() { echo "[install-docker] $*"; }

install_debian_like() {
  export DEBIAN_FRONTEND=noninteractive
  case "${VERSION_CODENAME:-}" in
    jammy|noble|bookworm) ;;
    *) log "WARN: untested release ${PRETTY_NAME}; continuing with codename ${VERSION_CODENAME:-unknown}" ;;
  esac
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg git
  if ! command -v docker >/dev/null 2>&1; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${ID}/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  elif ! docker compose version >/dev/null 2>&1; then
    apt-get install -y docker-compose-plugin docker-buildx-plugin
  fi
}

install_amazon_linux() {
  dnf install -y docker git
  if ! docker compose version >/dev/null 2>&1; then
    mkdir -p /usr/local/lib/docker/cli-plugins
    arch="$(uname -m)"
    curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-${arch}" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  fi
}

case "$ID" in
  ubuntu|debian) install_debian_like ;;
  amzn)
    if [ "${VERSION_ID:-}" != "2023" ]; then
      log "ERROR: only Amazon Linux 2023 is supported (found ${PRETTY_NAME})"; exit 1
    fi
    install_amazon_linux ;;
  *)
    if [[ "$ID_LIKE" == *debian* ]] || [[ "$ID_LIKE" == *ubuntu* ]]; then
      install_debian_like
    else
      log "ERROR: unsupported distribution ${PRETTY_NAME}. Install Docker Engine 24+ and the compose plugin manually, then re-run."
      exit 1
    fi ;;
esac

systemctl enable --now docker
if [ -n "$TARGET_USER" ] && [ "$TARGET_USER" != "root" ]; then
  usermod -aG docker "$TARGET_USER"
  log "added $TARGET_USER to the docker group (log out and back in for it to apply)"
fi

# ---- swap safety net (2 GiB) -----------------------------------------------
if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  log "created 2 GiB swapfile"
else
  log "swap already present"
fi
sysctl -w vm.swappiness=10 >/dev/null
echo 'vm.swappiness=10' > /etc/sysctl.d/99-azzy.conf

log "docker: $(docker --version)"
log "compose: $(docker compose version)"
log "done. Next: cp infra/.env.example infra/.env && docker compose -f infra/docker-compose.yml up -d --build"
