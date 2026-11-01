"""memory.write: durable per-agent memory in Postgres (+pgvector embedding). Real in DEMO too."""

from __future__ import annotations

import json
from typing import Any

from azzy.tools.base import ToolContext, ToolError, ToolSpec, schema, str_prop

KINDS = ("fact", "lesson", "skill_proposal")


async def embed(text: str, demo: bool) -> list[float] | None:
    """Deterministic hash embedding in DEMO; Bedrock Titan v2 (384 dims) otherwise, best effort."""
    from azzy.db.repo import demo_embedding  # noqa: PLC0415

    if demo:
        return demo_embedding(text)
    try:
        import asyncio  # noqa: PLC0415

        import boto3  # noqa: PLC0415

        def work() -> list[float]:
            client = boto3.client("bedrock-runtime")
            resp = client.invoke_model(modelId="amazon.titan-embed-text-v2:0", body=json.dumps({"inputText": text[:8000], "dimensions": 384, "normalize": True}))
            return list(json.loads(resp["body"].read())["embedding"])

        return await asyncio.to_thread(work)
    except Exception:  # noqa: BLE001 - embedding is optional; memory text is still stored
        return None


async def memory_write(ctx: ToolContext, args: dict[str, Any]) -> str:
    from azzy.db.engine import session_scope  # noqa: PLC0415
    from azzy.db.repo import add_memory  # noqa: PLC0415

    text = str(args.get("text") or "").strip()
    if len(text) < 8:
        raise ToolError("memory text is too short")
    kind = str(args.get("kind") or "fact")
    if kind not in KINDS:
        raise ToolError(f"kind must be one of {KINDS}")
    vector = await embed(text, ctx.demo)
    async with session_scope() as session:
        row = await add_memory(session, agent=ctx.agent_id, task_id=ctx.task_id, kind=kind, text=text, embedding=vector)
        memory_id = row.id
    ctx.extra.setdefault("memories", []).append({"id": memory_id, "kind": kind, "text": text})
    return json.dumps({"ok": True, "memory_id": memory_id, "kind": kind, "text": text[:200]}, indent=2)


SPECS: list[ToolSpec] = [
    ToolSpec("memory.write", "Store a durable memory (fact | lesson | skill_proposal) for this agent.", "low",
             schema({"kind": str_prop("fact|lesson|skill_proposal", list(KINDS)), "text": str_prop("One concise sentence")}, ["text"]), memory_write, demo_passthrough=True),
]
