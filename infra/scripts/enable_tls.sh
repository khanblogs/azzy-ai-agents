#!/usr/bin/env bash
# Enable HTTPS for AZZY AI AGENTS v2.0 with Let's Encrypt.
#
#   sudo bash infra/scripts/enable_tls.sh azzy.example.com you@example.com
#
# Flow: DNS A record -> this box's EIP (Terraform output public_ip) must exist first.
#   1. certbot (in a container, no host install) does an http-01 webroot challenge
#      through the running nginx (infra/nginx/www is mounted at /var/www/certbot).
#   2. Certs land in infra/nginx/certs/live/<domain>/ (mounted read-only into nginx).
#   3. Render templates: conf.d/azzy-tls.conf (443) and conf.d/azzy.conf (80 -> redirect).
#   4. nginx -t && reload. PUBLIC_BASE_URL in infra/.env is updated to https://<domain>.
#   5. A cron renews twice a day and reloads nginx when a cert changed.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "usage: $0 <domain> <email> [--staging]" >&2
  exit 2
fi
STAGING_FLAG=""
if [ "${3:-}" = "--staging" ]; then
  STAGING_FLAG="--staging"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE=(docker compose -f "$INFRA_DIR/docker-compose.yml")
CERTS_DIR="$INFRA_DIR/nginx/certs"
WWW_DIR="$INFRA_DIR/nginx/www"
CONF_DIR="$INFRA_DIR/nginx/conf.d"
TPL_DIR="$INFRA_DIR/nginx/templates"
CERTBOT_IMAGE="certbot/certbot:v2.11.0"

mkdir -p "$CERTS_DIR" "$WWW_DIR"

echo "[tls] making sure nginx is up for the http-01 challenge"
"${COMPOSE[@]}" up -d nginx
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1/healthz" >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "[tls] requesting certificate for $DOMAIN"
docker run --rm \
  -v "$CERTS_DIR:/etc/letsencrypt" \
  -v "$WWW_DIR:/var/www/certbot" \
  "$CERTBOT_IMAGE" certonly \
    --webroot -w /var/www/certbot \
    -d "$DOMAIN" \
    --email "$EMAIL" --agree-tos --no-eff-email \
    --non-interactive --keep-until-expiring $STAGING_FLAG

if [ ! -s "$CERTS_DIR/live/$DOMAIN/fullchain.pem" ]; then
  echo "[tls] ERROR: certificate not found at $CERTS_DIR/live/$DOMAIN/fullchain.pem" >&2
  exit 1
fi
# nginx runs as a non-root worker; let it read the key material through the ro mount.
chmod -R a+rX "$CERTS_DIR/live" "$CERTS_DIR/archive" 2>/dev/null || true

echo "[tls] rendering nginx config"
sed "s/__DOMAIN__/$DOMAIN/g" "$TPL_DIR/azzy-tls.conf.tmpl" > "$CONF_DIR/azzy-tls.conf"
sed "s/__DOMAIN__/$DOMAIN/g" "$TPL_DIR/azzy-http-redirect.conf.tmpl" > "$CONF_DIR/azzy.conf"

if ! "${COMPOSE[@]}" exec -T nginx nginx -t; then
  echo "[tls] ERROR: nginx config test failed; restoring HTTP-only config" >&2
  rm -f "$CONF_DIR/azzy-tls.conf"
  git -C "$INFRA_DIR" checkout -- nginx/conf.d/azzy.conf 2>/dev/null || true
  exit 1
fi
"${COMPOSE[@]}" exec -T nginx nginx -s reload

ENV_FILE="$INFRA_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  if grep -q '^PUBLIC_BASE_URL=' "$ENV_FILE"; then
    sed -i "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=https://$DOMAIN#" "$ENV_FILE"
  else
    echo "PUBLIC_BASE_URL=https://$DOMAIN" >> "$ENV_FILE"
  fi
  echo "[tls] PUBLIC_BASE_URL set to https://$DOMAIN (restart api/worker to pick it up: make up)"
fi

echo "[tls] installing renewal cron"
RENEW_SCRIPT=/usr/local/bin/azzy-renew-tls
cat > "$RENEW_SCRIPT" <<EOF
#!/usr/bin/env bash
set -euo pipefail
docker run --rm -v "$CERTS_DIR:/etc/letsencrypt" -v "$WWW_DIR:/var/www/certbot" \\
  $CERTBOT_IMAGE renew --webroot -w /var/www/certbot --quiet
chmod -R a+rX "$CERTS_DIR/live" "$CERTS_DIR/archive" 2>/dev/null || true
docker compose -f "$INFRA_DIR/docker-compose.yml" exec -T nginx nginx -s reload
EOF
chmod 755 "$RENEW_SCRIPT"
cat > /etc/cron.d/azzy-renew-tls <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
17 3,15 * * * root $RENEW_SCRIPT >> /var/log/azzy-renew-tls.log 2>&1
EOF
chmod 644 /etc/cron.d/azzy-renew-tls

echo "[tls] done: https://$DOMAIN"
