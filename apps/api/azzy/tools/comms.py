"""gmail.draft / gmail.send / slack.post / gcal.schedule / zendesk.update.

Real mode uses: Gmail + Calendar REST APIs with an OAuth refresh-token credential JSON
(GMAIL_CREDENTIALS_JSON: {"client_id","client_secret","refresh_token"}), Slack incoming webhook,
Zendesk basic-auth token. Each returns a clear NotConfigured error when the integration is absent.
"""

from __future__ import annotations

import base64
import json
import os
import re
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from typing import Any

import httpx

from azzy.tools.base import NotConfigured, ToolContext, ToolError, ToolSpec, schema, str_prop

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"  # noqa: S105 - URL, not a secret


async def _google_token(scope: str) -> str:
    raw = os.environ.get("GMAIL_CREDENTIALS_JSON")
    if not raw:
        raise NotConfigured("Google Workspace", "set GMAIL_CREDENTIALS_JSON")
    try:
        creds = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ToolError("GMAIL_CREDENTIALS_JSON is not valid JSON") from exc
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data={
            "client_id": creds["client_id"], "client_secret": creds["client_secret"],
            "refresh_token": creds["refresh_token"], "grant_type": "refresh_token", "scope": scope,
        })
    if resp.status_code != 200:
        raise ToolError("Google token refresh failed")
    return str(resp.json()["access_token"])


def _mime(args: dict[str, Any]) -> str:
    to = str(args.get("to") or "")
    if not _EMAIL.match(to):
        raise ToolError("a valid `to` address is required")
    message = EmailMessage()
    message["To"] = to
    if args.get("cc"):
        message["Cc"] = str(args["cc"])
    message["Subject"] = str(args.get("subject") or "(no subject)")
    message.set_content(str(args.get("body") or ""))
    return base64.urlsafe_b64encode(message.as_bytes()).decode()


async def gmail_draft(ctx: ToolContext, args: dict[str, Any]) -> str:
    token = await _google_token("https://www.googleapis.com/auth/gmail.compose")
    async with httpx.AsyncClient(timeout=20, headers={"Authorization": f"Bearer {token}"}) as client:
        resp = await client.post("https://gmail.googleapis.com/gmail/v1/users/me/drafts", json={"message": {"raw": _mime(args)}})
    if resp.status_code not in (200, 201):
        raise ToolError(f"gmail draft failed: HTTP {resp.status_code}")
    data = resp.json()
    return json.dumps({"draft_id": data.get("id"), "to": args.get("to"), "subject": args.get("subject"), "status": "drafted", "sent": False}, indent=2)


async def gmail_send(ctx: ToolContext, args: dict[str, Any]) -> str:
    token = await _google_token("https://www.googleapis.com/auth/gmail.send")
    async with httpx.AsyncClient(timeout=20, headers={"Authorization": f"Bearer {token}"}) as client:
        if args.get("draft_id"):
            resp = await client.post("https://gmail.googleapis.com/gmail/v1/users/me/drafts/send", json={"id": args["draft_id"]})
        else:
            resp = await client.post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", json={"raw": _mime(args)})
    if resp.status_code not in (200, 201):
        raise ToolError(f"gmail send failed: HTTP {resp.status_code}")
    return json.dumps({"message_id": resp.json().get("id"), "to": args.get("to"), "status": "sent", "sent_at": datetime.now(UTC).isoformat()}, indent=2)


async def slack_post(ctx: ToolContext, args: dict[str, Any]) -> str:
    url = os.environ.get("SLACK_WEBHOOK_URL") or getattr(ctx.settings, "SLACK_WEBHOOK_URL", None)
    if not url:
        raise NotConfigured("Slack", "set SLACK_WEBHOOK_URL")
    text = str(args.get("text") or "").strip()
    if not text:
        raise ToolError("text is required")
    payload: dict[str, Any] = {"text": f"[{ctx.agent_id}] {text}"[:3000]}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, json=payload)
    if resp.status_code != 200:
        raise ToolError(f"slack webhook failed: HTTP {resp.status_code}")
    return json.dumps({"ok": True, "channel": args.get("channel", "(webhook default)"), "text": text[:200]}, indent=2)


def _parse_when(value: Any) -> datetime:
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
        except ValueError:
            pass
    return (datetime.now(UTC) + timedelta(days=1)).replace(hour=11, minute=0, second=0, microsecond=0)


