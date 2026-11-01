"""sql.read: read-only SELECT against DATABASE_RO_URL (a read-only role), statement timeout, row cap."""

from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from azzy.tools.base import NotConfigured, ToolContext, ToolError, ToolSpec, int_prop, schema, str_prop

_FORBIDDEN = re.compile(r"(?i)\b(into|insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|vacuum|call|do|merge|lock|comment|set|reset|listen|notify)\b")
_LEADING = re.compile(r"(?is)^\s*(with\b.*?\bselect|select|explain\s+(analyze\s+)?select)\b")
MAX_ROWS = 500


def validate_query(query: str) -> str:
    q = (query or "").strip().rstrip(";").strip()
    if not q:
        raise ToolError("query is required")
    if ";" in q:
        raise ToolError("only a single statement is allowed")
    if "--" in q or "/*" in q:
        raise ToolError("comments are not allowed")
    if not _LEADING.match(q):
        raise ToolError("only SELECT (optionally WITH/EXPLAIN) statements are allowed")
    if _FORBIDDEN.search(q):
        raise ToolError("statement contains a non-read-only keyword")
    return q


async def sql_read(ctx: ToolContext, args: dict[str, Any]) -> str:
    query = validate_query(str(args.get("query") or ""))
    limit = max(1, min(int(args.get("limit") or 100), MAX_ROWS))
    dsn = getattr(ctx.settings, "DATABASE_RO_URL", None)
    if not dsn:
        raise NotConfigured("read-only SQL", "set DATABASE_RO_URL to a read-only role DSN")
    engine = create_async_engine(dsn, pool_pre_ping=True, connect_args={"server_settings": {"default_transaction_read_only": "on", "statement_timeout": "15000"}})
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SET TRANSACTION READ ONLY"))
            result = await conn.execute(text(f"SELECT * FROM ({query}) AS azzy_q LIMIT :lim"), {"lim": limit})
            columns = list(result.keys())
            rows = [dict(zip(columns, row, strict=True)) for row in result.fetchall()]
    finally:
        await engine.dispose()
    return json.dumps({"query": query[:500], "columns": columns, "rows": rows, "row_count": len(rows), "read_only": True}, indent=2, default=str)


SPECS: list[ToolSpec] = [
    ToolSpec("sql.read", "Run a read-only SELECT against the analytics replica (row-capped, 15 s timeout).", "low",
             schema({"dsn": str_prop("Logical DSN name (informational)"), "query": str_prop("A single SELECT statement"), "limit": int_prop("Max rows (≤500)")}, ["query"]), sql_read),
]
