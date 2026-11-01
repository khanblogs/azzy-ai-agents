# AZZY AI AGENTS v2.0 — contract addendum

This file **amends** `docs/CONTRACT.md`. Where the two disagree, this file wins. Everything in
CONTRACT.md that is not changed here still applies (auth cookie, nginx layout, WS framing, Redis
streams, pipeline rules, DEMO pacing, LED wall, camera).

## 0. Identity

- Product: **AZZY AI AGENTS v2.0**. Creator credit, shown in the footer of every page and in the
  README: **Created by Shahrukh Khan** (no designation).
- Logo: `apps/web/public/brand/azzy-logo.png` (640²), `azzy-logo-256.png`, `og.png`; PWA icons
  in `apps/web/public/icons/` are already generated from it. Never redraw the mascot.
- Palette (`BRAND` in `packages/events`): navy `#050816`, midnight `#0B1025`, cyan `#00E5FF`,
  purple `#9747FF`, magenta `#F04DFF`, gold `#FFB547`. Dark mode only.
- Repo root is now `azzy-ai-agents/` (layout unchanged: `apps/api`, `apps/web`, `packages/events`,
  `packages/agents`, `infra`, `e2e`, `docs`, `assets`).

## 1. Agents (exactly five)

| id | name | role | color | domain role (RBAC) | avatar |
|---|---|---|---|---|---|
| `jimmy` | Jimmy | DevOps Agent | `#00E5FF` | devops | black-panther humanoid, black armoured tech suit, cyan accents, headset |
| `emir` | Emir | Developer Agent | `#FFB547` | developer | golden-cheetah humanoid (gold fur, dark spots), smart glasses, dark tech jacket, headset |
| `cyber` | Cyber | Security / Testing / Audit / VAPT Agent | `#9747FF` | security | human, black hoodie up, blue-tinted glasses, headphones. No crown, no animal mask |
| `sara` | Sara | Operations Agent | `#F04DFF` | operations | human, light hijab, navy blazer, tablet |
| `marwah` | Marwah | Marketing Agent | `#34D399` | marketing | human, long modern hair, cream blazer, laptop |

`john` no longer exists anywhere. The orchestrator is **Azzy Orchestrator** (`azzy`), never drawn
as a character; it is represented in the office by the central holographic orchestration table.

Routing keywords (router.py): deploy/rollback/ecs/eks/ec2/terraform/k8s/logs/cloudwatch/infra/cost/
dns/cloudfront/waf → jimmy; code/bug/fix/review/pr/test/refactor/api/schema/model/train/data/notebook
→ emir; security/vapt/pentest/scan/audit/iam/owasp/compliance/secrets/zap/nuclei/release gate →
cyber; kpi/report/ops/operations/plan/schedule/ticket/budget/incident summary/resource → sara;
marketing/campaign/brand/content/social/seo/newsletter/positioning/growth/launch → marwah.
Hinglish verbs stay. The spec workflow "Investigate my failing ECS deployment, fix the application
issue, test it, perform a security assessment, and request approval before deploying" routes to
kind `workflow`, lead `jimmy`, assignees `[jimmy, emir, cyber, sara]`.

## 2. New / changed events (see `packages/events`)

- `AgentPhase` adds `chatting`; `Spot` renames `pod` → `table` (central orchestration table).
- `PipelineState` adds `cancelled`. `Task` adds `created_by`, `steps_total`, `steps_done`; `TaskKind`
  adds `chat`, `workflow`.
- New events: `agent.message` (persisted agent-to-agent message), `chat.message` (user ⇄ agent),
  `deployment.changed`, `account.changed`, `audit.appended`.

## 3. Auth, users, RBAC

- Table `users` {id, email, password_hash (bcrypt), role, mfa_secret (nullable, encrypted with
  `JWT_SECRET`-derived key), created_at, last_login, disabled}. The admin is seeded from
  `OWNER_EMAIL` / `OWNER_PASSWORD` at startup (role `admin`); re-seeding updates the password only
  if the env value changed and the user never changed it in-app.
