#!/usr/bin/env bash
# Build the release archive: azzy-ai-agents-<version>.zip (source only, no secrets, no caches).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-2.0.0}"
OUT_DIR="${2:-$ROOT/dist}"
NAME="azzy-ai-agents"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$OUT_DIR"
# tar-based copy (rsync is not guaranteed on every box)
( cd "$ROOT" && tar --exclude=node_modules --exclude=.next --exclude=dist --exclude=__pycache__ --exclude=.pytest_cache \
    --exclude=.ruff_cache --exclude=.mypy_cache --exclude='*.pyc' --exclude=.git \
    --exclude='./infra/.env' --exclude='./infra/.env.local' --exclude='./infra/.env.prod' \
    --exclude='./infra/nginx/certs/*' --exclude='./infra/nginx/www/*' --exclude='./infra/nginx/conf.d/azzy-tls.conf' \
    --exclude='./infra/terraform/.terraform' --exclude='./infra/terraform/*.tfstate*' \
    --exclude='./e2e/.auth' --exclude='./e2e/screenshots/*.png' --exclude=playwright-report --exclude=test-results \
    -cf - . ) | ( mkdir -p "$STAGE/$NAME" && cd "$STAGE/$NAME" && tar -xf - )

# Guard: no secrets or private keys may ship. The PII/secret scrubber and its tests legitimately
# contain the patterns themselves, as does this script, so those three files are exempt.
SECRET_RE='AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-ant-[A-Za-z0-9_-]{20,}|xox[bap]-[A-Za-z0-9-]{10,}'
HITS="$(grep -rElI --exclude-dir=.git -e "$SECRET_RE" "$STAGE/$NAME" 2>/dev/null \
  | grep -vE '/(scripts/package\.sh|apps/api/azzy/guard\.py|apps/api/tests/test_guard\.py)$' || true)"
if [ -n "$HITS" ]; then
  echo "refusing to package: secret-looking content found in:" >&2
  echo "$HITS" >&2
  exit 1
fi

( cd "$STAGE" && zip -qr "$OUT_DIR/$NAME-$VERSION.zip" "$NAME" )
( cd "$OUT_DIR" && sha256sum "$NAME-$VERSION.zip" > "$NAME-$VERSION.zip.sha256" )
echo "built $OUT_DIR/$NAME-$VERSION.zip ($(du -h "$OUT_DIR/$NAME-$VERSION.zip" | cut -f1))"
