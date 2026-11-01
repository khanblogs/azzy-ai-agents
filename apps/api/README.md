# AZZY AI AGENTS v2.0 — API + worker (`apps/api`)

Created by Shahrukh Khan.

FastAPI API, Redis-streams worker and the policy/guard/orchestrator core. One image serves both
services; compose runs it twice:

| service  | command                                                                   | port |
|----------|---------------------------------------------------------------------------|------|
| `api`    | `uvicorn azzy.main:app --host 0.0.0.0 --port 8000 --workers ${UVICORN_WORKERS:-1}` | 8000 |
| `worker` | `python -m azzy.worker`                                                   | –    |

The API process never runs the agent loop; the worker consumes `azzy:tasks:priority` (chat) and
`azzy:tasks` (consumer group `workers`, at most `WORKER_CONCURRENCY`=2 loops at once), runs the
Hermes loop, probes environment health every 60 s, fires routines (APScheduler, cron from
`packages/agents/*.yaml`) and the daily retention sweep.

## Layout

```
azzy/
  main.py            FastAPI app (/api/*, /healthz + /metrics at root, /api/ws), CSRF + metrics middleware
  worker.py          queue consumer, health prober, scheduler, expiry sweep, heartbeat
  config.py          Settings (pydantic-settings)        events.py     pydantic mirror of packages/events
  policy.py          risk engine + scope_requirements, collaboration bounds, approval_roles (policy.yaml)
  rbac.py            role matrix + CSRF rule (pure)      guard.py      injection guard + PII scrub
  auth.py            users, bcrypt, TOTP, JWT cookie, rate limit  crypto.py  Fernet (HKDF from JWT_SECRET) + TOTP
  llm.py             StubLLM (DEMO) / LiteLLMGateway      costs.py      price table + daily totals
  bus.py             Redis streams / pub-sub / locks      audit.py      audit trail + audit.appended
  deployments.py     deployment lifecycle, pre-checks, per-env lock, post-verify
  knowledge.py       ingestion (.md/.txt/.pdf) + permission-aware search   embeddings.py  hashed (DEMO) / LiteLLM
  integrations.py    status + tests                        metrics.py    /system/metrics + Prometheus
  db/                SQLAlchemy models, Alembic migrations, repo
  agents/            YAML loader (5 agents), AgentRunner (pipeline, workflow, chat, incident, meeting)
  orchestrator/      router (keyword/Hinglish, workflow kind), planner, bounds, service
  tools/             execution gateway (registry/executor) + allowlisted tools, demo_data
  api/               routes.py (core), routes_v2.py (users, chat, collaboration, accounts, deployments,
                     knowledge, audit, metrics, reports, integrations, settings, contact), ws.py
tests/               pure-logic tests (no DB/Redis/app needed)
```

## Local dev (no docker)

```bash
cd apps/api
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql+asyncpg://azzy:azzy@localhost:5432/azzy REDIS_URL=redis://localhost:6379/0
export OWNER_EMAIL=owner@example.com OWNER_PASSWORD=change-me JWT_SECRET=$(openssl rand -hex 32) WEBHOOK_SECRET=dev
uvicorn azzy.main:app --reload --port 8000     # terminal 1
python -m azzy.worker                           # terminal 2
```

`AGENTS_DIR` defaults to `/app/packages/agents` in the image and falls back to the repo-relative
`../../packages/agents` locally. `ARTIFACTS_DIR` (`/data/artifacts`) and `KNOWLEDGE_DIR`
(`/data/knowledge`) fall back to `apps/api/data/<name>` when not writable.

## Migrations (Alembic)

Startup runs `alembic upgrade head` programmatically (`azzy.db.schema.init_schema`). Migration
`0001_initial` creates the pgvector extension and every table from `azzy.db.models`
(zero-divergence: it calls `Base.metadata.create_all`). To add a migration after changing models:

```bash
cd apps/api
alembic revision --autogenerate -m "add foo column"     # writes azzy/db/migrations/versions/<rev>_add_foo_column.py
# review the generated file, then:
alembic upgrade head
alembic current                                          # prints "<rev> (head)"
```

