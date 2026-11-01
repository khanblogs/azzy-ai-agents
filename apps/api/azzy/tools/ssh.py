"""ssh.safe_action: `ssh azzy-deploy@<tailscale-host> azzy-action <action> [version]`.

No shell on either side of the wire: argv is passed to asyncio.create_subprocess_exec and the
remote `azzy-action` wrapper (installed by infra/scripts on the target) only accepts the
allowlisted verbs with limited sudoers. Hostnames are validated as Tailscale IPs / MagicDNS names.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
from typing import Any

from azzy.policy import get_policy
from azzy.tools.base import ToolContext, ToolError, ToolSpec, schema, str_prop

SSH_USER = "azzy-deploy"
SSH_TIMEOUT_SECONDS = 180
_HOSTNAME = re.compile(r"^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)*$")
_VERSION = re.compile(r"^v?\d+\.\d+(\.\d+)?([-.][A-Za-z0-9]+)?$")


def validate_host(host: str) -> str:
    """Tailscale CGNAT IPv4 (100.64/10), Tailscale IPv6 (fd7a:115c:a1e0::/48) or a MagicDNS name."""
    host = (host or "").strip().lower()
    if not host:
        raise ToolError("host is required")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        if not _HOSTNAME.match(host) or len(host) > 253:
            raise ToolError(f"invalid host {host!r}") from None
        if not (host.endswith(".ts.net") or "." not in host):
            raise ToolError(f"host {host!r} is not a Tailscale MagicDNS name")
        return host
    if isinstance(address, ipaddress.IPv4Address):
        if address not in ipaddress.IPv4Network("100.64.0.0/10"):
            raise ToolError(f"host {host} is not a Tailscale address")
    elif address not in ipaddress.IPv6Network("fd7a:115c:a1e0::/48"):
        raise ToolError(f"host {host} is not a Tailscale address")
    return host


def validate_version(version: str | None) -> str | None:
    if version is None or version == "":
        return None
    version = str(version).strip()
    if not _VERSION.match(version):
        raise ToolError(f"invalid version {version!r}")
    return version


def build_argv(host: str, action: str, version: str | None) -> list[str]:
    argv = [
        "ssh",
        "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=10",
        "-o", "ServerAliveInterval=15",
        "-T",
        f"{SSH_USER}@{host}",
        "azzy-action",
        action,
    ]
    if version:
        argv.append(version)
    return argv


async def ssh_safe_action(ctx: ToolContext, args: dict[str, Any]) -> str:
    policy = get_policy()
    try:
        action = policy.validate_ssh_action(str(args.get("action") or ""))
    except ValueError as exc:
        raise ToolError(str(exc)) from exc
    env = ctx.env or {}
    host = validate_host(str(args.get("host") or env.get("target") or ""))
    version = validate_version(args.get("version")) if action in {"deploy", "rollback"} else None
    if action == "deploy" and not version:
        raise ToolError("deploy requires a version")
    argv = build_argv(host, action, version)
    try:
        proc = await asyncio.create_subprocess_exec(*argv, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=SSH_TIMEOUT_SECONDS)
    except FileNotFoundError as exc:
        raise ToolError("ssh binary not available in this container") from exc
    except TimeoutError as exc:
        raise ToolError(f"ssh {action} timed out after {SSH_TIMEOUT_SECONDS}s") from exc
    header = f"$ ssh {SSH_USER}@{host} azzy-action {action}" + (f" {version}" if version else "")
    body = stdout.decode(errors="replace").strip()
    err = stderr.decode(errors="replace").strip()
    result = "ok" if proc.returncode == 0 else f"exit={proc.returncode}"
    parts = [header, body]
    if err:
        parts.append("stderr: " + err[-2000:])
    parts.append(f"result: {result}")
    if proc.returncode != 0:
        raise ToolError("\n".join(parts))
    return "\n".join(parts)


SPECS: list[ToolSpec] = [
    ToolSpec(
        "ssh.safe_action",
        "Run one allowlisted action (status|restart|logs|deploy|rollback|disk|top) on a Tailscale host as azzy-deploy.",
        "medium",
        schema({
            "env_id": str_prop("Environment id"),
            "host": str_prop("Tailscale IP or MagicDNS name (defaults to the env target)"),
            "action": str_prop("Allowlisted action", ["status", "restart", "logs", "deploy", "rollback", "disk", "top"]),
            "version": str_prop("Version for deploy/rollback, e.g. v2.3.0"),
        }, ["action"]),
        ssh_safe_action,
    )
]
