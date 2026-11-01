"""sandbox.run: `docker run --rm --network none --memory 512m --cpus 1 <image> <cmd>` with a timeout."""

from __future__ import annotations

import asyncio
import re
import shlex
import tempfile
from pathlib import Path
from typing import Any

from azzy.tools.base import ToolContext, ToolError, ToolSpec, int_prop, schema, str_prop

ALLOWED_IMAGES = ("python:3.12-slim", "python:3.11-slim", "node:20-alpine", "node:22-alpine", "alpine:3.20", "ubuntu:24.04")
_IMAGE = re.compile(r"^[a-z0-9]+([._/-][a-z0-9]+)*(:[A-Za-z0-9._-]+)?$")
MAX_TIMEOUT = 600
MAX_OUTPUT = 20_000


def _image(value: Any) -> str:
    image = str(value or ALLOWED_IMAGES[0])
    if image not in ALLOWED_IMAGES and not _IMAGE.match(image):
        raise ToolError(f"invalid image {image!r}")
    return image


async def sandbox_run(ctx: ToolContext, args: dict[str, Any]) -> str:
    image = _image(args.get("image"))
    cmd = str(args.get("cmd") or "").strip()
    if not cmd:
        raise ToolError("cmd is required")
    timeout = max(5, min(int(args.get("timeout") or 120), MAX_TIMEOUT))
    files: dict[str, str] = dict(args.get("files") or {})
    with tempfile.TemporaryDirectory(prefix="azzy-sandbox-") as workdir:
        root = Path(workdir)
        for name, content in files.items():
            target = (root / name).resolve()
            if root.resolve() not in target.parents:
                raise ToolError(f"file path escapes workdir: {name}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(str(content), encoding="utf-8")
        argv = [
            "docker", "run", "--rm", "--network", "none", "--memory", "512m", "--memory-swap", "512m", "--cpus", "1",
            "--pids-limit", "256", "--read-only", "--tmpfs", "/tmp:rw,size=128m", "--security-opt", "no-new-privileges",
            "--cap-drop", "ALL", "--user", "65534:65534", "-v", f"{workdir}:/work:rw", "-w", "/work", image,
            *shlex.split(cmd),
        ]
        try:
            proc = await asyncio.create_subprocess_exec(*argv, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        except FileNotFoundError as exc:
            raise ToolError("docker CLI not available in this container (mount /var/run/docker.sock and install docker-cli)") from exc
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except TimeoutError:
            proc.kill()
            raise ToolError(f"sandbox timed out after {timeout}s") from None
    text = out.decode(errors="replace")
    if len(text) > MAX_OUTPUT:
        text = text[-MAX_OUTPUT:]
    return f"$ docker run --rm --network none --memory 512m --cpus 1 {image} {cmd}\n{text.rstrip()}\nexit={proc.returncode}"


SPECS: list[ToolSpec] = [
    ToolSpec("sandbox.run", "Run a command inside a network-less, resource-limited docker container.", "low",
             schema({"image": str_prop("Container image (python:3.12-slim default)"), "cmd": str_prop("Command to run"), "files": {"type": "object", "description": "filename → content written into /work"}, "timeout": int_prop("Seconds (max 600)")}, ["cmd"]), sandbox_run),
]
