"""Mem0 long-term memory layer (additive and failure-isolated).

The native Postgres memories stay authoritative. When MEM0_ENABLED=1, every
memory the runner learns is ALSO written to Mem0 (which extracts and dedupes
facts with its own LLM pass), and recalls merge Mem0 semantic hits that the
native store missed. Every call is wrapped: any Mem0 failure degrades to
native-only behaviour and is logged, never raised.

Config comes from env: MEM0_ENABLED, DATABASE_URL (the mem0 database name is
swapped in), AWS_REGION + AWS keys for Bedrock. Embedder: Titan v2 via
Bedrock (1024-dim, its own `mem0` database - the native MiniLM corpus is
untouched). LLM: the same Claude Haiku 4.5 inference profile the agents use.
Telemetry is disabled (MEM0_TELEMETRY=false).
"""

from __future__ import annotations

import asyncio
import logging
import os
from urllib.parse import urlparse

log = logging.getLogger("azzy.memory_ext")

_client = None


def enabled() -> bool:
    return os.environ.get("MEM0_ENABLED", "0") == "1"


def _pg_config() -> dict:
    raw = os.environ.get("DATABASE_URL", "")
    parsed = urlparse(raw.replace("postgresql+asyncpg://", "postgresql://"))
    return {
        "dbname": os.environ.get("MEM0_DB", "mem0"),
        "host": parsed.hostname or "postgres",
        "port": parsed.port or 5432,
        "user": parsed.username or "azzy",
        "password": parsed.password or "",
    }


def _build():
    global _client
    if _client is not None:
        return _client
    os.environ["MEM0_TELEMETRY"] = "false"
    from mem0 import Memory  # noqa: PLC0415

    region = os.environ.get("AWS_REGION", "ap-south-2")
    creds = {
        "aws_region": region,
        "aws_access_key_id": os.environ.get("AWS_ACCESS_KEY_ID"),
        "aws_secret_access_key": os.environ.get("AWS_SECRET_ACCESS_KEY"),
    }
    config = {
        "llm": {
            "provider": "aws_bedrock",
            "config": {
                "model": os.environ.get("MEM0_LLM_MODEL", "in.anthropic.claude-haiku-4-5-20251001-v1:0"),
                **creds,
            },
        },
        "embedder": {
            "provider": "aws_bedrock",
            "config": {"model": "amazon.titan-embed-text-v2:0", **creds},
        },
        "vector_store": {
            "provider": "pgvector",
            "config": {**_pg_config(), "collection_name": "azzy_memories", "embedding_model_dims": 1024},
        },
    }
    _client = Memory.from_config(config)
    return _client


async def add_memory(agent_id: str, kind: str, text: str) -> None:
    """Mirror one learned memory into Mem0. Never raises."""
    if not enabled():
        return
    try:
        client = await asyncio.to_thread(_build)
        await asyncio.to_thread(
            client.add,
            [{"role": "user", "content": f"[{kind}] {text}"}],
            user_id=agent_id,
        )
    except Exception:  # noqa: BLE001
        log.warning("mem0 add failed; native memory only", exc_info=True)


async def search_memories(agent_id: str, query: str, limit: int = 3) -> list[str]:
    """Semantic search over Mem0 for one agent. Never raises."""
    if not enabled() or not query:
        return []
    try:
        client = await asyncio.to_thread(_build)
        res = await asyncio.to_thread(client.search, query, filters={"user_id": agent_id}, limit=limit)
        items = res.get("results") if isinstance(res, dict) else res
        out: list[str] = []
        for item in items or []:
            text = item.get("memory") if isinstance(item, dict) else None
            if text:
                out.append(str(text))
        return out
    except Exception:  # noqa: BLE001
        log.warning("mem0 search failed; native recall only", exc_info=True)
        return []
