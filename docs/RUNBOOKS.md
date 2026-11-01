# AZZY AI AGENTS v2.0 — Operations & recovery runbooks

Created by Shahrukh Khan

All commands assume the repo is at `/opt/azzy-ai-agents` and you are in that folder. `C` is shorthand for `docker compose -f infra/docker-compose.yml`. Every runbook ends with a **verify** step; do not skip it.

## 0. Know the system in 60 seconds

```bash
C ps                                            # six services, all "healthy"
curl -s http://localhost/healthz                # {"ok":true,...}
curl -s -b "azzy_session=<cookie>" http://localhost/api/system/metrics | jq   # queue_depth, worker_ok, db_ok, redis_ok
C logs --tail=100 worker                        # structured JSON
docker stats --no-stream                        # memory per container (limits: nginx 128m, web 768m, api 1g, worker 1.5g, pg 2g, redis 640m)
df -h / ; swapon --show                         # disk + 2 GB swap
```

`/app/monitoring` shows the same metrics with history; the office status pill and the worker heartbeat are the two fastest health signals.

---

## 1. Backup

**Automatic.** `/etc/cron.d/azzy-backup` runs `infra/scripts/backup.sh` at 03:00: `pg_dump` inside the postgres container → gzip → `/var/backups/azzy/azzy-<host>-<UTC>.sql.gz` (last 7 kept) → `aws s3 cp` to `s3://$BACKUP_BUCKET/postgres/` (SSE-S3; the bucket is versioned with a 30-day lifecycle) when `BACKUP_BUCKET` is set in `infra/.env`. Log: `/var/log/azzy-backup.log`.

**Manual.** `make backup` (same script). Before any risky operation below, run it.

**What is and is not in the dump.** In: users, tasks, agent/chat messages, approvals, audit, deployments, accounts, environments, knowledge documents + embeddings, memories, settings. Not in: the `artifacts` and `knowledge` upload volumes (binary files) and `infra/.env`. Back those up with:

```bash
docker run --rm -v azzy_artifacts:/a -v azzy_knowledge:/k -v /var/backups/azzy:/out alpine \
  sh -c 'tar czf /out/volumes-$(date -u +%Y%m%dT%H%M%SZ).tgz -C / a k'
cp infra/.env /root/azzy.env.$(date +%F) && chmod 600 /root/azzy.env.*     # or keep it in Secrets Manager azzy/env
```

**Verify:** `ls -lh /var/backups/azzy/ | tail -3`; `aws s3 ls s3://$BACKUP_BUCKET/postgres/ | tail -3`; `gzip -t <file>`.

---

## 2. Restore

Full database restore (destroys the current `azzy` database):

```bash
make backup                                             # safety copy of the current state
bash infra/scripts/restore.sh /var/backups/azzy/azzy-host-20260101T030000Z.sql.gz
bash infra/scripts/restore.sh s3://<bucket>/postgres/azzy-host-20260101T030000Z.sql.gz
bash infra/scripts/restore.sh --latest                  # newest object in the bucket
```

The script stops `api` and `worker`, terminates connections, drops and recreates `azzy` (with the `vector` extension), loads the dump, and starts `api` + `worker` again; the api runs `alembic upgrade head` on start, so a dump from an older version is migrated forward automatically. Type `restore` at the prompt (or `FORCE=1` for unattended use).

Volumes: `docker run --rm -v azzy_artifacts:/a -v azzy_knowledge:/k -v /var/backups/azzy:/in alpine sh -c 'cd / && tar xzf /in/volumes-<stamp>.tgz'`, then `C restart api worker`.

**Verify:** `C exec -T api alembic current` shows `(head)`; log in; `/app/tasks` shows historical tasks and `/app/audit` the old entries; the restore itself is logged in the script output (keep it with your change record).

**Moving to a new VM:** install Docker (`install-docker.sh`), clone the same version, copy `infra/.env` and `infra/nginx/certs/`, `C up -d --build`, then restore as above, then point DNS at the new IP.

---

## 3. Rotate secrets

Always `make backup` first. After editing `infra/.env`: `make restart` (or on EC2: update the `azzy/env` secret **and** the file, so a re-bootstrap does not revert it).