async def gcal_schedule(ctx: ToolContext, args: dict[str, Any]) -> str:
    token = await _google_token("https://www.googleapis.com/auth/calendar.events")
    start = _parse_when(args.get("when"))
    end = start + timedelta(minutes=int(args.get("minutes") or 30))
    attendees = [{"email": a} for a in (args.get("attendees") or []) if isinstance(a, str) and _EMAIL.match(a)]
    body = {"summary": str(args.get("title") or "Meeting"), "description": str(args.get("description") or "Scheduled by AZZY AI AGENTS"), "start": {"dateTime": start.isoformat()}, "end": {"dateTime": end.isoformat()}, "attendees": attendees}
    async with httpx.AsyncClient(timeout=20, headers={"Authorization": f"Bearer {token}"}) as client:
        resp = await client.post("https://www.googleapis.com/calendar/v3/calendars/primary/events", json=body, params={"sendUpdates": "all"})
    if resp.status_code not in (200, 201):
        raise ToolError(f"calendar insert failed: HTTP {resp.status_code}")
    data = resp.json()
    return json.dumps({"event_id": data.get("id"), "title": body["summary"], "when": start.isoformat(), "link": data.get("htmlLink"), "status": data.get("status")}, indent=2)


async def zendesk_update(ctx: ToolContext, args: dict[str, Any]) -> str:
    subdomain, email, token = os.environ.get("ZENDESK_SUBDOMAIN"), os.environ.get("ZENDESK_EMAIL"), os.environ.get("ZENDESK_API_TOKEN")
    if not (subdomain and email and token):
        raise NotConfigured("Zendesk", "set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN")
    ticket_id = str(args.get("ticket_id") or "")
    if not ticket_id.isdigit():
        raise ToolError("ticket_id must be numeric")
    ticket: dict[str, Any] = {}
    if args.get("comment"):
        ticket["comment"] = {"body": str(args["comment"]), "public": bool(args.get("public", True))}
    if args.get("status"):
        ticket["status"] = str(args["status"])
    if not ticket:
        raise ToolError("provide a comment and/or status")
    async with httpx.AsyncClient(timeout=20, auth=(f"{email}/token", token)) as client:
        resp = await client.put(f"https://{subdomain}.zendesk.com/api/v2/tickets/{ticket_id}.json", json={"ticket": ticket})
    if resp.status_code != 200:
        raise ToolError(f"zendesk update failed: HTTP {resp.status_code}")
    data = resp.json().get("ticket", {})
    return json.dumps({"ticket_id": ticket_id, "status": data.get("status"), "updated_at": data.get("updated_at"), "public": ticket.get("comment", {}).get("public")}, indent=2)


SPECS: list[ToolSpec] = [
    ToolSpec("gmail.draft", "Create a Gmail draft (nothing is sent).", "low",
             schema({"to": str_prop("Recipient"), "cc": str_prop("CC"), "subject": str_prop("Subject"), "body": str_prop("Plain-text body")}, ["to", "subject", "body"]), gmail_draft),
    ToolSpec("gmail.send", "Send an email (or a previously created draft). Leaves the building → high risk.", "high",
             schema({"draft_id": str_prop("Draft to send"), "to": str_prop("Recipient"), "subject": str_prop("Subject"), "body": str_prop("Body")}), gmail_send),
    ToolSpec("slack.post", "Post a message to the configured Slack incoming webhook.", "low",
             schema({"channel": str_prop("Channel label (informational)"), "text": str_prop("Message text")}, ["text"]), slack_post),
    ToolSpec("gcal.schedule", "Create a Google Calendar event with attendees.", "medium",
             schema({"title": str_prop("Event title"), "when": str_prop("ISO datetime"), "minutes": str_prop("Duration in minutes"), "attendees": {"type": "array", "items": {"type": "string"}}}, ["title"]), gcal_schedule),
    ToolSpec("zendesk.update", "Update a Zendesk ticket (public comment and/or status). Customer-visible → high risk.", "high",
             schema({"ticket_id": str_prop("Ticket number"), "status": str_prop("new|open|pending|solved"), "comment": str_prop("Comment body"), "public": {"type": "boolean"}}, ["ticket_id"]), zendesk_update),
]
