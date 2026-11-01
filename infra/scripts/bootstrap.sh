#!/usr/bin/env bash
# AZZY AI AGENTS HQ bootstrap — EC2 user-data for Ubuntu 24.04.
#
# Rendered by Terraform (templatefile) with: repo_url, branch, aws_region.
# NOTE: this file is a Terraform template. Bash "$${VAR}" is written with a
# doubled dollar so Terraform leaves it alone; plain "$VAR" needs no escaping.
#
# What it does (idempotent, safe to re-run as root):
#   0. 2 GiB swapfile (safety net on a 16 GB box)
#   1. apt: docker-ce + compose plugin, awscli, jq, git
#   2. tailscale: join with the authkey from Secrets Manager `azzy/tailscale`
#      (--ssh, --advertise-tags=tag:azzy)
#   3. clone/update the repo into /opt/azzy-ai-agents
#   4. write Secrets Manager `azzy/env` -> /opt/azzy-ai-agents/infra/.env
#   5. docker compose up -d --build
#   6. systemd unit so the stack comes back after reboot
#   7. nightly backup cron at 03:00
set -euo pipefail

# Environment overrides let the rendered script be re-run by hand with other values.
REPO_URL="$${REPO_URL:-${repo_url}}"
BRANCH="$${BRANCH:-${branch}}"
AWS_REGION="$${AWS_REGION:-${aws_region}}"
APP_DIR=/opt/azzy-ai-agents
LOG=/var/log/azzy-bootstrap.log

exec > >(tee -a "$LOG") 2>&1
echo "[bootstrap] $(date -Is) start repo=$REPO_URL branch=$BRANCH region=$AWS_REGION"

export DEBIAN_FRONTEND=noninteractive
export AWS_DEFAULT_REGION="$AWS_REGION"

# ---- 0. swap safety net (2 GiB) --------------------------------------------
if ! swapon --show | grep -q '^/swapfile'; then
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -w vm.swappiness=10 >/dev/null
grep -q '^vm.swappiness' /etc/sysctl.d/99-azzy.conf 2>/dev/null || echo 'vm.swappiness=10' > /etc/sysctl.d/99-azzy.conf

# ---- 1. packages ------------------------------------------------------------
apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release git jq unzip

if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  arch="$(dpkg --print-architecture)"
  echo "deb [arch=$arch signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $codename stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
usermod -aG docker ubuntu || true

if ! command -v aws >/dev/null 2>&1; then
  tmp="$(mktemp -d)"
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "$tmp/awscliv2.zip"
  unzip -q "$tmp/awscliv2.zip" -d "$tmp"
  "$tmp/aws/install" --update
  rm -rf "$tmp"
fi

# SSM agent ships with Ubuntu AMIs as a snap; make sure it is running for CI deploys.
if snap list amazon-ssm-agent >/dev/null 2>&1; then
  snap start amazon-ssm-agent || true
fi

# ---- 2. tailscale -----------------------------------------------------------
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
systemctl enable --now tailscaled

TS_AUTHKEY="$(aws secretsmanager get-secret-value --secret-id azzy/tailscale --query SecretString --output text 2>/dev/null \
  | jq -r '.authkey // empty' 2>/dev/null || true)"
if [ -n "$TS_AUTHKEY" ] && [ "$TS_AUTHKEY" != "REPLACE_ME" ]; then
  if ! tailscale status >/dev/null 2>&1; then
    tailscale up --authkey="$TS_AUTHKEY" --ssh --advertise-tags=tag:azzy --hostname=azzy-hq --accept-dns=false
  fi
else
  echo "[bootstrap] WARN: azzy/tailscale has no authkey; skipping tailscale up (run it manually)."
fi
unset TS_AUTHKEY

# ---- 3. repo ----------------------------------------------------------------
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" checkout -q "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  rm -rf "$APP_DIR"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
# Strip any embedded token from the remote so it does not linger on disk.
git -C "$APP_DIR" remote set-url origin "$(echo "$REPO_URL" | sed -E 's#https://[^@/]+@#https://#')"
chown -R ubuntu:ubuntu "$APP_DIR"

# ---- 4. env from Secrets Manager -------------------------------------------
ENV_FILE="$APP_DIR/infra/.env"
if aws secretsmanager get-secret-value --secret-id azzy/env --query SecretString --output text > "$ENV_FILE.tmp" 2>/dev/null \
   && grep -q '^OWNER_EMAIL=' "$ENV_FILE.tmp"; then
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  echo "[bootstrap] wrote infra/.env from azzy/env"
else
  rm -f "$ENV_FILE.tmp"
  if [ ! -f "$ENV_FILE" ]; then
    cp "$APP_DIR/infra/.env.example" "$ENV_FILE"
    sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" "$ENV_FILE"
    sed -i "s/^WEBHOOK_SECRET=.*/WEBHOOK_SECRET=$(openssl rand -hex 32)/" "$ENV_FILE"
    echo "[bootstrap] WARN: azzy/env is a placeholder; started from .env.example in DEMO mode."
  fi
fi
# Make sure the region used for Bedrock/S3 matches the instance region unless the secret pins one.
grep -q '^AWS_REGION=' "$ENV_FILE" || echo "AWS_REGION=$AWS_REGION" >> "$ENV_FILE"
chmod 600 "$ENV_FILE"
chown ubuntu:ubuntu "$ENV_FILE"

# ---- 5. compose -------------------------------------------------------------
mkdir -p "$APP_DIR/infra/nginx/certs" "$APP_DIR/infra/nginx/www"
docker compose -f "$APP_DIR/infra/docker-compose.yml" up -d --build --remove-orphans

# ---- 6. systemd -------------------------------------------------------------
install -m 644 "$APP_DIR/infra/scripts/azzy.service" /etc/systemd/system/azzy.service
systemctl daemon-reload
systemctl enable azzy.service

# ---- 7. backup cron ---------------------------------------------------------
cat > /etc/cron.d/azzy-backup <<'CRON'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 3 * * * root cd /opt/azzy-ai-agents && bash infra/scripts/backup.sh >> /var/log/azzy-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/azzy-backup

# ---- health -----------------------------------------------------------------
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1/healthz >/dev/null 2>&1; then
    echo "[bootstrap] stack healthy on :80"
    echo "[bootstrap] $(date -Is) done"
    exit 0
  fi
  sleep 5
done
echo "[bootstrap] WARN: stack did not report healthy within 5 minutes; check: docker compose -f $APP_DIR/infra/docker-compose.yml ps"
exit 0
