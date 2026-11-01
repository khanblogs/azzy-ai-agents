# AZZY AI AGENTS — API ⇄ Web contract (v1 base; see CONTRACT-v2.md for amendments)

This file is the single source of truth for everything that crosses the wire. `packages/events/src/index.ts`
(zod) and `apps/api/azzy/events.py` (pydantic) must stay identical in shape and literal values.

## Identity

- Agents: `jimmy`, `john`, `marwah`, `sara`. Colors and display names live in `packages/events` `AGENT_META`
  and in `packages/agents/*.yaml` (same values).
- Orchestrator is `azzy` — never an agent id, never drawn in the 3D office.
- Owner auth: single user. `OWNER_EMAIL` / `OWNER_PASSWORD` from env. JWT (HS256, `JWT_SECRET`) in httpOnly cookie
  `azzy_session`, 7-day expiry. WebSocket auth uses the same cookie (same origin behind nginx).

## URL layout (nginx)

- `/` → web (Next.js, port 3000)
- `/api/*` → api (FastAPI, port 8000) — the `/api` prefix is **kept** (FastAPI routes are mounted under `/api`)
- `/api/ws` → api websocket (upgrade headers passed)
- `/healthz` → api `/healthz`

The web app calls the API with relative URLs (`/api/...`) in the browser and with `API_INTERNAL_URL`
(`http://api:8000`) from server components. WebSocket URL: `${wss|ws}://${location.host}/api/ws`.

## REST (all JSON, all under `/api`)

Auth
- `POST /auth/login` `{email, password}` → `200 {ok: true, email}` sets cookie; `401 {detail}` otherwise.
- `POST /auth/logout` → `{ok: true}` clears cookie.
- `GET /auth/me` → `{email}` or `401`.
- Every other route requires the cookie (401 if missing/invalid). Exceptions: `/healthz`, `/auth/login`,
  `/webhooks/cloudwatch` (uses `X-Azzy-Webhook-Secret` header = `WEBHOOK_SECRET`).

State snapshot (used on page load and on WS reconnect)
- `GET /state` →
  ```json
  {
    "office": {"status": "nominal|meeting|incident", "note": ""},
    "agents": [{"id":"jimmy","name":"Jimmy","role":"...","color":"#22d3ee","phase":"idle","spot":"desk",
                "task_id":null,"detail":"","xp":120,"rank":"Associate","today_usd":0.42,
                "daily_budget_usd":6.0,"tasks_done":3}],
    "tasks": [Task...],            // last 100, newest first
    "approvals": [Approval...],    // pending first, then last 50 decided
    "incidents": [Incident...],    // open first, then last 20
    "environments": [Environment...],
    "costs": {"today_usd": 1.23, "per_agent": {"jimmy": 0.42, ...}, "budget_usd": 25.0},
    "updates": [{"ts":"...","agent":"jimmy","text":"..."}],   // last 20 agent.say / task events for the LED wall
    "uptime_seconds": 1234,
    "demo": true
  }
  ```

Tasks
- `POST /tasks` `{prompt: string}` → `201 Task`. Orchestrator routes it (see Routing).
- `GET /tasks?limit=100` → `Task[]`
- `GET /tasks/{id}` → `{task: Task, log: ToolLogEvent[], memories: Memory[]}`
- `POST /tasks/{id}/move` `{state: PipelineState}` → `Task` (manual board move; emits `task.updated`)

Approvals
- `GET /approvals?status=pending|all` → `Approval[]`
- `POST /approvals/{id}/approve` → `Approval` (emits `approval.decided`)
- `POST /approvals/{id}/reject` `{reason?: string}` → `Approval`

Incidents
- `GET /incidents` → `Incident[]`
- `POST /incidents/simulate` `{env_id?: string, title?: string}` → `201 Incident` (runs the war room)
- `POST /incidents/{id}/resolve` → `Incident`
- `POST /webhooks/cloudwatch` (CloudWatch alarm JSON or `{AlarmName, NewStateValue, NewStateReason}`) → `{incident_id}`

Environments
- `GET /environments` → `Environment[]`
  ```json
  {"id":"client-a-staging","name":"Client A — staging","kind":"staging|prod|hq","method":"assume_role|access_key|tailscale_ssh",
   "target":"arn:aws:iam::111122223333:role/AzzyAgentRole | 100.101.102.103 | hq",
   "region":"ap-south-1","auto_allow":["aws.deploy","aws.rollback","ssh.safe_action"],
   "health":"healthy|degraded|down|unknown","version":"v2.2.9","latency_ms":82,"last_checked":"..."}
  ```
- `POST /environments` `{name, kind, method, target, region?, external_id?, secret_ref?, auto_allow?}` → `201 Environment`.
  Secrets are never stored in Postgres: `secret_ref` is a Secrets Manager name (e.g. `azzy/env/client-b`).
