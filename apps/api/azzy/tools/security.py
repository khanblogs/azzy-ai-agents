"""semgrep / gitleaks / trivy / checkov / nuclei via subprocess when the binary exists.

nuclei refuses any target not listed in AUTHORIZED_TARGETS. That check is enforced by the
executor in DEMO mode as well (see registry.py), so a demo can never "scan" a stranger.
"""

from __future__ import annotations

import asyncio
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from azzy.tools.base import NotConfigured, ToolContext, ToolError, ToolSpec, schema, str_prop

SCAN_TIMEOUT = 900
_REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.*-]+$")
_IMAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*(:[A-Za-z0-9._-]+)?$")
_SAFE_PATH = re.compile(r"^[A-Za-z0-9_./-]+$")


def authorized_target(target: str, allowed: tuple[str, ...]) -> str:
    """Normalise and check a nuclei target against AUTHORIZED_TARGETS (scheme+host[:port] match)."""
    target = (target or "").strip().rstrip("/")
    if not target:
        raise ToolError("target is required")
    parsed = urlparse(target if "://" in target else f"https://{target}")
    if not parsed.hostname:
        raise ToolError(f"invalid target {target!r}")
    origin = f"{parsed.scheme}://{parsed.netloc}".lower()
    normalised_allowed: set[str] = set()
    for item in allowed:
        p = urlparse(item if "://" in item else f"https://{item}")
        if p.netloc:
            normalised_allowed.add(f"{p.scheme}://{p.netloc}".lower())
            normalised_allowed.add(p.netloc.lower())
    if origin in normalised_allowed or parsed.netloc.lower() in normalised_allowed:
        return origin + (parsed.path if parsed.path not in ("", "/") else "")
    raise ToolError(f"target {origin} is not in AUTHORIZED_TARGETS — refusing to scan")


