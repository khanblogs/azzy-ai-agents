"""Realistic canned outputs for every allowlisted tool (DEMO=1).

Pure module (stdlib only). `demo_output(tool, args, seed)` is deterministic for a given
(tool, args, seed) and varies slightly across seeds (task ids) so repeated demos look alive.
"""

from __future__ import annotations

import hashlib
import json
import random
from datetime import UTC, datetime, timedelta
from typing import Any

ALL_TOOLS: tuple[str, ...] = (
    "env.registry", "aws.describe", "aws.deploy", "aws.rollback", "aws.cost", "cloudwatch.logs",
    "ssh.safe_action", "github.read", "github.branch_pr", "sandbox.run", "sql.read", "pptx.build",
    "xlsx.model", "pdf.export", "gmail.draft", "gmail.send", "slack.post", "gcal.schedule",
    "zendesk.update", "semgrep.scan", "gitleaks.scan", "trivy.scan", "checkov.scan", "nuclei.scan",
    "zap.scan", "iam.review", "aws.accounts", "aws.inventory", "knowledge.search", "agent.message",
    "playwright.run", "memory.write",
)

DEMO_ACCOUNTS: list[dict[str, Any]] = [
    {"id": "demo-dev", "name": "Demo Dev", "account_id": "111122223333", "role_arn": "arn:aws:iam::111122223333:role/AzzyReadOnlyRole", "scope": "readonly", "regions": ["ap-south-1", "us-east-1"], "stage": "dev"},
    {"id": "demo-prod", "name": "Demo Prod", "account_id": "444455556666", "role_arn": "arn:aws:iam::444455556666:role/AzzyDeploymentRole", "scope": "deploy", "regions": ["ap-south-1"], "stage": "prod"},
]

SCOPE_PROBES: dict[str, tuple[str, ...]] = {
    "readonly": ("sts:AssumeRole", "ec2:DescribeInstances", "ecs:ListClusters", "logs:DescribeLogGroups", "ce:GetCostAndUsage"),
    "audit": ("sts:AssumeRole", "ec2:DescribeInstances", "ecs:ListClusters", "logs:DescribeLogGroups", "ce:GetCostAndUsage", "iam:GetAccountAuthorizationDetails", "config:DescribeConfigRules"),
    "deploy": ("sts:AssumeRole", "ec2:DescribeInstances", "ecs:ListClusters", "logs:DescribeLogGroups", "ce:GetCostAndUsage", "ecs:UpdateService (simulated)"),
}


def demo_verify_account(account_id: str, scope: str) -> tuple[str, list[dict[str, Any]], str | None]:
    """DEMO verification rule (CONTRACT-v2 §6): ids starting 1-4 verify; others fail with an STS error."""
    probes = SCOPE_PROBES.get(scope, SCOPE_PROBES["readonly"])
    if account_id[:1] in {"1", "2", "3", "4"}:
        return "verified", [{"name": name, "ok": True} for name in probes], None
    permissions = [{"name": name, "ok": name != "sts:AssumeRole" and False} for name in probes]
    error = (
        f"AccessDenied: User: arn:aws:sts::999988887777:assumed-role/AzzyOrchestrator is not authorized to perform: "
        f"sts:AssumeRole on resource: arn:aws:iam::{account_id}:role/Azzy*Role (check the trust policy and ExternalId)"
    )
    return "failed", permissions, error


