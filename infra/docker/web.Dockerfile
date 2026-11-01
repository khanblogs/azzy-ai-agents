# AZZY AI AGENTS v2.0 web (Next.js 15, standalone output).
# Build context is the REPO ROOT:  docker build -f infra/docker/web.Dockerfile .
# npm workspaces: apps/web, packages/events, e2e (root package.json).

# ---- deps -------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /repo
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/
COPY packages/events/package.json packages/events/
COPY e2e/package.json e2e/
# A fresh clone may have no lockfile yet; prefer the reproducible path when it exists.
RUN if [ -f package-lock.json ]; then \
      npm ci --workspaces --include-workspace-root --no-audit --no-fund; \
    else \
      npm install --workspaces --include-workspace-root --no-audit --no-fund; \
    fi

# ---- build ------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /repo
ARG NEXT_PUBLIC_DEMO=1
ENV NEXT_PUBLIC_DEMO=$NEXT_PUBLIC_DEMO \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
# Copy the whole deps tree so per-workspace node_modules (non-hoisted deps) survive too.
COPY --from=deps /repo ./
COPY . .
RUN npm run build -w apps/web

# ---- runner -----------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
# Standalone output only: no node_modules from the deps stage, no dev dependencies.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NODE_OPTIONS=--max-old-space-size=512
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs
# With outputFileTracingRoot = repo root, standalone contains apps/web/server.js
# plus the minimal node_modules it traced.
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