- Roles: `admin, devops, developer, security, operations, marketing, readonly`.
- `POST /auth/login {email, password, otp?}` → `200 {ok, email, role}`; `401` bad credentials;
  `403 {detail:"mfa_required"}` when the user has MFA and no/invalid `otp`. Rate limit: 10/min/IP
  (Redis token bucket) → `429`. JWT claims `{sub: email, role, exp}`; cookie `azzy_session`,
  `HttpOnly; SameSite=Lax; Secure` when https. `POST /auth/logout`. `GET /auth/me → {email, role,
  mfa_enabled}`.
- MFA (TOTP, RFC 6238, stdlib HMAC): `POST /auth/mfa/setup → {secret, otpauth_uri}`;
  `POST /auth/mfa/enable {otp}`; `POST /auth/mfa/disable {otp}`.
- CSRF: every non-GET request under `/api` (except `/auth/login`, `/webhooks/*`) must carry header
  `X-Requested-With: azzy` → otherwise `403`. The web `api.ts` helper always sends it.
- Permission matrix (enforced in deps; `403 {detail}` on failure):
  - `readonly`: GET only.
  - create tasks / chat / call meeting / simulate incident: any role except readonly.
  - cancel a task: creator, admin, or the lead agent's domain role.
  - approve/reject: `admin` or a role in `policy.yaml approval_roles[agent]`.
  - environments / AWS accounts / users / integrations / settings writes: `admin` only.
  - knowledge document upload / delete: admin, or any non-readonly role for `scope: global`.
- Users admin: `GET /users`, `POST /users {email, password, role}`, `PATCH /users/{id} {role?,
  disabled?, password?}`, `DELETE /users/{id}` (cannot delete yourself or the last admin).
- OIDC is **not implemented**; `OIDC_ISSUER/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET` are reserved in
  `.env.example` and README lists OIDC under limitations.

## 4. Agent chat (individual conversations)

- Tables `conversations` {id, agent, user_email, title, created_at, updated_at} and `chat_messages`
  (shape = `ChatMessage`).
- `GET /agents/{id}/conversations` → list; `POST /agents/{id}/conversations` → new;
  `GET /conversations/{cid}/messages` → `ChatMessage[]`;
  `POST /conversations/{cid}/messages {content}` → `202 {user_message, task_id}`: the API persists
  the user message, emits `chat.message`, and enqueues a `chat` task; the worker runs the agent
  loop with the conversation as context (last 20 messages + top-5 memories + knowledge hits), may
  call tools (same policy/approvals), and streams the reply as `chat.message` events with
  `streaming: true` chunks (same `id`, growing `content`) and a final `streaming: false`. Office:
  agent phase `chatting`, one `agent.say` with the first sentence.
- In DEMO the StubLLM answers in character with role-specific content drawn from live state (e.g.
  Jimmy quotes the real environment list and the last deployment; Cyber quotes the last scan; Sara
  quotes task counts). A chat that asks for an action ("deploy v2.4 to client b") turns into a
  normal command task: the reply says so and includes the task id.
- `DELETE /conversations/{cid}` (owner or admin).

## 5. Agent-to-agent collaboration

- Table `agent_messages` (shape = `AgentMessage`). Every handoff/request/result between agents during
  a task is persisted and emitted as `agent.message`. The worker's `agent.message` tool is how an
  agent sends one; the orchestrator also writes `handoff` messages when it delegates a step.
- Bounds (policy.yaml `collaboration`): depth ≤ 3, ≤ 60 messages/task, ≤ 2 retries/step, step
  timeout 300 s, task timeout 90 min; exceeding any → task `failed` with a clear result string.
- `GET /tasks/{id}/messages` → `AgentMessage[]`; `GET /collaboration/live` →
  `{edges: [{from, to, count, last_ts, active: bool}], tasks: Task[] (active)}` for the graph.
