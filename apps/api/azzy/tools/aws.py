"""AWS tools via boto3: describe / deploy / rollback / cost / cloudwatch.logs.

Credentials: AssumeRole (+ExternalId) into the environment's target role, or access keys fetched
from Secrets Manager by `secret_ref` (JSON {"aws_access_key_id","aws_secret_access_key"}).
Nothing secret is stored in Postgres or logged.
"""

from __future__ import annotations

import asyncio
import json
import os
from datetime import UTC, datetime, timedelta
from typing import Any

from azzy.tools.base import NotConfigured, ToolContext, ToolError, ToolSpec, int_prop, schema, str_prop


def _boto3() -> Any:
    try:
        import boto3  # noqa: PLC0415

        return boto3
    except ImportError as exc:  # pragma: no cover
        raise NotConfigured("boto3") from exc


def _session_for(ctx: ToolContext) -> Any:
    """boto3 Session scoped to the environment's account (sync; call inside to_thread)."""
    boto3 = _boto3()
    env = ctx.env or {}
    region = env.get("region") or ctx.settings.AWS_REGION
    method = env.get("method")
    if method == "local_emulator":
        # Local AWS emulator (Floci): dummy credentials only; _client()
        # points every service client at the emulator endpoint.
        return boto3.Session(aws_access_key_id="test", aws_secret_access_key="test", region_name=region)
    base = boto3.Session(region_name=region)
    if method == "assume_role":
        sts = base.client("sts")
        kwargs: dict[str, Any] = {"RoleArn": env["target"], "RoleSessionName": f"azzy-{ctx.agent_id}"[:64], "DurationSeconds": 900}
        if env.get("external_id"):
            kwargs["ExternalId"] = env["external_id"]
        creds = sts.assume_role(**kwargs)["Credentials"]
        return boto3.Session(
            aws_access_key_id=creds["AccessKeyId"], aws_secret_access_key=creds["SecretAccessKey"],
            aws_session_token=creds["SessionToken"], region_name=region,
        )
    if method == "access_key":
        if not env.get("secret_ref"):
            raise NotConfigured("access_key environment", "secret_ref missing")
        secret = base.client("secretsmanager").get_secret_value(SecretId=env["secret_ref"])
        payload = json.loads(secret["SecretString"])
        return boto3.Session(
            aws_access_key_id=payload["aws_access_key_id"], aws_secret_access_key=payload["aws_secret_access_key"],
            region_name=payload.get("region", region),
        )
    # hq / tailscale envs use the instance role directly
    return base


def _client(ctx: ToolContext, session: Any, service: str, **kwargs: Any) -> Any:
    """session.client() that honours the local-emulator endpoint, if any."""
    if (ctx.env or {}).get("method") == "local_emulator":
        kwargs.setdefault("endpoint_url", os.environ.get("FLOCI_URL", "http://floci:4566"))
    return session.client(service, **kwargs)


def _cluster(args: dict[str, Any], ctx: ToolContext) -> str:
    return str(args.get("cluster") or (ctx.env or {}).get("cluster") or "app")


def _service(args: dict[str, Any]) -> str:
    return str(args.get("service_name") or args.get("ecs_service") or "api")


