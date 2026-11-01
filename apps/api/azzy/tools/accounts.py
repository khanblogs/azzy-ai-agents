"""aws.accounts / aws.inventory / iam.review — multi-account read-only adapters (CONTRACT-v2 §6).

Real mode assumes the account's role with STS (+ExternalId decrypted from the table) and makes
read-only calls only. The same helpers back `/aws-accounts/{id}/verify` and `/inventory`.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import UTC, datetime
from typing import Any

from azzy.tools.base import NotConfigured, ToolContext, ToolError, ToolSpec, schema, str_prop

_ACCOUNT_ID = re.compile(r"^\d{12}$")
_ROLE_ARN = re.compile(r"^arn:aws:iam::\d{12}:role/[\w+=,.@/-]+$")
_REGION = re.compile(r"^[a-z]{2}-[a-z]+-\d$")

READONLY_PROBES: tuple[tuple[str, str, str, dict[str, Any]], ...] = (
    ("ec2:DescribeInstances", "ec2", "describe_instances", {"MaxResults": 5}),
    ("ecs:ListClusters", "ecs", "list_clusters", {"maxResults": 5}),
    ("logs:DescribeLogGroups", "logs", "describe_log_groups", {"limit": 5}),
    ("ce:GetCostAndUsage", "ce", "get_cost_and_usage", {}),
)
AUDIT_PROBES: tuple[tuple[str, str, str, dict[str, Any]], ...] = (
    ("iam:GetAccountAuthorizationDetails", "iam", "get_account_authorization_details", {"MaxItems": 1}),
    ("config:DescribeConfigRules", "config", "describe_config_rules", {}),
)


def validate_account_input(account_id: str, role_arn: str, regions: list[str]) -> None:
    if not _ACCOUNT_ID.match(account_id):
        raise ToolError("account_id must be 12 digits")
    if not _ROLE_ARN.match(role_arn):
        raise ToolError("role_arn must be an IAM role ARN")
    if role_arn.split("::")[1].split(":")[0] != account_id:
        raise ToolError("role_arn account does not match account_id")
    for region in regions:
        if not _REGION.match(region):
            raise ToolError(f"invalid region {region!r}")


def assume_session(role_arn: str, external_id: str | None, region: str, session_name: str = "azzy") -> Any:
    """boto3 Session for the account (sync; call via to_thread). Credentials live only in memory."""
    import boto3  # noqa: PLC0415

    sts = boto3.client("sts", region_name=region)
    kwargs: dict[str, Any] = {"RoleArn": role_arn, "RoleSessionName": re.sub(r"[^\w+=,.@-]", "-", session_name)[:64], "DurationSeconds": 900}
    if external_id:
        kwargs["ExternalId"] = external_id
    creds = sts.assume_role(**kwargs)["Credentials"]
    return boto3.Session(aws_access_key_id=creds["AccessKeyId"], aws_secret_access_key=creds["SecretAccessKey"], aws_session_token=creds["SessionToken"], region_name=region)


def verify_account_sync(role_arn: str, external_id: str | None, scope: str, region: str) -> tuple[str, list[dict[str, Any]], str | None]:
    """Real verification: AssumeRole + permission probes per scope. Returns (status, permissions, error)."""
    permissions: list[dict[str, Any]] = []
    try:
        session = assume_session(role_arn, external_id, region, "azzy-verify")
        permissions.append({"name": "sts:AssumeRole", "ok": True})
    except Exception as exc:  # noqa: BLE001
        return "failed", [{"name": "sts:AssumeRole", "ok": False}], f"{type(exc).__name__}: {str(exc)[:300]}"
    probes = list(READONLY_PROBES)
    if scope in {"audit", "deploy"}:
        probes += list(AUDIT_PROBES) if scope == "audit" else []
    for name, service, method, kwargs in probes:
        try:
            client = session.client(service, region_name="us-east-1" if service == "ce" else region)
            if method == "get_cost_and_usage":
                today = datetime.now(UTC).date()
                kwargs = {"TimePeriod": {"Start": today.replace(day=1).isoformat(), "End": today.isoformat() if today.day > 1 else (today.replace(day=2)).isoformat()}, "Granularity": "MONTHLY", "Metrics": ["UnblendedCost"]}
            getattr(client, method)(**kwargs)
            permissions.append({"name": name, "ok": True})
        except Exception as exc:  # noqa: BLE001
            code = getattr(getattr(exc, "response", {}), "get", lambda *_: None)("Error", {}) or {}
            permissions.append({"name": name, "ok": False, "error": str(code.get("Code") or type(exc).__name__)[:80]})
    if scope == "deploy":
        try:
            iam = session.client("iam")
            arn = session.client("sts").get_caller_identity()["Arn"]
            role_arn_for_sim = re.sub(r":sts::(\d+):assumed-role/([^/]+)/.*", r":iam::\1:role/\2", arn)
            result = iam.simulate_principal_policy(PolicySourceArn=role_arn_for_sim, ActionNames=["ecs:UpdateService"])
            ok = all(r["EvalDecision"] == "allowed" for r in result["EvaluationResults"])
            permissions.append({"name": "ecs:UpdateService (simulated)", "ok": ok})
        except Exception as exc:  # noqa: BLE001
            permissions.append({"name": "ecs:UpdateService (simulated)", "ok": False, "error": type(exc).__name__})
    failed = [p for p in permissions if not p["ok"]]
    status = "verified" if not failed else "failed"
    error = None if not failed else "missing permissions: " + ", ".join(p["name"] for p in failed)
    return status, permissions, error


def inventory_sync(role_arn: str, external_id: str | None, account_id: str, region: str) -> dict[str, Any]:
    """Read-only inventory via boto3 (describe/list calls only)."""
    session = assume_session(role_arn, external_id, region, "azzy-inventory")
    resources: dict[str, list[dict[str, Any]]] = {k: [] for k in ("ec2", "ecs", "eks", "lambda", "s3", "rds", "cloudfront", "waf", "route53")}
    errors: dict[str, str] = {}

    def attempt(key: str, fn: Any) -> None:
        try:
            resources[key] = fn()
        except Exception as exc:  # noqa: BLE001
            errors[key] = type(exc).__name__

    attempt("ec2", lambda: [
        {"id": i["InstanceId"], "name": next((t["Value"] for t in i.get("Tags", []) if t["Key"] == "Name"), None), "type": i["InstanceType"], "state": i["State"]["Name"], "az": i["Placement"]["AvailabilityZone"]}
        for r in session.client("ec2").describe_instances(MaxResults=100)["Reservations"] for i in r["Instances"]
    ])

    def ecs_services() -> list[dict[str, Any]]:
        ecs = session.client("ecs")
        out = []
        for cluster in ecs.list_clusters(maxResults=20)["clusterArns"]:
            services = ecs.list_services(cluster=cluster, maxResults=50)["serviceArns"]
            if not services:
                continue
            for svc in ecs.describe_services(cluster=cluster, services=services[:10])["services"]:
                out.append({"cluster": cluster.split("/")[-1], "service": svc["serviceName"], "task_definition": svc["taskDefinition"].split("/")[-1], "desired": svc["desiredCount"], "running": svc["runningCount"], "launch_type": svc.get("launchType")})
        return out

    attempt("ecs", ecs_services)
    attempt("eks", lambda: [{"name": n, **{k: v for k, v in session.client("eks").describe_cluster(name=n)["cluster"].items() if k in ("version", "status")}} for n in session.client("eks").list_clusters(maxResults=20)["clusters"]])
    attempt("lambda", lambda: [{"name": f["FunctionName"], "runtime": f.get("Runtime"), "memory_mb": f["MemorySize"], "last_modified": f["LastModified"]} for f in session.client("lambda").list_functions(MaxItems=50)["Functions"]])
    attempt("s3", lambda: [{"name": b["Name"], "created": b["CreationDate"].isoformat()} for b in session.client("s3").list_buckets()["Buckets"]])
    attempt("rds", lambda: [{"id": d["DBInstanceIdentifier"], "engine": f"{d['Engine']} {d['EngineVersion']}", "class": d["DBInstanceClass"], "status": d["DBInstanceStatus"], "multi_az": d["MultiAZ"], "storage_gb": d["AllocatedStorage"]} for d in session.client("rds").describe_db_instances()["DBInstances"]])
    attempt("cloudfront", lambda: [{"id": d["Id"], "domain": d["DomainName"], "aliases": d["Aliases"].get("Items", []), "status": d["Status"], "waf": bool(d.get("WebACLId"))} for d in session.client("cloudfront").list_distributions().get("DistributionList", {}).get("Items", [])])
    attempt("waf", lambda: [{"name": a["Name"], "scope": "REGIONAL", "id": a["Id"]} for a in session.client("wafv2").list_web_acls(Scope="REGIONAL")["WebACLs"]])
    attempt("route53", lambda: [{"zone": z["Name"], "records": z["ResourceRecordSetCount"], "private": z["Config"]["PrivateZone"]} for z in session.client("route53").list_hosted_zones(MaxItems="50")["HostedZones"]])
    return {"account_id": account_id, "region": region, "generated_at": datetime.now(UTC).isoformat(), "demo": False, "resources": resources, "errors": errors}


def iam_review_sync(role_arn: str, external_id: str | None, account_id: str, region: str) -> dict[str, Any]:
    session = assume_session(role_arn, external_id, region, "azzy-iam-review")
    iam = session.client("iam")
    findings: list[dict[str, Any]] = []
    summary = iam.get_account_summary()["SummaryMap"]
    if summary.get("AccountAccessKeysPresent"):
        findings.append({"severity": "high", "resource": "root", "finding": "root account has access keys", "fix": "delete root access keys"})
    if not summary.get("AccountMFAEnabled"):
        findings.append({"severity": "high", "resource": "root", "finding": "root MFA not enabled", "fix": "enable hardware MFA on root"})
    users = iam.list_users(MaxItems=200)["Users"]
    for user in users:
        for key in iam.list_access_keys(UserName=user["UserName"])["AccessKeyMetadata"]:
            age = (datetime.now(UTC) - key["CreateDate"]).days
            if key["Status"] == "Active" and age > 90:
                findings.append({"severity": "high" if age > 180 else "medium", "resource": f"user/{user['UserName']}", "finding": f"access key older than {age} days", "fix": "rotate the key or move to roles"})
    try:
        policy = iam.get_account_password_policy()["PasswordPolicy"]
        if policy.get("MinimumPasswordLength", 0) < 14:
            findings.append({"severity": "low", "resource": "account", "finding": f"password policy allows {policy.get('MinimumPasswordLength')} chars", "fix": "raise to 14 + MFA enforced"})
    except Exception:  # noqa: BLE001
        findings.append({"severity": "medium", "resource": "account", "finding": "no password policy set", "fix": "set a password policy"})
    return {"tool": "iam.review", "account_id": account_id, "roles": summary.get("Roles"), "users": len(users), "mfa_enforced": bool(summary.get("AccountMFAEnabled")), "root_access_keys": int(summary.get("AccountAccessKeysPresent", 0)), "findings": findings, "demo": False}


# ---- tools ---------------------------------------------------------------------------------------


async def _account_row(ctx: ToolContext, args: dict[str, Any]) -> dict[str, Any]:
    from azzy.db.engine import session_scope  # noqa: PLC0415
    from azzy.db.repo import account_to_model, get_account, get_account_by_aws_id, get_environment  # noqa: PLC0415

    wanted = str(args.get("account_id") or "")
    async with session_scope() as session:
        row = None
        if wanted:
            row = await get_account_by_aws_id(session, wanted) if _ACCOUNT_ID.match(wanted) else await get_account(session, wanted)
        elif ctx.env and ctx.env.get("account_id"):
            row = await get_account(session, str(ctx.env["account_id"]))
        elif ctx.env and ctx.env.get("id"):
            env = await get_environment(session, str(ctx.env["id"]))
            row = await get_account(session, env.account_id) if env and env.account_id else None
        if row is None:
            raise ToolError("no verified AWS account for this call; pass account_id or link the environment to an account")
        if row.status != "verified":
            raise ToolError(f"account {row.account_id} is {row.status}; verify it first")
        model = account_to_model(row).model_dump()
        model["_external_id"] = row.external_id_enc
        return model


def _decrypt_external_id(enc: str | None) -> str | None:
    if not enc:
        return None
    from azzy.crypto import decrypt  # noqa: PLC0415

    return decrypt(enc)


async def aws_accounts(ctx: ToolContext, args: dict[str, Any]) -> str:
    from azzy.db.engine import session_scope  # noqa: PLC0415
    from azzy.db.repo import account_to_model, list_accounts  # noqa: PLC0415

    async with session_scope() as session:
        rows = [account_to_model(r).model_dump() for r in await list_accounts(session)]
    return json.dumps(rows, indent=2, default=str)


async def aws_inventory(ctx: ToolContext, args: dict[str, Any]) -> str:
    account = await _account_row(ctx, args)
    region = str(args.get("region") or (account["regions"] or ["ap-south-1"])[0])
    if not _REGION.match(region):
        raise ToolError("invalid region")
    if ctx.demo or account.get("demo"):
        from azzy.tools.demo_data import demo_inventory  # noqa: PLC0415

        inv = demo_inventory(account["account_id"], region, seed=ctx.task_id or "inventory")
        inv["counts"] = {k: len(v) for k, v in inv["resources"].items()}
        return json.dumps(inv, indent=2)
    try:
        import boto3  # noqa: F401, PLC0415
    except ImportError as exc:  # pragma: no cover
        raise NotConfigured("boto3") from exc
    result = await asyncio.to_thread(inventory_sync, account["role_arn"], _decrypt_external_id(account.get("_external_id")), account["account_id"], region)
    return json.dumps(result, indent=2, default=str)


async def iam_review(ctx: ToolContext, args: dict[str, Any]) -> str:
    account = await _account_row(ctx, args)
    if account["scope"] not in {"audit", "deploy"}:
        raise ToolError(f"account {account['account_id']} has scope {account['scope']}; iam.review needs audit")
    region = (account["regions"] or ["ap-south-1"])[0]
    if ctx.demo or account.get("demo"):
        from azzy.tools.demo_data import demo_output  # noqa: PLC0415

        return demo_output("iam.review", {"account_id": account["account_id"]}, ctx.task_id or "iam")
    result = await asyncio.to_thread(iam_review_sync, account["role_arn"], _decrypt_external_id(account.get("_external_id")), account["account_id"], region)
    return json.dumps(result, indent=2, default=str)


SPECS: list[ToolSpec] = [
    ToolSpec("aws.accounts", "List the onboarded AWS accounts (name, account id, scope, stage, status). No secrets.", "low", schema({}), aws_accounts, demo_passthrough=True),
    ToolSpec("aws.inventory", "Read-only resource inventory (EC2, ECS, EKS, Lambda, S3, RDS, CloudFront, WAF, Route 53) for an account/region.", "low",
             schema({"account_id": str_prop("12-digit AWS account id (defaults to the task environment's account)"), "region": str_prop("AWS region")}), aws_inventory, demo_passthrough=True),
    ToolSpec("iam.review", "IAM posture review of an account (needs scope audit): root keys, MFA, stale access keys, password policy.", "low",
             schema({"account_id": str_prop("12-digit AWS account id")}), iam_review, demo_passthrough=True),
]