- `POST /tasks/{id}/cancel` → `Task` (state `cancelled`); the worker checks a Redis cancel flag
  between steps and before every tool call; pending approvals of the task are expired.
- DEMO scenario `workflow` ("Investigate my failing ECS deployment …"): Jimmy `aws.describe ecs` +
  `cloudwatch.logs` → `agent.message handoff → emir` (diagnostics) → Emir `github.read`,
  `sandbox.run` (tests), `github.branch_pr` (medium; auto-allowed on staging env) → `result → cyber`
  → Cyber `semgrep.scan`, `trivy.scan` → `result → jimmy` → Jimmy `aws.deploy` staging (auto) +
  `aws.describe` health → `request → sara` → Sara `pdf.export` incident summary → Jimmy requests
  approval for `aws.deploy` prod (high) → approved → deploy → verify → done. ≈ 45 s + approval wait.

## 6. AWS accounts (multi-account)

- Table `aws_accounts` (shape = `AwsAccount` + `external_id` encrypted at rest, never returned).
- `GET /aws-accounts`; `POST /aws-accounts {name, account_id (12 digits), role_arn, external_id?,
  scope, regions[], stage}` → `201` (status `pending`); `POST /aws-accounts/{id}/verify` → runs
  `sts:AssumeRole` + a permission probe per scope (`ec2:DescribeInstances`, `ecs:ListClusters`,
  `logs:DescribeLogGroups`, `ce:GetCostAndUsage`; audit adds `iam:GetAccountAuthorizationDetails`,
  `config:DescribeConfigRules`; deploy adds `ecs:UpdateService` dry-run via `iam:SimulatePrincipalPolicy`)
  → `permissions[]`, `status`, emits `account.changed`. In DEMO: verification succeeds for the two
  seeded demo accounts (`demo-dev` 111122223333 dev readonly, `demo-prod` 444455556666 prod deploy)
  and for any account whose `account_id` starts with `1`–`4`; others → `failed` with a realistic
  STS error. `DELETE /aws-accounts/{id}` (admin).
- `GET /aws-accounts/{id}/inventory?region=` → `{region, generated_at, demo, resources: {ec2:[…],
  ecs:[…], eks:[…], lambda:[…], s3:[…], rds:[…], cloudfront:[…], waf:[…], route53:[…]}}` — real via
  boto3 in `DEMO=0` (read-only calls only), labelled demo data otherwise (`demo: true`).
- Environments (`environments`) gain `account_id` (nullable FK to aws_accounts) and `stage`.
- CloudFormation now ships three templates: `AzzyReadOnlyRole`, `AzzyAuditRole`,
  `AzzyDeploymentRole` (one file with a `Scope` parameter is fine, but all three names must be the
  default `RoleName` for their scope and the README onboarding wizard copy must match).

## 7. Deployments

- Table `deployments` (shape = `Deployment`). `aws.deploy`, `aws.rollback` and `ssh.safe_action
  deploy|rollback` create and update rows (`planned → awaiting_approval → running → verifying →
  succeeded | failed | rolled_back`), with pre-checks (`checks[]`: env healthy, version format,
  no incident open, approval present for prod) and post-verification (health probe). An execution
  lock per env (Redis `SET NX`, 10 min) prevents concurrent deploys → second one fails fast.
- `GET /deployments?env_id=&limit=`; `GET /deployments/{id}`; `POST /deployments/plan {env_id,
  version}` → creates a `planned` deployment and a command task for Jimmy.

## 8. Knowledge base

- Tables `documents` {id, title, source, content, tags[], scope ("global" | env id | account id),
  embedding vector(384), created_by, created_at} and `document_chunks` {id, document_id, idx,
  content, embedding}.