| Secret | Procedure | Effect |
|---|---|---|
| `OWNER_PASSWORD` | Preferred: change it in-app (*Settings → Profile*). Via env: set the new value, `make restart` — applied only if the user never changed it in-app. | admin password only |
| Any other user | Admin: *Settings → Users → Reset password* (`PATCH /api/users/{id} {password}`) | that user |
| `JWT_SECRET` | MFA secrets and AWS-account ExternalIds are encrypted with a key derived from it, so rotating it is a small project: 1) `make backup`. 2) Note every AWS account's ExternalId (from your own records — the API never returns it). 3) Set a new `openssl rand -hex 32`, `make restart`. 4) All users re-enrol MFA (*Settings → Profile*; an admin can clear a stuck enrolment with `C exec postgres psql -U azzy -c "update users set mfa_secret=null where email='…';"`). 5) Edit each AWS account in `/app/aws-accounts`, re-enter its ExternalId, **Verify**. | all sessions log out; MFA re-enrol; ExternalIds re-entered |
| `WEBHOOK_SECRET` | New value, `make restart`, update the header in the CloudWatch alarm action / SNS subscription. | webhooks |
| `POSTGRES_PASSWORD` | `C exec postgres psql -U azzy -c "ALTER USER azzy PASSWORD '<new>';"` → set `POSTGRES_PASSWORD` **and** `DATABASE_URL` → `make restart`. | none visible |
| LLM / integration keys | Replace in `.env`, `make restart`, then `/app/integrations → Test`. | none visible |
| AWS account ExternalId | Redeploy the client's CloudFormation stack with a new `ExternalId`, then edit the account in `/app/aws-accounts` and **Verify**. | that account |
| Tailscale auth key | Keys are single-use/expiring; the node identity stays. For a new HQ node, mint a key tagged `tag:azzy` and store it in `azzy/tailscale`. | none |
| TLS private key | `sudo /usr/local/bin/azzy-renew-tls` renews with a new key pair (`certbot renew` default). For immediate replacement: `certbot ... --force-renewal` via the same container command inside `enable_tls.sh`. | none |

**Verify:** log in, `/app/audit` shows `settings.changed`/`auth.login`, `/app/integrations` tests pass, `C logs --tail=50 api` has no `decrypt` errors.

---

## 4. Upgrade

```bash
make backup
make update            # git pull → build → up -d → wait for /healthz → prune
C exec -T api alembic current
C ps
```

Zip releases: unzip over the folder keeping `infra/.env`, `infra/nginx/certs/`, `infra/nginx/www/`; then `bash infra/scripts/deploy.sh`.

Rollback an upgrade: `git checkout <previous tag>` (or unzip the previous archive) → `C up -d --build`. If the new version added a migration, also `C exec api alembic downgrade <previous revision>` **before** switching the code, or restore the pre-upgrade backup. Check the release notes: migrations with data transforms list whether they are reversible.

Zero-ish downtime: `deploy.sh` rebuilds images first and then recreates containers one by one; the WebSocket reconnects automatically and in-flight tasks resume from their last durable step (approval waits survive, LLM calls in progress are retried once).

**Verify:** `curl -I https://<domain>` 200; `/app/monitoring` worker heartbeat < 30 s old; run the Client B demo scenario end-to-end.

---

## 5. Incident: worker down

Symptoms: `/app/monitoring` shows *worker: down* (heartbeat > 60 s), `queue_depth` growing, tasks stuck in `needs_work`, chat replies never arrive, office agents idle.

```bash
C ps worker                                   # Exited / Restarting / OOMKilled?
C logs --tail=200 worker                      # look for Traceback, "MemoryError", "redis", "asyncpg"
docker inspect azzy-worker-1 --format '{{.State.OOMKilled}} {{.State.ExitCode}}'
```

| Cause | Fix |
|---|---|
| OOM-killed (`true`) | `docker stats`; lower `WORKER_CONCURRENCY` (default 4 → 2) in `.env`; confirm swap; `C up -d --force-recreate worker`. Large PDF ingestion or scans are the usual culprits. |
| Redis unreachable | `C ps redis`; `C exec redis redis-cli ping`; if `MISCONF`/disk full see §6; `C restart redis worker`. |
| Postgres unreachable / too many connections | `C exec postgres psql -U azzy -c "select count(*) from pg_stat_activity"` (limit 60); `C restart worker`. |
| Crash loop after upgrade | `alembic current` vs head; roll back per §4. |
| Stuck but alive (no heartbeat, no crash) | `C restart worker`. The worker re-reads its consumer group: unacknowledged task ids are re-delivered (`XAUTOCLAIM`), so tasks resume. |

While the worker is down the API keeps serving reads, approvals can still be decided (they are consumed when the worker returns), and the UI shows the *worker down* banner — it never pretends work is happening.

After recovery, clean up anything that exceeded its 90-minute task timeout: they are marked `failed` with reason `timeout` on the next scheduler tick; cancel what should not be retried from `/app/tasks`.

**Verify:** `/api/system/metrics` → `worker_ok: true`, `queue_depth` draining; send `What environments do we have?` to Jimmy and get a reply.

---

## 6. Incident: disk full

Symptoms: Postgres `PANIC: could not write to file`, Redis `MISCONF Redis is configured to save RDB snapshots`, builds failing, `df -h /` at 100 %.

```bash
df -h / ; du -xsh /var/lib/docker /var/backups/azzy /var/log 2>/dev/null
docker system df -v | sort -k4 -h | tail       # biggest images / volumes
```