async def aws_describe(ctx: ToolContext, args: dict[str, Any]) -> str:
    service = str(args.get("service") or "ecs").lower()

    def work() -> str:
        session = _session_for(ctx)
        if service == "ecs":
            ecs = _client(ctx, session, "ecs")
            resp = ecs.describe_services(cluster=_cluster(args, ctx), services=[_service(args)])
            out = []
            for svc in resp.get("services", []):
                out.append({
                    "service": svc["serviceName"], "status": svc["status"], "task_definition": svc["taskDefinition"].split("/")[-1],
                    "desired": svc["desiredCount"], "running": svc["runningCount"], "pending": svc["pendingCount"],
                    "deployments": [{"status": d["status"], "rollout_state": d.get("rolloutState"), "running": d["runningCount"], "task_definition": d["taskDefinition"].split("/")[-1]} for d in svc.get("deployments", [])],
                })
            return json.dumps(out, indent=2, default=str)
        if service == "iam":
            iam = _client(ctx, session, "iam")
            roles = iam.list_roles(MaxItems=50)["Roles"]
            summary = iam.get_account_summary()["SummaryMap"]
            return json.dumps({"roles": [{"name": r["RoleName"], "created": r["CreateDate"]} for r in roles], "summary": {k: summary[k] for k in ("Users", "Roles", "MFADevices", "AccountMFAEnabled") if k in summary}}, indent=2, default=str)
        if service in {"rds", "db"}:
            rds = _client(ctx, session, "rds")
            dbs = rds.describe_db_instances()["DBInstances"]
            return json.dumps([{"id": d["DBInstanceIdentifier"], "engine": f"{d['Engine']} {d['EngineVersion']}", "class": d["DBInstanceClass"], "status": d["DBInstanceStatus"]} for d in dbs], indent=2, default=str)
        if service == "ec2":
            ec2 = _client(ctx, session, "ec2")
            reservations = ec2.describe_instances()["Reservations"]
            rows = [{"id": i["InstanceId"], "type": i["InstanceType"], "state": i["State"]["Name"], "name": next((t["Value"] for t in i.get("Tags", []) if t["Key"] == "Name"), None)} for r in reservations for i in r["Instances"]]
            return json.dumps(rows, indent=2, default=str)
        raise ToolError(f"unsupported service {service!r}; use ecs|iam|rds|ec2")

    return await asyncio.to_thread(work)


async def _ecs_update(ctx: ToolContext, args: dict[str, Any], *, rollback: bool) -> str:
    def work() -> str:
        session = _session_for(ctx)
        ecs = _client(ctx, session, "ecs")
        cluster, service = _cluster(args, ctx), _service(args)
        current = ecs.describe_services(cluster=cluster, services=[service])["services"][0]
        family = current["taskDefinition"].split("/")[-1].rsplit(":", 1)[0]
        if rollback:
            revisions = ecs.list_task_definitions(familyPrefix=family, sort="DESC", maxResults=5)["taskDefinitionArns"]
            if len(revisions) < 2:
                raise ToolError("no previous task definition to roll back to")
            target_td = revisions[1]
            version = str(args.get("to") or "previous")
        else:
            version = str(args.get("version") or "").strip()
            if not version:
                raise ToolError("version is required for aws.deploy")
            td = ecs.describe_task_definition(taskDefinition=current["taskDefinition"])["taskDefinition"]
            containers = td["containerDefinitions"]
            for container in containers:
                image = container["image"]
                container["image"] = image.rsplit(":", 1)[0] + ":" + version.lstrip("v") if ":" in image else image + ":" + version.lstrip("v")
            keep = {k: td[k] for k in ("family", "taskRoleArn", "executionRoleArn", "networkMode", "containerDefinitions", "volumes", "placementConstraints", "requiresCompatibilities", "cpu", "memory", "runtimePlatform") if k in td}
            target_td = ecs.register_task_definition(**keep)["taskDefinition"]["taskDefinitionArn"]
        ecs.update_service(cluster=cluster, service=service, taskDefinition=target_td, forceNewDeployment=True)
        waiter = ecs.get_waiter("services_stable")
        waiter.wait(cluster=cluster, services=[service], WaiterConfig={"Delay": 10, "MaxAttempts": 30})
        after = ecs.describe_services(cluster=cluster, services=[service])["services"][0]
        return json.dumps({
            "action": "rollback" if rollback else "deploy", "cluster": cluster, "service": service, "version": version,
            "task_definition": target_td.split("/")[-1], "running": after["runningCount"], "desired": after["desiredCount"],
            "rollout_state": after["deployments"][0].get("rolloutState"), "result": "ok",
        }, indent=2)

    return await asyncio.to_thread(work)


async def aws_deploy(ctx: ToolContext, args: dict[str, Any]) -> str:
    return await _ecs_update(ctx, args, rollback=False)


async def aws_rollback(ctx: ToolContext, args: dict[str, Any]) -> str:
    return await _ecs_update(ctx, args, rollback=True)