- `GET /knowledge/documents`; `POST /knowledge/documents {title, content, tags?, scope?}` (also
  `multipart` upload of .md/.txt/.pdf ≤ 5 MB → text extracted); `DELETE /knowledge/documents/{id}`;
  `GET /knowledge/search?q=&scope=` → `[{document_id, title, chunk, score}]`. Retrieval is
  permission-aware: a scope that is an env/account id is visible only to admin and to roles the
  env allows; agents searching on behalf of a task see only `global` + the task's env/account.
- Embeddings: `DEMO=1` → deterministic hashed bag-of-words into 384 dims (cosine still meaningful
  for keyword overlap); `DEMO=0` → `EMBEDDINGS_MODEL` via LiteLLM (default
  `bedrock/amazon.titan-embed-text-v2:0`, 384 dims via `dimensions=384`). Seeded documents: 6
  runbooks (ECS rollback, incident comms, IAM review, release gate, Tailscale onboarding, cost
  review) tagged `runbook`.
- Retention: `KNOWLEDGE_RETENTION_DAYS` (default 365) and `MEMORY_RETENTION_DAYS` (default 180);
  a daily routine purges expired rows and audits it. `DELETE /agents/{id}/memories/{mid}`.

## 9. Audit, monitoring, reports, integrations, settings

- `GET /audit?limit=&before=&action=&actor=` → `AuditEntry[]` (newest first). Audited: logins
  (incl. failures), logout, every approval decision, every tool call (action `tool.call`, detail has
  tool/risk/ok/duration), task create/cancel, account/env/user/integration changes, knowledge
  writes, MFA changes, webhook receipts. `audit.appended` is emitted for everything except
  `tool.call` (those already stream as `tool.log`).
- `GET /system/metrics` → `{uptime_seconds, ws_clients, queue_depth, worker_heartbeat_ts,
  worker_ok, db_ok, redis_ok, tasks_active, approvals_pending, incidents_open, today_usd,
  version, demo}`; `GET /metrics` (root, Prometheus text format, no auth, bound to the internal
  network by nginx — not proxied).
- `GET /reports` → artifacts produced by `pptx.build/xlsx.model/pdf.export` (table `artifacts`
  {id, agent, task_id, kind, filename, path, bytes, created_at}); `GET /reports/{id}/download`
  streams the file (auth required); `POST /reports/generate {kind: "ops_kpi" | "security_posture" |
  "growth" | "fleet"}` → `{task_id}` (routes to sara / cyber / marwah / jimmy).
- `GET /integrations` → `[{id, name, category, configured: bool, demo: bool, detail}]` for github,
  gitlab, jenkins, slack, gmail, gcal, zendesk, bedrock, anthropic, openai, tailscale, ssm,
  semgrep, gitleaks, trivy, checkov, nuclei, zap, playwright — derived from env + binary presence.
  `POST /integrations/{id}/test` → `{ok, detail}` (real probe in `DEMO=0`, simulated in DEMO and
  labelled). Secrets are never returned.
- `GET /settings` → `{demo, daily_budget_usd, approval_timeout_seconds, authorized_targets[],
  retention: {...}, public_base_url}`; `PATCH /settings` (admin) for `daily_budget_usd`,
  `authorized_targets`, retention (persisted in table `settings`, env is the default).

## 10. Web app information architecture

Public site (no auth): `/` Home (hero with the logo, five agents, capabilities, how it works,
architecture, security, CTA → login), `/platform`, `/agents`, `/capabilities`, `/architecture`
(embeds `docs/hld-v2.jpg` copied to `public/brand/hld.jpg`), `/security`, `/contact` (form →
`POST /api/contact {name, email, message}` → table `contact_messages`; shown to admin under
Settings), `/login`. Footer on every page: "AZZY AI AGENTS v2.0 · Created by Shahrukh Khan".