Reclaim, in this order:

1. `docker image prune -af --filter "until=72h"` and `docker builder prune -af` (old build layers from `--build` are usually several GB).
2. `ls -lt /var/backups/azzy | tail -n +8 | awk '{print $NF}' | xargs -r -I{} rm /var/backups/azzy/{}` (keep 7) — only if they are also in S3.
3. `journalctl --vacuum-size=200M`; container logs are already capped (10 MB × 5 per container).
4. Knowledge uploads: `/app/knowledge` → delete stale documents (files live in the `knowledge` volume). Artifacts: `/app/reports` → delete; or `docker run --rm -v azzy_artifacts:/a alpine find /a -mtime +90 -delete`.
5. Postgres bloat: `C exec postgres psql -U azzy -c "VACUUM (VERBOSE, ANALYZE);"`. The audit table grows forever by design; archive with `COPY (SELECT * FROM audit_log WHERE ts < now() - interval '180 days') TO STDOUT` → S3, then delete those rows, if you must.
6. Still full: grow the EBS volume (`aws ec2 modify-volume --size 200 ...`, then `sudo growpart /dev/nvme0n1 1 && sudo resize2fs /dev/nvme0n1p1`).

Then: `C restart redis postgres api worker` (Redis clears `MISCONF` on its own once it can write; if not, `C exec redis redis-cli config set stop-writes-on-bgsave-error no` temporarily).

**Verify:** `df -h /` < 80 %; `C ps` healthy; `C exec redis redis-cli ping` → PONG; `make backup` succeeds.

Prevention: the nightly backup keeps 7 local dumps; set a CloudWatch disk alarm (the CloudWatch agent is not installed by default) or a cron `df` check that posts to `SLACK_WEBHOOK_URL`.

---

## 7. Certificate renewal

Automatic: `/etc/cron.d/azzy-renew-tls` runs `/usr/local/bin/azzy-renew-tls` at 03:17 and 15:17 (`certbot renew` in a container through the webroot, then `nginx -s reload`). Let's Encrypt certificates last 90 days; renewal happens at 30 days remaining. Log: `/var/log/azzy-renew-tls.log`.

Check: `echo | openssl s_client -servername <domain> -connect <domain>:443 2>/dev/null | openssl x509 -noout -dates`.

If it expired or renewal fails:

```bash
sudo /usr/local/bin/azzy-renew-tls                          # manual run, read the error
C ps nginx ; curl -I http://<domain>/.well-known/acme-challenge/test   # must reach nginx (404 is fine, connection refused is not)
dig +short <domain>                                          # still your IP?
sudo bash infra/scripts/enable_tls.sh <domain> <email>       # full re-issue; safe to re-run; add --staging to debug rate limits
```

Changing the domain: run `enable_tls.sh` with the new domain (DNS first), then remove the old `live/<old>` folder under `infra/nginx/certs/` and update `PUBLIC_BASE_URL`.

**Verify:** `curl -I https://<domain>` → `HTTP/2 200` + `strict-transport-security`; browser padlock; new `notAfter` date.

---

## 8. Smaller procedures

- **Add a user:** *Settings → Users* or `curl -b … -H 'X-Requested-With: azzy' -X POST /api/users -d '{"email":…,"password":…,"role":"devops"}'`.
- **Locked out (lost MFA / password):** another admin resets you under *Settings → Users*. If you are the only admin, on the host: `C exec postgres psql -U azzy -c "update users set mfa_secret=null where email='you@…';"` and clear the user's *changed-in-app* marker (see the `users` model in `apps/api/azzy/db/models.py` for the column), set a new `OWNER_PASSWORD` in `infra/.env`, `make restart` (the seeder re-applies the env password only when that marker is clear). Audit it yourself: the change bypasses the API.
- **Pause all agents:** `C stop worker` (approvals and reads keep working); resume with `C start worker`.
- **Emergency: revoke AWS access:** delete/disable the `AzzyReadOnlyRole/AuditRole/DeploymentRole` stack in the client account, or set the account to *disabled* in `/app/aws-accounts`; for the HQ role, detach the policy in IAM.
- **Rotate Tailscale ACL:** paste the updated `infra/tailscale-acl.json`; test with `tailscale ssh azzy-deploy@<server> azzy-action status` and confirm `root` is denied.
- **Re-run the EC2 bootstrap** (new secret values): `sudo bash infra/scripts/bootstrap.sh` — idempotent; it rewrites `infra/.env` from `azzy/env` only if that secret is not the placeholder.
- **Reset DEMO data:** `C down -v` (destroys *everything*, including users) → `C up -d`. For a soft reset keep users: `C exec postgres psql -U azzy -c "truncate tasks, agent_messages, chat_messages, conversations, approvals, incidents, deployments, memories cascade;"` then `C restart api worker` (re-seeds demo environments and accounts).
