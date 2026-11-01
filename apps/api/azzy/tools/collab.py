"""agent.message and knowledge.search — collaboration + RAG tools (real in DEMO too)."""

from __future__ import annotations

import json
from typing import Any

from azzy.events import AGENT_IDS, AgentMessageEvent
from azzy.tools.base import ToolContext, ToolError, ToolSpec, schema, str_prop

MESSAGE_TYPES = ("handoff", "request", "result", "note", "escalation")


async def agent_message(ctx: ToolContext, args: dict[str, Any]) -> str:
    """Persist an agent-to-agent message, emit `agent.message`, count it against the task bounds."""
    from azzy.db.engine import session_scope  # noqa: PLC0415
    from azzy.db.repo import add_agent_message, agent_message_to_model  # noqa: PLC0415

    if not ctx.task_id:
        raise ToolError("agent.message needs a task context")
    to = args.get("to")
    to_agent = str(to) if to else None
    if to_agent is not None and to_agent not in AGENT_IDS:
        raise ToolError(f"unknown recipient {to_agent!r}")
    if to_agent == ctx.agent_id:
        raise ToolError("an agent cannot message itself")
    type_ = str(args.get("type") or "note")
    if type_ not in MESSAGE_TYPES:
        raise ToolError(f"type must be one of {MESSAGE_TYPES}")
    content = str(args.get("content") or "").strip()
    if not content:
        raise ToolError("content is required")
    artifacts = [a for a in (args.get("artifacts") or []) if isinstance(a, dict) and {"kind", "ref", "label"} <= set(a)]

    ledger = ctx.extra.get("ledger")
    if ledger is not None:
        ledger.record_message()  # raises BoundExceeded → surfaces as a tool error below
    async with session_scope() as session:
        row = await add_agent_message(session, task_id=ctx.task_id, from_agent=ctx.agent_id, to_agent=to_agent, type_=type_, content=content, artifacts=artifacts)
        model = agent_message_to_model(row)
    emit = ctx.extra.get("emit")
    if emit is not None:
        await emit(AgentMessageEvent(message=model))
    return json.dumps({"ok": True, "message_id": model.id, "to": to_agent, "type": type_, "content": content[:200]}, indent=2)


async def knowledge_search(ctx: ToolContext, args: dict[str, Any]) -> str:
    """Permission-aware RAG search: global + the task's env/account scopes."""
    from azzy.db.engine import session_scope  # noqa: PLC0415
    from azzy.db.repo import search_chunks  # noqa: PLC0415
    from azzy.embeddings import embed  # noqa: PLC0415

    query = str(args.get("q") or args.get("query") or "").strip()
    if not query:
        raise ToolError("q is required")
    scopes = {"global"}
    if ctx.env:
        scopes.add(str(ctx.env.get("id")))
        if ctx.env.get("account_id"):
            scopes.add(str(ctx.env["account_id"]))
    requested = args.get("scope")
    if requested and requested not in scopes:
        raise ToolError(f"scope {requested!r} is outside this task's permitted scopes")
    vector = await embed(query, demo=ctx.demo, model=getattr(ctx.settings, "EMBEDDINGS_MODEL", ""), region=getattr(ctx.settings, "AWS_REGION", "ap-south-1"))
    if vector is None:
        return json.dumps({"query": query, "hits": [], "note": "embeddings unavailable"}, indent=2)
    async with session_scope() as session:
        hits = await search_chunks(session, embedding=vector, scopes=scopes if not requested else {requested}, limit=int(args.get("limit") or 5))
    return json.dumps({"query": query, "scopes": sorted(scopes), "hits": hits, "demo": ctx.demo}, indent=2)


SPECS: list[ToolSpec] = [
    ToolSpec("agent.message", "Send a message to another agent on this task (handoff | request | result | note | escalation).", "low",
             schema({"to": str_prop("Recipient agent id (omit to broadcast)", list(AGENT_IDS)), "type": str_prop("Message type", list(MESSAGE_TYPES)), "content": str_prop("Message text"), "artifacts": {"type": "array", "description": "[{kind, ref, label}]"}}, ["content"]),
             agent_message, demo_passthrough=True),
    ToolSpec("knowledge.search", "Search the knowledge base (runbooks, docs) visible to this task.", "low",
             schema({"q": str_prop("Query"), "scope": str_prop("global | env id | account id"), "limit": {"type": "integer"}}, ["q"]), knowledge_search, demo_passthrough=True),
]