Inside the container: `docker compose -f infra/docker-compose.yml exec api alembic current`.
Autogenerate compares against the live database, so run it with `DATABASE_URL` pointing at a
database already at the previous head. Vector columns are declared via `pgvector.sqlalchemy.Vector`;
autogenerate renders them as `Vector(384)` (import `pgvector.sqlalchemy` in the migration if needed).

## Tests

```bash
cd apps/api && python -m pytest -q && python -m compileall -q azzy
```

The suite covers policy (incl. scope requirements and approval roles), RBAC + CSRF, collaboration
bounds, guard, router (five agents + the `workflow` kind), events (parses
`packages/events/src/index.ts` and pins the literals), costs and the StubLLM / demo data. It needs
only stdlib + pydantic + pyyaml.

## Env vars

Required: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (also derives the at-rest encryption key —
rotating it invalidates stored external IDs / MFA secrets), `OWNER_EMAIL`, `OWNER_PASSWORD` (plain
or a bcrypt hash; seeds the admin), `WEBHOOK_SECRET`.

Optional: `DEMO` (default `1`), `PUBLIC_BASE_URL` (https → Secure cookie), `UVICORN_WORKERS`,
`WORKER_CONCURRENCY` (2), `DB_POOL_SIZE`/`DB_MAX_OVERFLOW` (5/5), `SLACK_WEBHOOK_URL`,
`AUTHORIZED_TARGETS`, `AWS_REGION`, `BEDROCK_MODEL` (with or without `bedrock/`),
`EMBEDDINGS_MODEL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GITHUB_TOKEN`, `GITLAB_TOKEN`,
`JENKINS_URL`/`JENKINS_TOKEN`, `GMAIL_CREDENTIALS_JSON`, `ZENDESK_SUBDOMAIN/EMAIL/API_TOKEN`,
`DATABASE_RO_URL`, `DAILY_BUDGET_USD`, `KNOWLEDGE_RETENTION_DAYS` (365), `MEMORY_RETENTION_DAYS`
(180), `AGENTS_DIR`, `ARTIFACTS_DIR`, `KNOWLEDGE_DIR`, `HEALTH_PROBE_SECONDS` (≥ 60),
`LOG_LEVEL`. `OIDC_ISSUER/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET` are reserved (OIDC not implemented).

## Security model (API side)

- Single-origin cookie session (`azzy_session`, HttpOnly, SameSite=Lax, Secure on https), roles in
  the JWT, TOTP MFA, login rate limit 10/min/IP, CSRF header `X-Requested-With: azzy` on every
  non-GET `/api` call except login/webhooks/contact.
- Every tool call passes the execution gateway: allowlist → agent permission → AWS account scope →
  risk policy → approval → run → injection/PII scrub → `tool.log` + audit. Nuclei/ZAP targets are
  checked against `AUTHORIZED_TARGETS` in every mode; `github.branch_pr` never targets protected
  branches; `sql.read` is SELECT-only on a read-only DSN.
- Secrets never persist in Postgres except Fernet-encrypted external IDs / MFA secrets; AWS
  credentials are STS session credentials held in memory only.

## DEMO mode

`DEMO=1`: `StubLLM` returns deterministic plans (and in-character chat answers built from live
state), tools return canned output from `tools/demo_data.py` except `env.registry`, `aws.accounts`,
`aws.inventory`, `iam.review` (labelled demo data), `knowledge.search`, `agent.message`,
`memory.write` and the office tools (real pptx/xlsx/pdf files). Every demo response carries
`demo: true`. `DEMO=0` switches to LiteLLM (Bedrock via the instance role, Anthropic/OpenAI fallbacks
when keys exist) and real integrations.

## Resource footprint (2 vCPU / 16 GB pilot host)

Measured expectations with the pinned stack: `api` ≈ 180–260 MB RSS per uvicorn worker (FastAPI +
SQLAlchemy + boto3 + litellm imported lazily), `worker` ≈ 220–320 MB RSS (adds python-pptx /
reportlab / openpyxl when office tools run). No ML libraries are installed; embeddings are hashed in
DEMO and remote via LiteLLM otherwise.
