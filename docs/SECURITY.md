# AZZY AI AGENTS v2.0 — Security architecture

Created by Shahrukh Khan

This document describes the controls that exist in the code and infrastructure of v2.0, what they protect against, and where their limits are. It does not describe aspirations. Where a control is planned but not built, it is listed under [Known gaps](#known-gaps).

## 1. Threat model

Assets: the owner's AWS accounts and private servers (reachable through agent tools), credentials in `infra/.env` / Secrets Manager, the knowledge base and memories (may contain client data), and the audit trail.

Adversaries considered:

| Adversary | Path | Primary controls |
|---|---|---|
| Internet attacker | public web/API | TLS, rate-limited login, bcrypt, httpOnly/SameSite cookie, CSRF header, security headers, input validation, 80/443 only |
| Authenticated low-privilege user | portal / API | RBAC matrix enforced server-side, per-agent approval roles, admin-only writes |
| Prompt injection via untrusted content (logs, repos, tickets, documents) | tool output → LLM | injection guard + PII scrub, fixed tool menu, policy tiers, human approvals, bounded execution |
| Compromised or buggy agent reasoning | tool calls | allowlists at four layers (tool registry, policy, remote dispatcher, IAM), execution locks, approvals |
| Compromised HQ host | everything on the box | single trust zone — mitigated by minimal host access, Secrets Manager, scoped IAM roles, ExternalId, Tailscale ACL; not fully mitigated |
| Compromised client server | lateral movement to HQ | Tailscale ACL is one-directional (tag:azzy → tag:servers:22 only) |

## 2. Network and transport

- Only ports 80 and 443 are exposed (Terraform security group; firewall rule on hand-installed VMs). `enable_tls.sh` issues Let's Encrypt certificates, enforces TLS 1.2/1.3 with a modern cipher list, HSTS (1 year, includeSubDomains), OCSP stapling, and redirects port 80 (except ACME).
- nginx adds `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera/mic/geo off) and a Content-Security-Policy that allows only self, blob workers (three.js), `cdn.jsdelivr.net` / `raw.githack.com` images and fetches (HDRI assets), and same-origin WebSockets. `server_tokens off`, 20 MB body limit.
- `/metrics` (Prometheus) is **not proxied** — nginx returns 404; it is reachable only on the compose network.
- Containers talk over the compose network; Postgres and Redis publish no host ports.
- Administrative access is through Tailscale SSH (identity-aware, ACL-controlled) or AWS Systems Manager Session Manager. No public SSH is required. Terraform's `admin_cidr` exists only as an opt-in break-glass.

## 3. Authentication and sessions

- Local accounts in table `users`: email, **bcrypt** password hash, role, optional TOTP secret, `disabled` flag. The first admin is seeded from `OWNER_EMAIL`/`OWNER_PASSWORD`; re-seeding only updates the password if the env value changed and the user never changed it in-app.
- Login: `POST /api/auth/login` rate-limited per IP with a Redis token bucket (`LOGIN_RATE_LIMIT_PER_MIN`, default 10) → `429`. Failures are audited (`auth.login`, `ok:false`) without recording the password.
- Session: HS256 JWT (`JWT_SECRET`, claims `sub`, `role`, `exp` = 7 days) in cookie `azzy_session` with `HttpOnly; SameSite=Lax; Path=/` and `Secure` when `PUBLIC_BASE_URL` is https. The WebSocket at `/api/ws` authenticates with the same cookie (same origin). Logout clears the cookie.
- MFA: TOTP (RFC 6238, 30 s, 6 digits, ±1 step) implemented with the standard library; the per-user secret is encrypted at rest with a key derived from `JWT_SECRET` (HKDF) using AES-GCM. When MFA is enabled, login without a valid `otp` returns `403 {"detail":"mfa_required"}`.
- **CSRF**: every non-GET request under `/api` (except `/auth/login` and `/webhooks/*`) must carry `X-Requested-With: azzy`, otherwise `403`. Browsers cannot add custom headers cross-origin without CORS preflight, and the API sends no permissive CORS headers. `SameSite=Lax` is the second layer.
- Webhooks: `POST /api/webhooks/cloudwatch` requires header `X-Azzy-Webhook-Secret` equal to `WEBHOOK_SECRET` (constant-time compare).
- **OIDC is not implemented.** See Known gaps.

## 4. Authorization (RBAC)

Roles: `admin, devops, developer, security, operations, marketing, readonly`. Enforced in FastAPI dependencies (`apps/api/azzy/api/deps.py`) — the UI only mirrors the result by disabling controls.

| Action | Allowed |
|---|---|
| any GET | every role |
| create task, chat, call meeting, simulate incident | any role except `readonly` |
| cancel task | creator, `admin`, or the lead agent's domain role |
| approve / reject | `admin`, or a role listed in `packages/agents/policy.yaml → approval_roles[agent]` |
| environments, AWS accounts, users, integrations, settings writes | `admin` |
| knowledge upload / delete | `admin`; any non-readonly role for `scope: global` only |
| delete own account / last admin | never |

Environment-level and account-level restrictions: knowledge documents scoped to an env/account are visible only to `admin` and roles the environment allows; agents searching for a task see `global` plus the task's env/account only. AWS tools check `policy.yaml → scope_requirements` against the account's scope (readonly < audit < deploy) before anything is classified.

## 5. The execution gateway (agents never get a shell)

Four independent allowlists must all agree before an action happens:

1. **Tool registry** (`azzy/tools/registry.py`): only tool names in `policy.yaml → tool_allowlist` exist. Each agent YAML lists a subset. Unknown tools are rejected before policy.
2. **Policy engine** (`azzy/policy.py`, `policy.yaml`): every call is classified `low / medium / high` from `tool_defaults`, `high_if` predicates (prod deploy/rollback/restart, DDL in `sql.read`, IAM via `aws.describe`, PRs to protected branches) and the environment. `low` runs; `medium` needs approval unless the environment's `auto_allow` lists the tool; `high` always needs approval. Approvals time out after 1 h (`approval_timeout_seconds`) → task `failed`; rejection → `needs_human`. Approval decisions are audited with the deciding user.
3. **Remote dispatchers**: on VPSes, `ssh.safe_action` can only send `status|restart|logs|deploy|rollback|disk|top`; the remote `/usr/local/bin/azzy-action` enforces the same list again as root via a one-line sudoers rule, validates versions with `^v[0-9]+\.[0-9]+\.[0-9]+$`, and logs every call. For EC2 fleets, `ssm:SendCommand` is IAM-restricted to instances tagged `azzy:managed=true`.
4. **IAM**: client accounts are reached by `sts:AssumeRole` + ExternalId into `AzzyReadOnlyRole` / `AzzyAuditRole` / `AzzyDeploymentRole`; the HQ role can assume only those three names. Every scope includes an explicit Deny on IAM writes, Organizations, data-plane reads (S3 objects, Secrets Manager, SSM parameters, DynamoDB, KMS decrypt) and destructive EC2/RDS/ECS/EKS actions. Nothing ever gets AdministratorAccess, and root/IAM-user keys are never requested.

Additional execution controls: per-environment deploy lock (Redis `SET NX`, 10 min) so two deploys cannot overlap; pre-checks (env healthy, version format, no open incident, approval present for prod) and post-verification recorded on the `deployments` row; `sandbox.run` uses `docker run --network none --memory 512m --cpus 1` and is disabled unless the Docker socket is explicitly mounted into the worker; `nuclei.scan`/`zap.scan` refuse any host not in `AUTHORIZED_TARGETS` and are rate-limited; `github.branch_pr` never targets `main`/`master`/`prod`.

## 6. Prompt-injection and data handling

- Every tool output passes through `azzy/guard.py` before it reaches the model: known injection patterns ("ignore previous instructions", role-play directives, hidden HTML/markdown instructions, tool-call look-alikes) are neutralised and flagged; emails, phone numbers, AWS keys, JWTs, private keys and card-like numbers are redacted. The raw output is kept only in the audit log.
- Repository content, logs, documents, tickets and chat messages are **data**, never instructions: the orchestrator's state machine decides which tool runs next, and the model can only choose from the tools its agent is given with arguments that still pass policy.
- Bounded execution (`policy.yaml → collaboration`): delegation depth ≤ 3, ≤ 60 agent messages per task, ≤ 2 retries per step, 300 s per step, 90 min per task; the worker checks a cancel flag between steps and before every tool call.
- Knowledge retention `KNOWLEDGE_RETENTION_DAYS` (365) and memory retention `MEMORY_RETENTION_DAYS` (180) are enforced by a daily audited purge; documents and memories can be deleted on demand.

## 7. Secrets

- `infra/.env` (mode 600, gitignored, excluded from images) is the only runtime secret store on the host; on EC2 it is written from Secrets Manager `azzy/env` at bootstrap. `azzy/tailscale` holds the tailnet auth key.
- Postgres never stores credentials: environments reference a `secret_ref` (Secrets Manager name); AWS accounts store the ExternalId encrypted (AES-GCM, key derived from `JWT_SECRET`) and never return it; MFA secrets likewise.
- `GET /api/integrations` reports *whether* each integration is configured, never the value. Logs are structured JSON with secret fields redacted at the logging layer.
- The HQ instance role (Terraform) can read only `secretsmanager:GetSecretValue` on `azzy/*`.
- Rotation procedures are in `docs/RUNBOOKS.md`.

## 8. Audit

Table `audit_log` / `GET /api/audit`: logins (success and failure, with IP), logout, every approval decision, every tool call (`tool.call`: tool, risk, ok, duration, redacted args), task create/cancel, environment/account/user/integration/settings changes, knowledge writes, MFA changes, webhook receipts. Entries are append-only through the API (no delete endpoint) and are backed up with the database. Prometheus counters for tool calls, approvals and auth outcomes are exposed on the internal `/metrics`.

## 9. Supply chain and containers

- Pinned base images (`python:3.12-slim`, `node:22-alpine`, `nginx:1.27-alpine`, `pgvector/pgvector:pg16`, `redis:7-alpine`); pinned Python requirements and npm lockfile.
- api/worker run as uid 10001 `azzy`, web as uid 1001 `nextjs`; nginx workers are unprivileged. Hard memory/CPU limits on every container; json-file logs rotated.
- The web runner image contains only the Next.js standalone output (no dev dependencies, no source).
- CI runs typecheck, lint, pytest, and the full Playwright suite on every PR; Cyber's own `trivy`/`gitleaks`/`semgrep` scans can be pointed at this repository from `/app/security`. Dependabot/Renovate is recommended but not configured.

## 10. Known gaps

- **No OIDC/SSO.** Enterprise identity federation is not available; mitigate with MFA on all admins and a short user list.
- **Single trust zone on the host.** Root or the docker group on the VM can read every secret and the database. Restrict host access to the owner; prefer the Terraform/Secrets Manager path over long-lived `.env` files.
- **Real integrations are not covered by CI.** Only DEMO adapters are tested automatically.
- **Prompt injection is mitigated, not eliminated.** The model's *analysis* can still be influenced by malicious content; approvals and the fixed tool menu bound the *actions*.
- **No WAF or DDoS protection** in the pilot architecture; the production path puts CloudFront + AWS WAF in front of an ALB.
- **Audit log integrity** relies on database access control; there is no external write-once sink yet (ship it to CloudWatch Logs or S3 Object Lock when required).

## 11. Reporting a vulnerability

Open a private security advisory on the repository or e-mail the owner address configured as `OWNER_EMAIL`. Please do not test against environments that are not yours; `AUTHORIZED_TARGETS` exists for a reason.