async def _run(argv: list[str], *, cwd: str | None = None, timeout: int = SCAN_TIMEOUT) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(*argv, cwd=cwd, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except TimeoutError:
        proc.kill()
        raise ToolError(f"{argv[0]} timed out after {timeout}s") from None
    text = out.decode(errors="replace")
    return int(proc.returncode or 0), text[-20_000:]


def _binary(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise NotConfigured(name, f"install {name} in the api/worker image")
    return path


async def _checkout(repo: str, ref: str | None = None) -> tuple[tempfile.TemporaryDirectory[str], str]:
    if not _REPO.match(repo) or "*" in repo:
        raise ToolError("repo must be a single owner/name")
    git = _binary("git")
    tmp = tempfile.TemporaryDirectory(prefix="azzy-scan-")
    argv = [git, "clone", "--depth", "50", "--quiet", f"https://github.com/{repo}.git", tmp.name]
    code, out = await _run(argv, timeout=300)
    if code != 0:
        tmp.cleanup()
        raise ToolError(f"git clone failed: {out[-500:]}")
    if ref:
        await _run([git, "-C", tmp.name, "checkout", "--quiet", ref], timeout=60)
    return tmp, tmp.name


async def semgrep_scan(ctx: ToolContext, args: dict[str, Any]) -> str:
    binary = _binary("semgrep")
    ruleset = str(args.get("ruleset") or "p/ci")
    if not re.match(r"^[A-Za-z0-9_./-]+$", ruleset):
        raise ToolError("invalid ruleset")
    tmp, path = await _checkout(str(args.get("repo") or ""), args.get("ref"))
    try:
        code, out = await _run([binary, "scan", "--config", ruleset, "--json", "--quiet", "--timeout", "120", path], cwd=path)
    finally:
        tmp.cleanup()
    return f"semgrep exit={code}\n{out}"


async def gitleaks_scan(ctx: ToolContext, args: dict[str, Any]) -> str:
    binary = _binary("gitleaks")
    tmp, path = await _checkout(str(args.get("repo") or ""))
    try:
        code, out = await _run([binary, "detect", "--source", path, "--no-banner", "--redact", "--report-format", "json", "--report-path", "/dev/stdout"])
    finally:
        tmp.cleanup()
    verdict = "PASS" if code == 0 else "LEAKS FOUND"
    return f"gitleaks verdict={verdict} exit={code}\n{out}"


async def trivy_scan(ctx: ToolContext, args: dict[str, Any]) -> str:
    binary = _binary("trivy")
    image = str(args.get("image") or "")
    if not _IMAGE.match(image):
        raise ToolError("invalid image reference")
    code, out = await _run([binary, "image", "--quiet", "--format", "json", "--severity", "MEDIUM,HIGH,CRITICAL", "--timeout", "10m", image])
    return f"trivy exit={code}\n{out}"


async def checkov_scan(ctx: ToolContext, args: dict[str, Any]) -> str:
    binary = _binary("checkov")
    repo = args.get("repo")
    sub = str(args.get("path") or ".")
    if not _SAFE_PATH.match(sub) or ".." in sub:
        raise ToolError("invalid path")
    if repo:
        tmp, root = await _checkout(str(repo))
        target = str(Path(root) / sub)
    else:
        tmp, target = None, sub
        if not Path(target).exists():
            raise ToolError(f"path {target} does not exist; pass repo to scan a repository")
    try:
        code, out = await _run([binary, "-d", target, "--quiet", "--compact", "-o", "json"])
    finally:
        if tmp:
            tmp.cleanup()
    return f"checkov exit={code}\n{out}"


async def nuclei_scan(ctx: ToolContext, args: dict[str, Any]) -> str:
    target = authorized_target(str(args.get("target") or ""), tuple(getattr(ctx.settings, "authorized_targets", ())))
    binary = _binary("nuclei")
    severity = str(args.get("severity") or "medium,high,critical")
    if not re.match(r"^[a-z,]+$", severity):
        raise ToolError("invalid severity list")
    code, out = await _run([binary, "-u", target, "-severity", severity, "-silent", "-jsonl", "-rate-limit", "50", "-timeout", "10", "-no-color"])
    return f"nuclei target={target} exit={code}\n{out or '(no findings)'}"


async def zap_scan(ctx: ToolContext, args: dict[str, Any]) -> str:
    """OWASP ZAP baseline/full scan via the `zap-baseline.py` wrapper or the zap CLI if present."""
    target = authorized_target(str(args.get("target") or ""), tuple(getattr(ctx.settings, "authorized_targets", ())))
    mode = str(args.get("mode") or "baseline")
    if mode not in {"baseline", "full", "api"}:
        raise ToolError("mode must be baseline|full|api")
    binary = shutil.which("zap-baseline.py") or shutil.which("zap-full-scan.py") or shutil.which("zap.sh")
    if not binary:
        raise NotConfigured("zap", "install OWASP ZAP (zap-baseline.py) in the worker image")
    argv = [binary, "-t", target, "-J", "/dev/stdout", "-I", "-m", "5"] if binary.endswith(".py") else [binary, "-cmd", "-quickurl", target, "-quickprogress"]
    code, out = await _run(argv, timeout=1200)
    return f"zap mode={mode} target={target} exit={code}\n{out or '(no alerts)'}"


SPECS: list[ToolSpec] = [
    ToolSpec("zap.scan", "OWASP ZAP dynamic scan (baseline|full|api). Only AUTHORIZED_TARGETS are accepted.", "medium", schema({"target": str_prop("URL in AUTHORIZED_TARGETS"), "mode": str_prop("baseline|full|api")}, ["target"]), zap_scan),
    ToolSpec("semgrep.scan", "SAST scan of a repository with a semgrep ruleset.", "low", schema({"repo": str_prop("owner/name"), "ref": str_prop("Branch or sha"), "ruleset": str_prop("e.g. p/ci, p/owasp-top-ten")}, ["repo"]), semgrep_scan),
    ToolSpec("gitleaks.scan", "Secrets scan of a repository's history.", "low", schema({"repo": str_prop("owner/name")}, ["repo"]), gitleaks_scan),
    ToolSpec("trivy.scan", "Container image vulnerability scan.", "low", schema({"image": str_prop("Image reference")}, ["image"]), trivy_scan),
    ToolSpec("checkov.scan", "IaC misconfiguration scan (Terraform/CloudFormation/Docker).", "low", schema({"repo": str_prop("owner/name (optional)"), "path": str_prop("Directory to scan")}), checkov_scan),
    ToolSpec("nuclei.scan", "Dynamic scan with nuclei. Only AUTHORIZED_TARGETS are accepted.", "medium", schema({"target": str_prop("URL in AUTHORIZED_TARGETS"), "severity": str_prop("Comma list of severities")}, ["target"]), nuclei_scan),
]