Portal (auth, `src/middleware.ts` guards `/app/*`): `/app` Command Center (live KPIs, office status,
pending approvals, active tasks, recent agent messages, costs sparkline, quick command bar),
`/app/office` Virtual Agent Office (3D), `/app/agents` (five cards), `/app/agents/[id]` (profile +
chat + tools + memories + live log; chat is the primary pane), `/app/collaboration` (live graph:
five agent nodes + orchestrator hub, animated edges from `agent.message`, task list; built with SVG,
no React Flow dependency), `/app/tasks` (pipeline board + cancel + task drawer with messages tab),
`/app/aws-accounts` (list + 3-step onboarding wizard: scope → CloudFormation snippet with
copy button → verify), `/app/infrastructure` (environments + inventory viewer per account/region),
`/app/deployments`, `/app/monitoring` (system metrics, env health, incidents incl. simulate/resolve,
LED-wall feed), `/app/security` (Cyber findings from the last scans, release-gate status,
authorized targets, run audit button), `/app/knowledge` (documents list, upload, search),
`/app/reports`, `/app/approvals`, `/app/integrations`, `/app/settings` (profile + MFA, users
(admin), budgets/targets/retention (admin), contact inbox (admin)), `/app/audit`.

Mobile (<md): bottom tab bar with Home, Office, Tasks, Approvals, More; "More" opens a sheet with
the remaining pages. Desktop: collapsible sidebar grouped (Operate / Infrastructure / Govern /
Admin).

3D office changes: five desks at x = −8, −4, 0, 4, 8 (z = 0, characters at z = +1.1 facing −Z);
central **orchestration table** at (0, 0, −9): round holographic table, rotating "A" hologram in
cyan/purple above it, five stools at 72° spacing radius 1.8; `Spot.table` replaces `pod`. Camera
modes as HUD chips: **Overview**, **Focus** (selected agent), **Collaboration** (draws animated
glowing arcs between agents for each `agent.message` in the last 20 s, and a persistent dim arc
per live edge), **Execution** (dims agents not on an active task, spotlights the active ones),
**Monitoring** (camera to the LED wall + env health tiles). Characters per the avatar table above,
built from primitives (ears/snout for panther and cheetah, hood for Cyber, hijab shell for Sara,
long hair for Marwah). Everything else from CONTRACT.md's 3D section stays.

## 11. e2e / CI

Routes in tests move to `/app/*`; agent ids are the five above. Required new specs: `chat.spec.ts`
(open `/app/agents/jimmy`, send "What environments do we have?", expect an agent reply containing
"client-b" within 30 s), `collaboration.spec.ts` (submit the ECS workflow prompt, expect
`/app/collaboration` to show ≥ 1 active edge within 60 s and `/app/tasks/{id}` messages tab ≥ 3
messages), `aws-accounts.spec.ts` (wizard: add `Demo Sandbox` 123456789012 readonly → verify →
status verified), `rbac.spec.ts` (admin creates readonly user via API; login as readonly; approve
→ 403 and button disabled in UI), `cancel.spec.ts` (start a workflow, cancel, state cancelled),
`audit.spec.ts` (`/app/audit` lists the login just performed), `public.spec.ts` (home renders logo
and the five agents, footer credit present). Screenshots of every major screen are saved to
`e2e/screenshots/` by a `screenshots.spec.ts` (desktop + mobile).

New testids: `office-mode-<overview|focus|collaboration|execution|monitoring>`, `chat-input`,
`chat-send`, `chat-message-agent`, `collab-edge`, `account-wizard`, `account-verify`,
`account-status`, `task-cancel`, `audit-row`, `user-form`, `tab-more`, `footer-credit`.

## 12. Honesty rules (from the v2 brief)

- Demo data is always labelled: API responses carry `demo: true` where applicable and the UI shows a
  "DEMO" chip on any card whose data is simulated. Buttons that cannot act in the current mode are
  disabled with a tooltip, never silently no-op.
- The README's "Limitations & risks" section lists: OIDC not implemented (local auth + TOTP only),
  single-node pilot (no HA), LangGraph not used (own typed orchestrator), Grafana/Prometheus
  dashboards not bundled (metrics endpoint only), scanners run only if binaries are in the image,
  real-mode integrations unverified in CI.
