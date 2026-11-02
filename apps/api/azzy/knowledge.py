"""Knowledge base ingestion + permission-aware search (CONTRACT-v2 §8)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from azzy.config import Settings
from azzy.db import repo
from azzy.embeddings import chunk_text, embed
from azzy.rbac import visible_scopes

log = logging.getLogger("azzy.knowledge")

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
ALLOWED_SUFFIXES = {".md", ".txt", ".pdf"}


def extract_text(filename: str, data: bytes) -> str:
    suffix = Path(filename).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise ValueError("only .md, .txt and .pdf files are accepted")
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("file larger than 5 MB")
    if suffix == ".pdf":
        import io  # noqa: PLC0415

        from pypdf import PdfReader  # noqa: PLC0415

        reader = PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages[:200]]
        text = "\n\n".join(p.strip() for p in pages if p.strip())
        if not text:
            raise ValueError("no extractable text in the PDF (scanned document?)")
        return text
    return data.decode("utf-8", errors="replace")


async def ingest(
    session: AsyncSession, settings: Settings, *, title: str, content: str, tags: list[str], scope: str, source: str, created_by: str,
    store_file: tuple[str, bytes] | None = None,
) -> Any:
    content = content.strip()
    if len(content) < 10:
        raise ValueError("content is too short")
    demo = settings.DEMO
    doc_vector = await embed(content[:4000], demo=demo, model=settings.EMBEDDINGS_MODEL, region=settings.AWS_REGION)
    chunks: list[tuple[str, list[float] | None]] = []
    for chunk in chunk_text(content):
        chunks.append((chunk, await embed(chunk, demo=demo, model=settings.EMBEDDINGS_MODEL, region=settings.AWS_REGION)))
    if store_file is not None:
        name, data = store_file
        try:
            target = Path(settings.KNOWLEDGE_DIR) / f"{Path(name).stem[:60]}-{abs(hash(content)) % 10**8}{Path(name).suffix.lower()}"
            target.write_bytes(data)
            source = str(target)
        except OSError as exc:
            log.warning("could not store upload", extra={"fields": {"error": type(exc).__name__}})
    return await repo.create_document(session, title=title, source=source, content=content, tags=tags, scope=scope, embedding=doc_vector, created_by=created_by, chunks=chunks)


async def scopes_for(session: AsyncSession, role: str) -> set[str]:
    env_roles = {row.id: list(row.allowed_roles or []) for row in await repo.list_environments(session)}
    for env in await repo.list_environments(session):
        if env.account_id:
            env_roles[env.account_id] = list(env.allowed_roles or [])
    return visible_scopes(role, env_roles=env_roles)


async def search(session: AsyncSession, settings: Settings, *, query: str, role: str, scope: str | None, limit: int = 8) -> list[dict[str, Any]]:
    allowed = await scopes_for(session, role)
    if scope:
        if scope not in allowed:
            return []
        allowed = {scope}
    vector = await embed(query, demo=settings.DEMO, model=settings.EMBEDDINGS_MODEL, region=settings.AWS_REGION)
    if vector is not None:
        results = await repo.search_chunks(session, embedding=vector, scopes=allowed, limit=limit)
        if results:
            return results
    # Embeddings unavailable (or no vector hits): lexical fallback, so grounding never
    # silently comes back empty.
    return await repo.search_chunks_lexical(session, query=query, scopes=allowed, limit=limit)