- `DELETE /environments/{id}` → `{ok: true}` (seeded envs can't be deleted → 400)
- `POST /environments/{id}/check` → `Environment` (runs a health probe, emits `env.health`)

Meeting
- `POST /meeting/call` `{topic?: string}` → `{task_id}`; agents walk to the pod, speak in turn, return. 409 if a meeting is running.

Costs
- `GET /costs` → `{today_usd, budget_usd, per_agent: {agent: usd}, series: [{hour: "2025-01-01T10:00:00Z", usd: 0.1}], recent: CostTickEvent[]}`

Agents
- `GET /agents` → `AgentSummary[]` (same objects as `/state.agents`)
- `GET /agents/{id}` → `{agent: AgentSummary, config: {role, tools, budgets, routines, skills}, memories: Memory[], log: ToolLogEvent[] (last 100), tasks: Task[]}`
- `GET /team` → `[{agent, xp, rank, tasks_done, approvals_requested, usd_today}]` sorted by xp desc

Routines
- `GET /routines` → `[{id, agent, cron, title, next_run}]`
- `POST /routines/{id}/run` → `{task_id}`

Memory objects: `{id, agent, task_id, kind, text, created_at}`.

## WebSocket `/api/ws`

- Server → client: every event in `packages/events` as JSON, one object per message. On connect the server sends
  `{"type":"hello","demo":true,"server_ts":"..."}`; the client then fetches `/api/state` to hydrate.
- Client → server: `{"type":"ping"}` → server replies `{"type":"pong"}`. Nothing else is accepted.
- Events are published to Redis stream `azzy:events` (field `data` = JSON); the API's `/ws` endpoint fans out by
  reading the stream (consumer per connection, starting at `$`). The worker publishes to the same stream.

## Redis streams

- `azzy:events` — fan-out to UI (and audit).
- `azzy:tasks` — orchestrator → worker queue: `{task_id}`; consumer group `workers`.
- `azzy:approvals` — worker waits here for decisions: key `azzy:approval:{id}` (pub/sub channel) carrying
  `{"status":"approved|rejected"}`. The worker blocks with `asyncio.wait_for(future, timeout=3600)`.

## Routing (orchestrator)

`POST /tasks` → `orchestrator.route(prompt)` returns `{lead, assignees, env_id, kind, title}`.
Keyword router (works in DEMO and real mode; in real mode it is followed by one LLM call that may refine):
- env detection: matches `Environment.name` / `id` / aliases (`client a`, `client b`, `vps`, `hq`, `staging`, `prod`).
- deploy / rollback / restart / logs / infra / k8s / terraform / cost → `jimmy`
- review / bug / fix / test / debug / data / model / train / notebook / sql → `john`
- deck / pptx / excel / xlsx / budget / email / client update / ticket / campaign / plan / pdf → `marwah`
- security / scan / pentest / audit / secrets / iam / nuclei / zap / e2e / playwright / release gate → `sara`
- Hinglish verbs are recognised (`karo`, `kar do`, `bhejo`, `banao`, `check karo`, `dekho`).
- Fallback: `john` for code-ish prompts, else `marwah`.

## Pipeline

`needs_work → needs_review → needs_qa → needs_docs → ready → needs_human → done` (and `failed`).
A command task created via the UI moves: `needs_work` (lead works) → `needs_review` (second agent reviews if any)
→ `needs_qa` (sara runs a gate when a deploy/code change happened, else skipped) → `needs_docs` (marwah writes the
summary, one `agent.say`) → `ready` → `done` (or `needs_human` when an approval is pending / rejected).
Every transition emits `task.updated`. XP: +25 for done, +10 per approved risky action, +5 per memory.

## Agent loop (worker)

For each step: emit `agent.phase` (think → tool → observe → act → learn), `tool.log` for each call, `agent.say`
for human-readable progress (≤ 100 chars), `cost.tick` after every LLM call, `memory.written` 1–3 times at the end.
`agent.move` to `desk` at the start; `waiting_approval` phase while blocked on an approval.
Approval flow: policy → `approval.requested` → phase `waiting_approval` → wait future → `approval.decided` → continue
(approved) or finish the task as `needs_human` with result "rejected by owner" (rejected) / `failed` on timeout.

## DEMO mode (`DEMO=1`)

- `azzy/llm.py` `StubLLM` returns deterministic plans keyed by task kind/agent (no network).
- Every tool returns realistic canned output from `azzy/tools/demo_data.py` with small random variation
  (seeded by task id).
- Step pacing: ~0.8–1.6 s between phases so the office animates visibly. Deploy scenario on Client B (prod,
  tailscale_ssh): `env.registry` → `ssh.safe_action status` → **approval** for `ssh.safe_action deploy v2.3`
  → deploy → `ssh.safe_action status` → `slack.post` → memories → done. Total ≈ 15 s after approval.
- Meeting: 4 × `agent.move pod`, each `agent.say` (≈ 3 s apart), then `agent.move desk`; `office.status meeting`
  during.
- Incident (war room): `office.status incident`; Jimmy lead (`cloudwatch.logs`, `aws.describe`), John root
  cause (`github.read`, `sandbox.run`), Sara attack check (`cloudwatch.logs`, `semgrep.scan`), Marwah drafts client
  update (`gmail.draft`); Jimmy requests approval for `aws.rollback` (high in prod); after approval → rollback →
  `aws.describe` healthy → incident `resolved`, `office.status nominal`, Marwah `gmail.send` **not** auto-sent
  (stays drafted). Timeline entries pushed via `incident.changed`.
- Env health probe returns healthy with jittered latency; Client B shows `v2.2.9` until a deploy sets `v2.3.0`.
- Costs: StubLLM reports token counts; price table in `azzy/costs.py` → `cost.tick` with real-looking USD.

## 3D office spots (world units, X right / Z toward camera)

- desks: jimmy (-6, 0, 0), john (-2, 0, 0), marwah (2, 0, 0), sara (6, 0, 0); characters sit at z = +1.1 facing -Z.
- meeting pod centre (0, 0, -9), radius 3.2; stools at angles 45°, 135°, 225°, 315°, radius 1.6.
- fuel bar at (11, 0, -4); lounge at (-11, 0, -4); LED wall: curved, centre (0, 3.2, -3.5), spans x ∈ [-10, 10].
- `agent.move` `to` values map to those positions in `apps/web/src/office/layout.ts`.
