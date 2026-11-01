"""playwright.run: executes an E2E suite from the repo's e2e/ folder against a base URL."""

from __future__ import annotations

import asyncio
import os
import re
import shutil
from pathlib import Path
from typing import Any

from azzy.tools.base import NotConfigured, ToolContext, ToolError, ToolSpec, schema, str_prop

_SUITE = re.compile(r"^[A-Za-z0-9_./-]{1,80}$")
_URL = re.compile(r"^https?://[A-Za-z0-9.-]+(:\d+)?(/.*)?$")
TIMEOUT = 900


def _e2e_dir() -> Path:
    env = os.environ.get("E2E_DIR")
    candidates = [Path(env)] if env else []
    candidates += [Path("/app/e2e"), Path(__file__).resolve().parents[4] / "e2e"]
    for candidate in candidates:
        if (candidate / "package.json").is_file():
            return candidate
    raise NotConfigured("Playwright e2e", "no e2e/ folder with package.json found (set E2E_DIR)")


async def playwright_run(ctx: ToolContext, args: dict[str, Any]) -> str:
    base_url = str(args.get("base_url") or "http://localhost:3000")
    if not _URL.match(base_url):
        raise ToolError("invalid base_url")
    suite = str(args.get("suite") or "")
    if suite and not _SUITE.match(suite):
        raise ToolError("invalid suite")
    npx = shutil.which("npx")
    if not npx:
        raise NotConfigured("Playwright", "node/npx not available in this image")
    e2e = _e2e_dir()
    argv = [npx, "playwright", "test", "--reporter=line"]
    if suite and suite not in {"e2e", "all", "smoke"}:
        argv.append(suite)
    elif suite == "smoke":
        argv += ["--grep", "@smoke"]
    env = {**os.environ, "BASE_URL": base_url, "CI": "1"}
    proc = await asyncio.create_subprocess_exec(*argv, cwd=str(e2e), env=env, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=TIMEOUT)
    except TimeoutError:
        proc.kill()
        raise ToolError("playwright timed out") from None
    text = out.decode(errors="replace")[-20_000:]
    return f"playwright suite={suite or 'all'} base_url={base_url} exit={proc.returncode}\n{text}"


SPECS: list[ToolSpec] = [
    ToolSpec("playwright.run", "Run the Playwright E2E suite (smoke|e2e|<file>) against a base URL.", "low",
             schema({"suite": str_prop("smoke | e2e | path to spec"), "base_url": str_prop("Target base URL")}), playwright_run),
]