def demo_inventory(account_id: str, region: str, seed: str | int = "inventory") -> dict[str, Any]:
    """Labelled demo inventory for one account/region (shape = GET /aws-accounts/{id}/inventory)."""
    r = _rng("aws.inventory", {"account_id": account_id, "region": region}, seed)
    short = account_id[-4:]
    names = ["api", "worker", "web", "scheduler", "ingest"]
    ec2 = [{"id": f"i-0{r.randrange(16**15):015x}", "name": f"{n}-{short}", "type": r.choice(["t3.medium", "m7i.large", "c7g.xlarge"]), "state": "running" if r.random() > 0.1 else "stopped", "az": f"{region}{r.choice('abc')}"} for n in names[: r.randint(2, 4)]]
    ecs = [{"cluster": f"app-{short}", "service": n, "task_definition": f"{n}:{r.randint(100, 200)}", "desired": 2, "running": 2 if r.random() > 0.15 else 1, "launch_type": "FARGATE"} for n in names[:3]]
    eks = [{"name": f"eks-{short}", "version": "1.30", "status": "ACTIVE", "nodegroups": r.randint(1, 3)}] if r.random() > 0.5 else []
    lam = [{"name": f"{n}-handler", "runtime": "python3.12", "memory_mb": r.choice([256, 512, 1024]), "last_modified": _ts(_now() - timedelta(days=r.randint(1, 40)))} for n in ("alarm", "backup", "thumbnail")[: r.randint(1, 3)]]
    s3 = [{"name": f"azzy-{short}-{n}", "created": _ts(_now() - timedelta(days=r.randint(30, 600))), "versioning": r.random() > 0.3, "public_block": True} for n in ("artifacts", "backups", "logs")]
    rds = [{"id": f"db-{short}", "engine": "postgres 16.3", "class": "db.t4g.medium", "status": "available", "multi_az": r.random() > 0.5, "storage_gb": r.choice([50, 100, 200])}]
    cf = [{"id": f"E{r.randrange(36**12):012X}"[:14], "domain": f"d{r.randrange(10**9)}.cloudfront.net", "aliases": [f"app-{short}.example.com"], "status": "Deployed", "waf": True}]
    waf = [{"name": f"azzy-{short}-webacl", "scope": "CLOUDFRONT", "rules": r.randint(4, 9), "blocked_24h": r.randint(0, 4200)}]
    r53 = [{"zone": f"{short}.example.com", "records": r.randint(8, 40), "private": False}]
    return {
        "account_id": account_id, "region": region, "generated_at": _ts(_now()), "demo": True,
        "resources": {"ec2": ec2, "ecs": ecs, "eks": eks, "lambda": lam, "s3": s3, "rds": rds, "cloudfront": cf, "waf": waf, "route53": r53},
    }

DEMO_ENVIRONMENTS: list[dict[str, Any]] = [
    {"id": "client-a-staging", "name": "Client A — staging", "kind": "staging", "method": "assume_role", "region": "ap-south-1", "version": "v2.3.1", "health": "healthy"},
    {"id": "client-b-vps", "name": "Client B — VPS", "kind": "prod", "method": "tailscale_ssh", "region": None, "version": "v2.2.9", "health": "healthy"},
    {"id": "hq", "name": "HQ", "kind": "hq", "method": "hq", "region": "ap-south-1", "version": "v0.1.0", "health": "healthy"},
]


