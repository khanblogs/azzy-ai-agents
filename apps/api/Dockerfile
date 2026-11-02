# AZZY AI AGENTS v2.0 — one image serves both the `api` and the `worker` service; compose overrides the command.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    AGENTS_DIR=/app/packages/agents \
    ARTIFACTS_DIR=/data/artifacts \
    KNOWLEDGE_DIR=/data/knowledge \
    UVICORN_WORKERS=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-client ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 azzy \
    && useradd --uid 10001 --gid azzy --create-home --shell /usr/sbin/nologin azzy \
    && mkdir -p /app /data/artifacts /data/knowledge \
    && chown -R azzy:azzy /app /data

WORKDIR /app

# Build context is the repo root (see infra/docker-compose.yml) so the shared agent YAMLs are available.
COPY apps/api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Optional security scanners (WITH_SCANNERS=1 at build time; default image stays light).
# semgrep + checkov come from PyPI; gitleaks + trivy are pinned GitHub releases (amd64).
# nuclei and ZAP are NOT bundled (Go/Java footprint); the tools report "not installed" when absent.
ARG WITH_SCANNERS=0
ARG GITLEAKS_VERSION=8.21.2
ARG TRIVY_VERSION=0.76.1
RUN if [ "$WITH_SCANNERS" = "1" ]; then \
      set -eux; \
      apt-get update && apt-get install -y --no-install-recommends curl tar git && rm -rf /var/lib/apt/lists/*; \
      python3 -m venv /opt/scanners; \
      /opt/scanners/bin/pip install --no-cache-dir "semgrep==1.101.0" "checkov==3.2.344" "setuptools<81"; \
      ln -sf /opt/scanners/bin/semgrep /opt/scanners/bin/checkov /usr/local/bin/; \
      curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" | tar -xz -C /usr/local/bin gitleaks; \
      curl -fsSL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" | tar -xz -C /usr/local/bin trivy; \
      chmod +x /usr/local/bin/gitleaks /usr/local/bin/trivy; \
    fi

# Obscura headless browser for the web.* tools (WITH_OBSCURA=1 by default; the
# plain release build renders but has no stealth transport — anti-detect is
# deliberately not bundled). obscura + obscura-worker must stay together.
ARG WITH_OBSCURA=1
ARG OBSCURA_VERSION=0.2.6
RUN if [ "$WITH_OBSCURA" = "1" ]; then \
      set -eux; \
      apt-get update && apt-get install -y --no-install-recommends curl tar && rm -rf /var/lib/apt/lists/*; \
      curl -fsSL "https://github.com/h4ckf0r0day/obscura/releases/download/v${OBSCURA_VERSION}/obscura-x86_64-linux.tar.gz" | tar -xz -C /usr/local/bin obscura obscura-worker; \
      chmod +x /usr/local/bin/obscura /usr/local/bin/obscura-worker; \
    fi

# Local embedding model for real-mode semantic search (WITH_LOCAL_EMBEDDINGS=1
# by default): all-MiniLM-L6-v2 ONNX (384 dims — matches the pgvector schema),
# so embeddings need no cloud credential. libgomp1 is onnxruntime's runtime dep.
ARG WITH_LOCAL_EMBEDDINGS=1
RUN if [ "$WITH_LOCAL_EMBEDDINGS" = "1" ]; then \
      set -eux; \
      apt-get update && apt-get install -y --no-install-recommends curl libgomp1 && rm -rf /var/lib/apt/lists/*; \
      mkdir -p /opt/models/all-MiniLM-L6-v2; \
      curl -fsSL "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx" -o /opt/models/all-MiniLM-L6-v2/model.onnx; \
      curl -fsSL "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json" -o /opt/models/all-MiniLM-L6-v2/tokenizer.json; \
      ls -la /opt/models/all-MiniLM-L6-v2; \
    fi

COPY --chown=azzy:azzy apps/api /app
COPY --chown=azzy:azzy packages/agents /app/packages/agents

USER azzy
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4).status == 200 else 1)" || exit 1

# api:    uvicorn azzy.main:app --host 0.0.0.0 --port 8000 --workers ${UVICORN_WORKERS:-1}
# worker: python -m azzy.worker
# `alembic current` (run from /app) prints the applied revision; the api/worker upgrade to head at startup.
CMD ["sh", "-c", "uvicorn azzy.main:app --host 0.0.0.0 --port 8000 --workers ${UVICORN_WORKERS:-1}"]