async def aws_cost(ctx: ToolContext, args: dict[str, Any]) -> str:
    days = max(1, min(int(args.get("days") or 7), 90))

    def work() -> str:
        session = _session_for(ctx)
        ce = _client(ctx, session, "ce", region_name="us-east-1")  # Cost Explorer is global
        end = datetime.now(UTC).date()
        start = end - timedelta(days=days)
        resp = ce.get_cost_and_usage(
            TimePeriod={"Start": start.isoformat(), "End": end.isoformat()}, Granularity="DAILY",
            Metrics=["UnblendedCost"], GroupBy=[{"Type": "DIMENSION", "Key": "SERVICE"}],
        )
        by_service: dict[str, float] = {}
        for day in resp.get("ResultsByTime", []):
            for group in day.get("Groups", []):
                by_service[group["Keys"][0]] = by_service.get(group["Keys"][0], 0.0) + float(group["Metrics"]["UnblendedCost"]["Amount"])
        rows = sorted(({"service": k, "usd": round(v, 2)} for k, v in by_service.items()), key=lambda r: -r["usd"])
        return json.dumps({"period_days": days, "currency": "USD", "total": round(sum(by_service.values()), 2), "by_service": rows[:15]}, indent=2)

    return await asyncio.to_thread(work)


async def cloudwatch_logs(ctx: ToolContext, args: dict[str, Any]) -> str:
    group = str(args.get("log_group") or "/ecs/api")
    minutes = max(1, min(int(args.get("minutes") or 30), 24 * 60))
    pattern = str(args.get("filter") or "")
    limit = max(1, min(int(args.get("limit") or 200), 1000))

    def work() -> str:
        logs = _client(ctx, _session_for(ctx), "logs")
        start_ms = int((datetime.now(UTC) - timedelta(minutes=minutes)).timestamp() * 1000)
        kwargs: dict[str, Any] = {"logGroupName": group, "startTime": start_ms, "limit": limit, "interleaved": True}
        if pattern:
            kwargs["filterPattern"] = pattern
        resp = logs.filter_log_events(**kwargs)
        lines = [f"{datetime.fromtimestamp(e['timestamp'] / 1000, UTC).strftime('%Y-%m-%dT%H:%M:%SZ')} {e['message'].rstrip()}" for e in resp.get("events", [])]
        header = f"log group {group}, last {minutes} min" + (f", filter={pattern!r}" if pattern else "") + f", {len(lines)} events"
        return "\n".join([header, *lines])

    return await asyncio.to_thread(work)


ENV_PROP = str_prop("Environment id from env.registry")

SPECS: list[ToolSpec] = [
    ToolSpec("aws.describe", "Describe ECS services, IAM summary, RDS or EC2 in an environment's account.", "low",
             schema({"env_id": ENV_PROP, "service": str_prop("ecs|iam|rds|ec2", ["ecs", "iam", "rds", "ec2"]), "cluster": str_prop("ECS cluster name")}), aws_describe),
    ToolSpec("aws.deploy", "Deploy a version by registering a new ECS task definition and updating the service.", "medium",
             schema({"env_id": ENV_PROP, "version": str_prop("Image tag / version, e.g. v2.3.0"), "service": str_prop("ECS service name"), "cluster": str_prop("ECS cluster")}, ["version"]), aws_deploy),
    ToolSpec("aws.rollback", "Roll an ECS service back to the previous task definition revision.", "medium",
             schema({"env_id": ENV_PROP, "service": str_prop("ECS service name"), "to": str_prop("'previous' or a version label")}), aws_rollback),
    ToolSpec("aws.cost", "Cost Explorer spend grouped by service for the last N days.", "low",
             schema({"env_id": ENV_PROP, "days": int_prop("Window in days (1-90)")}), aws_cost),
    ToolSpec("cloudwatch.logs", "Filter CloudWatch log events from a log group over the last N minutes.", "low",
             schema({"env_id": ENV_PROP, "log_group": str_prop("Log group name"), "minutes": int_prop("Window in minutes"), "filter": str_prop("CloudWatch filter pattern")}), cloudwatch_logs),
]
