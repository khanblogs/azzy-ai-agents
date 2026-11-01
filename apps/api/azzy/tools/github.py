"""github.read / github.branch_pr via the REST API (httpx). branch_pr refuses protected bases."""

from __future__ import annotations

import base64
import os
import re
from typing import Any

import httpx

from azzy.tools.base import NotConfigured, ToolContext, ToolError, ToolSpec, schema, str_prop

API = "https://api.github.com"
PROTECTED_BASES = frozenset({"main", "master", "prod", "production"})
_REPO = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
_REF = re.compile(r"^[A-Za-z0-9_./-]{1,200}$")


def _headers() -> dict[str, str]:
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise NotConfigured("GitHub", "set GITHUB_TOKEN")
    return {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "azzy-ai-agents"}


def _repo(args: dict[str, Any]) -> str:
    repo = str(args.get("repo") or "").strip()
    if not _REPO.match(repo):
        raise ToolError("repo must be owner/name")
    return repo


def _ref(value: Any, default: str) -> str:
    ref = str(value or default)
    if not _REF.match(ref):
        raise ToolError(f"invalid ref {ref!r}")
    return ref


async def github_read(ctx: ToolContext, args: dict[str, Any]) -> str:
    repo = _repo(args)
    path = str(args.get("path") or "").strip("/")
    ref = _ref(args.get("ref"), "HEAD")
    async with httpx.AsyncClient(timeout=30, headers=_headers()) as client:
        if args.get("pr"):
            number = int(args["pr"])
            pr = (await client.get(f"{API}/repos/{repo}/pulls/{number}")).raise_for_status().json()
            files = (await client.get(f"{API}/repos/{repo}/pulls/{number}/files", params={"per_page": 50})).raise_for_status().json()
            out = [f"PR #{number}: {pr['title']} ({pr['head']['ref']} → {pr['base']['ref']}) by {pr['user']['login']}", pr.get("body") or "", ""]
            for f in files:
                out.append(f"--- {f['filename']} (+{f['additions']} -{f['deletions']})")
                out.append(f.get("patch") or "[binary or too large]")
            return "\n".join(out)
        resp = await client.get(f"{API}/repos/{repo}/contents/{path}", params={"ref": ref})
        if resp.status_code == 404:
            raise ToolError(f"{repo}:{path}@{ref} not found")
        data = resp.raise_for_status().json()
        if isinstance(data, list):
            entries = [f"{'d' if e['type'] == 'dir' else '-'} {e['path']} ({e.get('size', 0)}b)" for e in data]
            return f"# {repo}@{ref}:{path or '/'}\n" + "\n".join(entries)
        if data.get("encoding") == "base64":
            content = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
        else:
            content = str(data.get("content", ""))
        return f"# {repo}@{ref}:{path}\n{content}"


async def github_branch_pr(ctx: ToolContext, args: dict[str, Any]) -> str:
    repo = _repo(args)
    base = _ref(args.get("base"), "develop")
    if base.lower() in PROTECTED_BASES:
        raise ToolError(f"refusing to open a PR against protected base {base!r}; target develop or a release branch")
    branch = _ref(args.get("branch"), f"azzy/{ctx.agent_id}-{(ctx.task_id or 'task')[:8]}")
    title = str(args.get("title") or "chore: azzy change")[:200]
    body = str(args.get("body") or f"Opened by AZZY AI AGENTS agent `{ctx.agent_id}` for task `{ctx.task_id}`.")
    files: dict[str, str] = dict(args.get("files") or {})
    async with httpx.AsyncClient(timeout=30, headers=_headers()) as client:
        base_ref = (await client.get(f"{API}/repos/{repo}/git/ref/heads/{base}")).raise_for_status().json()
        sha = base_ref["object"]["sha"]
        create = await client.post(f"{API}/repos/{repo}/git/refs", json={"ref": f"refs/heads/{branch}", "sha": sha})
        if create.status_code not in (201, 422):  # 422 = branch exists
            create.raise_for_status()
        for file_path, content in files.items():
            existing = await client.get(f"{API}/repos/{repo}/contents/{file_path}", params={"ref": branch})
            payload: dict[str, Any] = {"message": f"{title} ({file_path})", "content": base64.b64encode(content.encode()).decode(), "branch": branch}
            if existing.status_code == 200:
                payload["sha"] = existing.json()["sha"]
            (await client.put(f"{API}/repos/{repo}/contents/{file_path}", json=payload)).raise_for_status()
        pr = await client.post(f"{API}/repos/{repo}/pulls", json={"title": title, "head": branch, "base": base, "body": body, "draft": bool(args.get("draft", False))})
        if pr.status_code == 422:
            raise ToolError(f"could not open PR: {pr.json().get('errors', pr.text)[:300]}")
        data = pr.raise_for_status().json()
    return f"PR #{data['number']} opened: {data['html_url']} ({branch} → {base}, {len(files)} file(s))"


SPECS: list[ToolSpec] = [
    ToolSpec("github.read", "Read a file, directory listing or PR diff from a GitHub repository.", "low",
             schema({"repo": str_prop("owner/name"), "path": str_prop("File or directory path"), "ref": str_prop("Branch, tag or sha"), "pr": str_prop("PR number to read instead of a path")}, ["repo"]), github_read),
    ToolSpec("github.branch_pr", "Create a branch with file changes and open a pull request. Never targets main.", "medium",
             schema({"repo": str_prop("owner/name"), "base": str_prop("Base branch (not main)"), "branch": str_prop("New branch name"), "title": str_prop("PR title"), "body": str_prop("PR body"), "files": {"type": "object", "description": "path → full file content"}}, ["repo", "title"]), github_branch_pr),
]
