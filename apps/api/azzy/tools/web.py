"""web.*: read-only web access for agents, powered by the Obscura headless browser.

The Obscura binary is bundled into the api image at build time (see
apps/api/Dockerfile, WITH_OBSCURA / OBSCURA_VERSION). Tools:

  web.fetch      render one page, return its readable markdown text
  web.scrape     render up to 5 pages in parallel, return combined markdown
  web.screenshot render one page, save a PNG under ARTIFACTS_DIR, return its path

URL policy is enforced here, before any fetch:
  * scheme must be http or https
  * loopback / private / link-local / reserved IP literals are refused, as are
    localhost and *.local / *.internal hostnames (Obscura itself also blocks
    private IPs at connect time; this layer is defence in depth and makes the
    refusal visible in the tool result instead of a network error)
  * if WEB_ALLOWED_DOMAINS is set (comma-separated domain suffixes), only those
    domains may be fetched — the same env-gating style as AUTHORIZED_TARGETS
    in security.py

Unlike most tools, the web tools run for real in DEMO mode
(ToolSpec.demo_passthrough): a "demo" web page would be fabricated data, which
is worse than no data. They are read-only, classified low-risk in policy.yaml,
and every output still passes the executor's guard scrub before it reaches
the LLM.
"""

from __future__ import annotations

import asyncio
import ipaddress
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from azzy.tools.base import NotConfigured, ToolContext, ToolError, ToolSpec, schema, str_prop

FETCH_TIMEOUT_S = 45  # obscura --timeout value
PROC_TIMEOUT_S = 75  # hard kill for the subprocess
MAX_FETCH_CHARS = 8_000
MAX_SCRAPE_URLS = 5
MAX_SCRAPE_CHARS_PER_PAGE = 6_000

_HOST_OK = re.compile(r"^[A-Za-z0-9.-]+$")


def _obscura_bin() -> str:
    path = shutil.which(os.environ.get("OBSCURA_BIN", "obscura"))
    if not path:
        raise NotConfigured("Obscura", "binary not in this image (build with WITH_OBSCURA=1)")
    return path


def _allowed_domains() -> list[str]:
    raw = os.environ.get("WEB_ALLOWED_DOMAINS", "")
    return [d.strip().lower().lstrip(".") for d in raw.split(",") if d.strip()]


def _check_url(url: str) -> str:
    """Validate `url` against the web URL policy; return it unchanged or raise ToolError."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ToolError(f"refused: only http/https URLs are allowed ({url!r})")
    host = (parsed.hostname or "").lower()
    if not host or not _HOST_OK.match(host):
        raise ToolError(f"refused: invalid host in URL ({url!r})")
    if host == "localhost" or host.endswith(".local") or host.endswith(".internal"):
        raise ToolError(f"refused: internal hostname {host} is not allowed")
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None and (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast):
        raise ToolError(f"refused: non-public IP {host} is not allowed")
    allowed = _allowed_domains()
    if allowed and not any(host == d or host.endswith("." + d) for d in allowed):
        raise ToolError(f"refused: {host} is not in WEB_ALLOWED_DOMAINS")
    return url


async def _run_obscura(argv: list[str]) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *argv,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=PROC_TIMEOUT_S)
    except TimeoutError:
        proc.kill()
        raise ToolError("obscura timed out") from None
    return proc.returncode or 0, out.decode(errors="replace"), err.decode(errors="replace")


async def _fetch_markdown(url: str) -> str:
    argv = [_obscura_bin(), "fetch", url, "--dump", "markdown", "--timeout", str(FETCH_TIMEOUT_S)]
    code, out, err = await _run_obscura(argv)
    if code != 0:
        raise ToolError(f"obscura fetch failed for {url}: {err.strip()[-500:]}")
    return out.strip()


async def web_fetch(ctx: ToolContext, args: dict[str, Any]) -> str:
    url = _check_url(str(args.get("url") or ""))
    text = await _fetch_markdown(url)
    if len(text) > MAX_FETCH_CHARS:
        text = text[:MAX_FETCH_CHARS] + "\n\n[truncated]"
    return f"web.fetch {url}\n\n{text}"


async def web_scrape(ctx: ToolContext, args: dict[str, Any]) -> str:
    raw = args.get("urls") or []
    if not isinstance(raw, list) or not raw:
        raise ToolError("urls must be a non-empty list")
    urls = [_check_url(str(u)) for u in raw[:MAX_SCRAPE_URLS]]

    async def one(u: str) -> str:
        try:
            text = await _fetch_markdown(u)
        except ToolError as exc:
            return f"## {u}\n\n[failed: {exc}]"
        if len(text) > MAX_SCRAPE_CHARS_PER_PAGE:
            text = text[:MAX_SCRAPE_CHARS_PER_PAGE] + "\n[truncated]"
        return f"## {u}\n\n{text}"

    pages = await asyncio.gather(*(one(u) for u in urls))
    return "web.scrape\n\n" + "\n\n".join(pages)


async def web_screenshot(ctx: ToolContext, args: dict[str, Any]) -> str:
    url = _check_url(str(args.get("url") or ""))
    host = urlparse(url).hostname or "page"
    slug = re.sub(r"[^A-Za-z0-9.-]+", "-", host)[:60]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    out_dir = Path(os.environ.get("ARTIFACTS_DIR", "/data/artifacts")) / "web-screenshots"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{slug}-{stamp}.png"
    argv = [_obscura_bin(), "fetch", url, "--timeout", str(FETCH_TIMEOUT_S), "-s", str(path)]
    code, _out, err = await _run_obscura(argv)
    if code != 0 or not path.is_file():
        raise ToolError(f"obscura screenshot failed for {url}: {err.strip()[-500:]}")
    return f"web.screenshot {url}\nsaved: {path} ({path.stat().st_size} bytes)"


SPECS: list[ToolSpec] = [
    ToolSpec(
        "web.fetch",
        "Fetch one web page with the Obscura headless browser and return its readable markdown text. Read-only; public http/https only.",
        "low",
        schema({"url": str_prop("Public http(s) URL to fetch")}, ["url"]),
        web_fetch,
        demo_passthrough=True,
    ),
    ToolSpec(
        "web.scrape",
        "Fetch up to 5 web pages in parallel with Obscura and return their combined markdown text. Read-only; public http/https only.",
        "low",
        schema(
            {
                "urls": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Public http(s) URLs to fetch (max 5)",
                }
            },
            ["urls"],
        ),
        web_scrape,
        demo_passthrough=True,
    ),
    ToolSpec(
        "web.screenshot",
        "Render one web page with Obscura and save a PNG screenshot to the artifacts directory; returns the saved path. Read-only; public http/https only.",
        "low",
        schema({"url": str_prop("Public http(s) URL to capture")}, ["url"]),
        web_screenshot,
        demo_passthrough=True,
    ),
]