def _rng(tool: str, args: dict[str, Any], seed: str | int) -> random.Random:
    key = json.dumps({"t": tool, "a": args, "s": str(seed)}, sort_keys=True, default=str)
    return random.Random(int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big"))  # noqa: S311


def _now() -> datetime:
    return datetime.now(UTC)


def _ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _env_name(args: dict[str, Any]) -> str:
    env_id = str(args.get("env_id") or "client-a-staging")
    for env in DEMO_ENVIRONMENTS:
        if env["id"] == env_id:
            return env["name"]
    return env_id


def _version(args: dict[str, Any], default: str = "v2.3.0") -> str:
    version = str(args.get("version") or args.get("to") or default)
    if version == "previous":
        return "v2.2.9"
    if not version.startswith("v"):
        version = "v" + version
    if version.count(".") == 1:
        version += ".0"
    return version


# --------------------------------------------------------------------------------------------
# per-tool generators
# --------------------------------------------------------------------------------------------


def _env_registry(args: dict[str, Any], r: random.Random) -> str:
    env_id = args.get("env_id")
    rows = [e for e in DEMO_ENVIRONMENTS if not env_id or e["id"] == env_id]
    if not rows:
        return json.dumps({"error": f"unknown environment {env_id}"})
    out = []
    for e in rows:
        out.append({**e, "latency_ms": r.randint(38, 140), "last_checked": _ts(_now() - timedelta(seconds=r.randint(5, 55)))})
    return json.dumps(out if not env_id else out[0], indent=2)


def _aws_describe(args: dict[str, Any], r: random.Random) -> str:
    service = str(args.get("service") or "ecs")
    env = _env_name(args)
    if service == "iam":
        return json.dumps({
            "account": "111122223333", "roles": [
                {"name": "AzzyAgentRole", "trust": "arn:aws:iam::999988887777:root", "external_id": True, "last_used": _ts(_now() - timedelta(minutes=r.randint(1, 90)))},
                {"name": "ecsTaskExecutionRole", "managed_policies": 1},
            ], "users_with_console": 0, "mfa_enforced": True,
        }, indent=2)
    if service in {"rds", "db"}:
        return json.dumps({"env": env, "engine": "postgres 16.3", "instance": "db.t4g.medium", "status": "available", "cpu_pct": r.randint(6, 24), "connections": r.randint(8, 40), "free_storage_gb": round(r.uniform(40, 90), 1)}, indent=2)
    desired = 2
    deploying = bool(args.get("_after_deploy"))
    return json.dumps({
        "env": env, "cluster": args.get("cluster", "app"), "service": "api",
        "task_definition": f"api:{r.randint(140, 180)}", "desired": desired, "running": desired, "pending": 0,
        "deployments": [{"status": "PRIMARY", "rollout_state": "IN_PROGRESS" if deploying else "COMPLETED", "running": desired}],
        "target_group": {"healthy": desired, "unhealthy": 0}, "cpu_pct": r.randint(8, 31), "mem_pct": r.randint(28, 55),
        "p95_latency_ms": r.randint(70, 180), "error_rate_pct": round(r.uniform(0.02, 0.2), 2),
        "last_deploy": _ts(_now() - timedelta(hours=r.randint(2, 40))),
    }, indent=2)


def _aws_deploy(args: dict[str, Any], r: random.Random, rollback: bool = False) -> str:
    version = _version(args, "v2.2.9" if rollback else "v2.3.0")
    env = _env_name(args)
    rev = r.randint(150, 190)
    lines = [
        f"{'Rollback' if rollback else 'Deploy'} {version} → {env} (ECS service update)",
        f"  registered task definition api:{rev}",
        f"  service api updated, desiredCount=2, deploymentController=ECS, minHealthy=100% max=200%",
        f"  [{r.randint(10, 18)}s] 1/2 new tasks RUNNING, draining 1 old task",
        f"  [{r.randint(28, 45)}s] 2/2 new tasks RUNNING, target group healthy (2/2)",
        f"  [{r.randint(50, 75)}s] rollout COMPLETED, rolloutState=COMPLETED",
        f"  post-{'rollback' if rollback else 'deploy'} check: 5xx={round(r.uniform(0.0, 0.08), 2)}% p95={r.randint(72, 150)}ms",
        f"result: ok version={version}",
    ]
    return "\n".join(lines)


def _aws_cost(args: dict[str, Any], r: random.Random) -> str:
    days = int(args.get("days") or 7)
    services = [("Amazon Elastic Container Service", 1.9), ("Amazon EC2", 2.6), ("Amazon RDS", 1.5), ("AWS Data Transfer", 0.4), ("Amazon CloudWatch", 0.25), ("Amazon S3", 0.12), ("AWS Secrets Manager", 0.03)]
    rows = []
    total = 0.0
    for name, base in services:
        usd = round(base * days * r.uniform(0.85, 1.15), 2)
        total += usd
        rows.append({"service": name, "usd": usd})
    return json.dumps({
        "env": _env_name(args), "period_days": days, "currency": "USD", "total": round(total, 2),
        "delta_vs_previous_pct": round(r.uniform(-6.5, 4.0), 1), "by_service": rows,
        "anomalies": ([] if r.random() > 0.35 else [{"service": "AWS Data Transfer", "note": "NAT gateway bytes +38% on Tuesday"}]),
    }, indent=2)


def _cloudwatch_logs(args: dict[str, Any], r: random.Random) -> str:
    group = str(args.get("log_group") or "/ecs/api")
    minutes = int(args.get("minutes") or 30)
    filt = str(args.get("filter") or "")
    now = _now()
    lines = [f"log group {group}, last {minutes} min" + (f", filter={filt!r}" if filt else "")]
    incident = "ERROR" in filt.upper() or "400" in filt or minutes <= 15
    n = r.randint(6, 10)
    for i in range(n):
        ts = now - timedelta(seconds=r.randint(5, minutes * 60))
        if incident and i % 2 == 0:
            lines.append(f"{_ts(ts)} ERROR payments.retry: RetryBudgetExceeded after 32 attempts order=ord_{r.randint(10000, 99999)} upstream=psp timeout=2.0s")
        elif incident and i % 3 == 0:
            lines.append(f"{_ts(ts)} WARN  http: 503 Service Unavailable path=/api/checkout latency_ms={r.randint(1900, 4200)}")
        else:
            lines.append(f"{_ts(ts)} INFO  http: 200 path=/api/{r.choice(['health', 'orders', 'me', 'catalog'])} latency_ms={r.randint(12, 140)} rid={hashlib.md5(str(i).encode()).hexdigest()[:8]}")  # noqa: S324
    lines.sort()
    if incident:
        lines.append(f"summary: {r.randint(180, 420)} ERROR lines in window; first error at {_ts(now - timedelta(minutes=min(minutes, 12)))}, matches deploy at {_ts(now - timedelta(minutes=min(minutes, 13)))}")
    else:
        lines.append("summary: 0 ERROR, 0 WARN in window")
    return "\n".join(lines)


def _ssh_safe_action(args: dict[str, Any], r: random.Random) -> str:
    action = str(args.get("action") or "status").lower()
    host = str(args.get("host") or "100.101.102.103")
    header = f"$ ssh azzy-deploy@{host} azzy-action {action}"
    if action == "status":
        # `_current_version` is injected by the executor from the environments table so the
        # status output tracks what was last deployed.
        current = str(args.get("_current_version") or "v2.2.9")
        return "\n".join([
            header,
            f"service      : client-b-api (systemd) active (running) since {r.randint(2, 30)}h ago",
            f"version      : {current}",
            f"health       : GET /healthz 200 in {r.randint(9, 40)}ms",
            f"load         : {round(r.uniform(0.1, 0.8), 2)} {round(r.uniform(0.1, 0.7), 2)} {round(r.uniform(0.1, 0.6), 2)}",
            f"memory       : {r.randint(610, 980)}MiB / 3914MiB",
            f"disk /       : {r.randint(31, 58)}% used",
            "result: ok",
        ])
    if action in {"deploy", "rollback"}:
        version = _version(args, "v2.2.9" if action == "rollback" else "v2.3.0")
        return "\n".join([
            header + f" {version}",
            f"pulling ghcr.io/azzy-ai-agents/client-b-api:{version} ... done ({r.randint(12, 48)}MB)",
            "running migrations ... 0 pending",
            "restarting client-b-api.service ... done",
            f"health check: 200 after {r.randint(1, 4)} attempts",
            f"version      : {version}",
            "result: ok",
        ])
    if action == "restart":
        return "\n".join([header, "restarting client-b-api.service ... done", f"health check: 200 in {r.randint(300, 1900)}ms", "result: ok"])
    if action == "logs":
        return "\n".join([header, *(f"{_ts(_now() - timedelta(seconds=i * r.randint(2, 20)))} INFO http 200 /api/{r.choice(['orders', 'health', 'me'])} {r.randint(10, 90)}ms" for i in range(8)), "result: ok"])
    if action == "disk":
        return "\n".join([header, "Filesystem      Size  Used Avail Use% Mounted on", f"/dev/root        78G   {r.randint(22, 40)}G   {r.randint(35, 50)}G  {r.randint(31, 58)}% /", "result: ok"])
    if action == "top":
        return "\n".join([header, f"load average: {round(r.uniform(0.1, 0.9), 2)}", "  PID USER      %CPU %MEM COMMAND", f" {r.randint(1000, 9999)} app       {round(r.uniform(1, 9), 1)}  {round(r.uniform(8, 20), 1)} client-b-api", f" {r.randint(100, 999)} postgres  {round(r.uniform(0.5, 4), 1)}   {round(r.uniform(4, 12), 1)} postgres", "result: ok"])
    return f"{header}\nerror: action {action!r} not allowlisted\nresult: rejected"


def _github_read(args: dict[str, Any], r: random.Random) -> str:
    repo = str(args.get("repo") or "azzy-ai-agents/client-b-api")
    path = str(args.get("path") or "src/")
    ref = str(args.get("ref") or "main")
    sha = hashlib.sha1(f"{repo}{ref}{r.random()}".encode()).hexdigest()[:7]  # noqa: S324
    if path.endswith("/"):
        return json.dumps({"repo": repo, "ref": ref, "head": sha, "path": path, "entries": [
            {"name": "payments/retry.py", "size": 2140, "type": "file"},
            {"name": "payments/client.py", "size": 3310, "type": "file"},
            {"name": "api/routes.py", "size": 8822, "type": "file"},
            {"name": "tests/test_retry.py", "size": 1210, "type": "file"},
        ], "recent_commits": [
            {"sha": sha, "message": "feat(payments): retry on PSP timeout", "author": "emir", "when": _ts(_now() - timedelta(hours=r.randint(1, 6)))},
            {"sha": hashlib.sha1(sha.encode()).hexdigest()[:7], "message": "chore: bump deps", "author": "emir", "when": _ts(_now() - timedelta(days=1))},  # noqa: S324
        ]}, indent=2)
    return "\n".join([
        f"# {repo}@{ref}:{path}",
        "import time",
        "",
        "def with_retry(fn, *, max_attempts=None, backoff=0.5):",
        "    attempt = 0",
        "    while True:  # BUG: max_attempts is never checked",
        "        try:",
        "            return fn()",
        "        except TimeoutError:",
        "            attempt += 1",
        "            time.sleep(backoff * attempt)",
    ])


def _github_branch_pr(args: dict[str, Any], r: random.Random) -> str:
    repo = str(args.get("repo") or "azzy-ai-agents/client-b-api")
    base = str(args.get("base") or "develop")
    branch = str(args.get("branch") or "fix/azzy")
    if base.lower() in {"main", "master", "prod", "production"}:
        return json.dumps({"error": f"refusing to open a PR against protected base {base!r}; use develop"})
    number = r.randint(120, 480)
    return json.dumps({"repo": repo, "base": base, "branch": branch, "pr": number, "url": f"https://github.com/{repo}/pull/{number}", "title": args.get("title", "fix: bounded retry"), "files_changed": 2, "additions": 23, "deletions": 4, "checks": "queued"}, indent=2)


def _sandbox_run(args: dict[str, Any], r: random.Random) -> str:
    cmd = str(args.get("cmd") or "pytest -q")
    image = str(args.get("image") or "python:3.12-slim")
    if "pytest" in cmd:
        failing = "retry" in cmd
        n = r.randint(38, 64)
        body = f"{'.' * (n - 1)}F\n" if failing else f"{'.' * n}\n"
        tail = (
            f"FAILED tests/test_retry.py::test_bounded_attempts - AssertionError: expected RetryBudgetExceeded after 5 attempts\n1 failed, {n - 1} passed in {round(r.uniform(2.1, 6.4), 2)}s"
            if failing else f"{n} passed in {round(r.uniform(1.8, 5.2), 2)}s"
        )
        return f"$ docker run --rm --network none --memory 512m --cpus 1 {image} {cmd}\n{body}{tail}\nexit={1 if failing else 0}"
    return f"$ docker run --rm --network none --memory 512m --cpus 1 {image} {cmd}\nok\nexit=0 ({r.randint(120, 900)}ms)"


def _sql_read(args: dict[str, Any], r: random.Random) -> str:
    query = str(args.get("query") or "SELECT 1")
    rows = []
    day = _now().date()
    for i in range(7):
        rows.append({"d": str(day - timedelta(days=6 - i)), "count": r.randint(380, 560)})
    return json.dumps({"dsn": args.get("dsn", "analytics-ro"), "query": query[:200], "rows": rows, "row_count": len(rows), "elapsed_ms": r.randint(18, 240), "read_only": True}, indent=2)


def _office(tool: str, args: dict[str, Any], r: random.Random) -> str:
    title = str(args.get("title") or "Document")
    ext = {"pptx.build": "pptx", "xlsx.model": "xlsx", "pdf.export": "pdf"}[tool]
    slug = "".join(c if c.isalnum() else "-" for c in title.lower())[:40].strip("-") or "artifact"
    path = f"/data/artifacts/{slug}-{r.randint(1000, 9999)}.{ext}"
    detail = {"pptx.build": f"slides={len(args.get('slides') or [])}", "xlsx.model": f"sheets={len(args.get('sheets') or [])}, formulas=yes", "pdf.export": f"pages={max(1, len(args.get('sections') or []) // 2 + 1)}"}[tool]
    return json.dumps({"artifact": path, "title": title, "detail": detail, "bytes": r.randint(18_000, 240_000)}, indent=2)


def _gmail_draft(args: dict[str, Any], r: random.Random) -> str:
    return json.dumps({"draft_id": f"r-{r.randint(10**12, 10**13)}", "to": args.get("to", "client@example.com"), "subject": args.get("subject", "(no subject)"), "status": "drafted", "sent": False}, indent=2)


def _gmail_send(args: dict[str, Any], r: random.Random) -> str:
    return json.dumps({"message_id": f"<{r.randint(10**9, 10**10)}@mail.gmail.com>", "to": args.get("to", "client@example.com"), "status": "sent", "sent_at": _ts(_now())}, indent=2)


def _slack_post(args: dict[str, Any], r: random.Random) -> str:
    return json.dumps({"ok": True, "channel": args.get("channel", "#ops"), "ts": f"{int(_now().timestamp())}.{r.randint(100000, 999999)}", "text": str(args.get("text", ""))[:200]}, indent=2)


def _gcal_schedule(args: dict[str, Any], r: random.Random) -> str:
    return json.dumps({"event_id": f"evt_{r.randint(10**8, 10**9)}", "title": args.get("title", "Meeting"), "when": args.get("when", "tomorrow 11:00"), "attendees": args.get("attendees", []), "status": "confirmed"}, indent=2)


def _zendesk_update(args: dict[str, Any], r: random.Random) -> str:
    return json.dumps({"ticket_id": args.get("ticket_id", "4821"), "status": args.get("status", "pending"), "audit_id": r.randint(10**6, 10**7), "public": True, "updated_at": _ts(_now())}, indent=2)


def _semgrep(args: dict[str, Any], r: random.Random) -> str:
    findings = [
        {"rule": "python.lang.security.audit.dangerous-subprocess-use", "severity": "WARNING", "path": "scripts/release.py", "line": 41},
        {"rule": "python.flask.security.audit.debug-enabled", "severity": "WARNING", "path": "app/__init__.py", "line": 12},
    ]
    chosen = findings[: r.randint(0, 2)]
    return json.dumps({"tool": "semgrep", "ruleset": args.get("ruleset", "p/ci"), "repo": args.get("repo"), "files_scanned": r.randint(120, 340), "findings": chosen, "critical": 0, "high": 0, "medium": len(chosen), "elapsed_s": round(r.uniform(8, 40), 1)}, indent=2)


def _gitleaks(args: dict[str, Any], r: random.Random) -> str:
    leaks = [] if r.random() > 0.25 else [{"rule": "generic-api-key", "file": "tests/fixtures/sample.env", "commit": hashlib.sha1(b"x").hexdigest()[:7], "note": "test fixture, rotated"}]  # noqa: S324
    return json.dumps({"tool": "gitleaks", "repo": args.get("repo"), "commits_scanned": r.randint(400, 2200), "leaks": leaks, "verdict": "PASS" if not leaks else "REVIEW"}, indent=2)


def _trivy(args: dict[str, Any], r: random.Random) -> str:
    vulns = [
        {"id": "CVE-2024-34064", "pkg": "jinja2", "installed": "3.1.3", "fixed": "3.1.4", "severity": "MEDIUM"},
        {"id": "CVE-2024-35195", "pkg": "requests", "installed": "2.31.0", "fixed": "2.32.0", "severity": "MEDIUM"},
    ]
    return json.dumps({"tool": "trivy", "image": args.get("image", "api:latest"), "os": "debian 12.5", "vulnerabilities": vulns[: r.randint(1, 2)], "critical": 0, "high": 0, "misconfigs": 0}, indent=2)


def _checkov(args: dict[str, Any], r: random.Random) -> str:
    failed = [{"check": "CKV_AWS_23", "resource": "aws_security_group.web", "msg": "Ensure every security group rule has a description"}] if r.random() > 0.4 else []
    return json.dumps({"tool": "checkov", "path": args.get("path", "infra/terraform"), "passed": r.randint(110, 160), "failed": failed, "skipped": 3}, indent=2)


def _nuclei(args: dict[str, Any], r: random.Random) -> str:
    target = str(args.get("target") or "https://staging.client-a.example.com")
    findings = [
        {"template": "http/misconfiguration/http-missing-security-headers", "severity": "info", "matched": target, "detail": "missing: Permissions-Policy"},
        {"template": "http/technologies/tech-detect", "severity": "info", "matched": target, "detail": "nginx, fastapi"},
    ]
    if r.random() > 0.6:
        findings.append({"template": "http/exposures/configs/git-config", "severity": "medium", "matched": target + "/.git/config", "detail": "exposed .git/config (404 after fix)"})
    return json.dumps({"tool": "nuclei", "target": target, "templates": r.randint(3800, 4300), "requests": r.randint(9000, 16000), "findings": findings, "critical": 0, "high": 0, "elapsed_s": r.randint(90, 260)}, indent=2)


def _playwright(args: dict[str, Any], r: random.Random) -> str:
    total = 12 if args.get("suite") == "smoke" else r.randint(28, 46)
    return "\n".join([
        f"Running {total} tests using 2 workers (base_url={args.get('base_url', 'https://staging.client-a.example.com')})",
        f"  ✓ login › owner can log in ({r.randint(800, 1400)}ms)",
        f"  ✓ approvals › approve from bubble ({r.randint(1200, 2100)}ms)",
        f"  ✓ pipeline › drag task to needs_review ({r.randint(900, 1700)}ms)",
        f"  ✓ mobile › bottom tabs at 390px ({r.randint(700, 1300)}ms)",
        f"  ... {total - 4} more",
        f"{total} passed ({round(r.uniform(18, 52), 1)}s)",
    ])


def _zap(args: dict[str, Any], r: random.Random) -> str:
    target = str(args.get("target") or "https://staging.client-a.example.com")
    alerts = [
        {"alert": "Content Security Policy (CSP) Header Not Set", "risk": "Medium", "confidence": "High", "url": target + "/"},
        {"alert": "Cookie without SameSite Attribute", "risk": "Low", "confidence": "Medium", "url": target + "/login"},
        {"alert": "X-Content-Type-Options Header Missing", "risk": "Low", "confidence": "Medium", "url": target + "/api/health"},
    ]
    return json.dumps({"tool": "zap", "mode": args.get("mode", "baseline"), "target": target, "urls_crawled": r.randint(40, 180), "alerts": alerts[: r.randint(1, 3)], "high": 0, "medium": 1 if r.random() > 0.3 else 0, "elapsed_s": r.randint(60, 240)}, indent=2)


def _iam_review(args: dict[str, Any], r: random.Random) -> str:
    account = str(args.get("account_id") or "111122223333")
    findings = [
        {"severity": "high", "resource": "user/legacy-ci", "finding": "access key older than 180 days", "fix": "rotate and move CI to OIDC"},
        {"severity": "medium", "resource": "role/ecsTaskExecutionRole", "finding": "wildcard s3:* on artifacts bucket", "fix": "scope to the two buckets actually used"},
        {"severity": "low", "resource": "account", "finding": "password policy allows 8 chars", "fix": "raise to 14 + MFA enforced"},
    ]
    return json.dumps({"tool": "iam.review", "account_id": account, "roles": r.randint(12, 40), "users": r.randint(0, 6), "mfa_enforced": True, "root_access_keys": 0, "admin_policies_attached": r.randint(0, 2), "findings": findings[: r.randint(1, 3)]}, indent=2)


def _aws_accounts(args: dict[str, Any], r: random.Random) -> str:
    rows = []
    for acct in DEMO_ACCOUNTS:
        rows.append({**acct, "status": "verified", "last_verified": _ts(_now() - timedelta(minutes=r.randint(5, 600))), "demo": True})
    return json.dumps(rows, indent=2)


def _aws_inventory(args: dict[str, Any], r: random.Random) -> str:
    account = str(args.get("account_id") or "111122223333")
    region = str(args.get("region") or "ap-south-1")
    inv = demo_inventory(account, region, seed=str(r.random()))
    counts = {k: len(v) for k, v in inv["resources"].items()}
    return json.dumps({"account_id": account, "region": region, "demo": True, "counts": counts, "resources": inv["resources"]}, indent=2)


def _knowledge_search(args: dict[str, Any], r: random.Random) -> str:
    q = str(args.get("q") or args.get("query") or "")
    hits = [
        {"document_id": "rb-ecs-rollback", "title": "Runbook: ECS rollback", "chunk": "Roll back by pointing the service at the previous task definition revision; wait for services_stable, then confirm target group health.", "score": round(r.uniform(0.72, 0.9), 3)},
        {"document_id": "rb-release-gate", "title": "Runbook: release gate", "chunk": "A release is blocked on any critical finding; medium findings need a tracked ticket before go-live.", "score": round(r.uniform(0.5, 0.7), 3)},
    ]
    return json.dumps({"query": q, "scope": args.get("scope", "global"), "hits": hits, "demo": True}, indent=2)


def _agent_message(args: dict[str, Any], r: random.Random) -> str:
    return json.dumps({"ok": True, "to": args.get("to"), "type": args.get("type", "note"), "content": str(args.get("content", ""))[:200]}, indent=2)


def _memory_write(args: dict[str, Any], r: random.Random) -> str:
    return json.dumps({"ok": True, "kind": args.get("kind", "fact"), "text": str(args.get("text", ""))[:200]}, indent=2)


_GENERATORS = {
    "env.registry": _env_registry,
    "aws.describe": _aws_describe,
    "aws.deploy": lambda a, r: _aws_deploy(a, r, rollback=False),
    "aws.rollback": lambda a, r: _aws_deploy(a, r, rollback=True),
    "aws.cost": _aws_cost,
    "cloudwatch.logs": _cloudwatch_logs,
    "ssh.safe_action": _ssh_safe_action,
    "github.read": _github_read,
    "github.branch_pr": _github_branch_pr,
    "sandbox.run": _sandbox_run,
    "sql.read": _sql_read,
    "pptx.build": lambda a, r: _office("pptx.build", a, r),
    "xlsx.model": lambda a, r: _office("xlsx.model", a, r),
    "pdf.export": lambda a, r: _office("pdf.export", a, r),
    "gmail.draft": _gmail_draft,
    "gmail.send": _gmail_send,
    "slack.post": _slack_post,
    "gcal.schedule": _gcal_schedule,
    "zendesk.update": _zendesk_update,
    "semgrep.scan": _semgrep,
    "gitleaks.scan": _gitleaks,
    "trivy.scan": _trivy,
    "checkov.scan": _checkov,
    "nuclei.scan": _nuclei,
    "playwright.run": _playwright,
    "memory.write": _memory_write,
    "zap.scan": _zap,
    "iam.review": _iam_review,
    "aws.accounts": _aws_accounts,
    "aws.inventory": _aws_inventory,
    "knowledge.search": _knowledge_search,
    "agent.message": _agent_message,
}


def demo_output(tool: str, args: dict[str, Any] | None, seed: str | int = "demo") -> str:
    """Canned output for `tool`. Raises KeyError for tools that do not exist."""
    args = dict(args or {})
    generator = _GENERATORS[tool]
    return generator(args, _rng(tool, args, seed))


def demo_latency_ms(tool: str, seed: str | int = "demo") -> int:
    """Plausible duration for the tool.log event."""
    base = {
        "aws.deploy": 2600, "aws.rollback": 2200, "ssh.safe_action": 900, "nuclei.scan": 3200, "playwright.run": 2800,
        "trivy.scan": 1900, "semgrep.scan": 1500, "sandbox.run": 1400, "pptx.build": 700, "xlsx.model": 500,
        "zap.scan": 2600, "iam.review": 1200, "aws.inventory": 900, "knowledge.search": 120, "agent.message": 30,
        "pdf.export": 400, "cloudwatch.logs": 600, "aws.describe": 450, "sql.read": 180, "env.registry": 40,
    }.get(tool, 300)
    r = _rng(tool, {}, seed)
    return int(base * r.uniform(0.75, 1.3))
