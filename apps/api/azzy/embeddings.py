"""Embeddings: hashed bag-of-words in DEMO (pure stdlib), LiteLLM in real mode (lazy import).

The hashed embedding keeps cosine similarity meaningful for keyword overlap, which is all the
DEMO knowledge search needs, with zero heavy dependencies.
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import re

log = logging.getLogger("azzy.embeddings")

DIM = 384
_TOKEN = re.compile(r"[a-z0-9][a-z0-9.+-]{1,}")
_STOP = frozenset("the a an and or of to in on for with is are be by at as it this that from we you our your i".split())


def tokenize(text: str) -> list[str]:
    tokens = [t.strip(".-+") for t in _TOKEN.findall(text.lower())]
    return [t for t in tokens if t and t not in _STOP]


def hashed_embedding(text: str, dim: int = DIM) -> list[float]:
    """Signed feature hashing of unigrams + bigrams, L2-normalised. Deterministic."""
    vector = [0.0] * dim
    tokens = tokenize(text)
    grams = tokens + [f"{a}_{b}" for a, b in zip(tokens, tokens[1:], strict=False)]
    for gram in grams:
        digest = hashlib.blake2b(gram.encode(), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "big") % dim
        sign = 1.0 if digest[4] & 1 else -1.0
        vector[index] += sign
    norm = math.sqrt(sum(v * v for v in vector))
    if norm == 0:
        return vector
    return [round(v / norm, 6) for v in vector]


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def chunk_text(text: str, max_chars: int = 900, overlap: int = 120) -> list[str]:
    """Paragraph-aware chunking with a small overlap."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    buffer = ""
    for paragraph in paragraphs:
        if len(buffer) + len(paragraph) + 1 <= max_chars:
            buffer = f"{buffer}\n{paragraph}".strip()
            continue
        if buffer:
            chunks.append(buffer)
        while len(paragraph) > max_chars:
            chunks.append(paragraph[:max_chars])
            paragraph = paragraph[max_chars - overlap :]
        buffer = paragraph
    if buffer:
        chunks.append(buffer)
    return chunks or [text[:max_chars]]



# --- Local embeddings (ONNX MiniLM) -------------------------------------------
# With EMBEDDINGS_BACKEND=local, real-mode embeddings come from a local
# all-MiniLM-L6-v2 ONNX model (384 dims — the same space the DB schema uses),
# so semantic search and recall work with no cloud credential. Loaded lazily.

_LOCAL_MODEL_DIR = os.environ.get("LOCAL_EMBEDDINGS_DIR", "/opt/models/all-MiniLM-L6-v2")
_local_session = None
_local_tokenizer = None
_local_load_failed = False


def _load_local() -> bool:
    global _local_session, _local_tokenizer, _local_load_failed
    if _local_session is not None:
        return True
    if _local_load_failed:
        return False
    try:
        import onnxruntime as ort  # noqa: PLC0415
        from tokenizers import Tokenizer  # noqa: PLC0415

        _local_tokenizer = Tokenizer.from_file(f"{_LOCAL_MODEL_DIR}/tokenizer.json")
        _local_tokenizer.enable_padding()
        _local_tokenizer.enable_truncation(max_length=256)
        _local_session = ort.InferenceSession(
            f"{_LOCAL_MODEL_DIR}/model.onnx", providers=["CPUExecutionProvider"]
        )
        return True
    except Exception as exc:  # noqa: BLE001 - local model is optional; callers degrade
        _local_load_failed = True
        log.warning("local embeddings unavailable", extra={"fields": {"error": type(exc).__name__}})
        return False


def embed_local_sync(text: str) -> list[float] | None:
    """Synchronous local MiniLM embedding (mean-pooled, L2-normalised, 384 dims)."""
    if not _load_local():
        return None
    try:
        import numpy as np  # noqa: PLC0415

        enc = _local_tokenizer.encode(text[:8000])
        input_ids = np.array([enc.ids], dtype=np.int64)
        attn = np.array([enc.attention_mask], dtype=np.int64)
        token_type = np.zeros_like(input_ids)
        outputs = _local_session.run(
            None,
            {"input_ids": input_ids, "attention_mask": attn, "token_type_ids": token_type},
        )
        hidden = outputs[0][0]  # (seq, 384)
        mask = attn[0].astype(np.float64)
        vector = (hidden * mask[:, None]).sum(axis=0) / max(mask.sum(), 1.0)
        norm = float(np.sqrt((vector * vector).sum()))
        if norm == 0:
            return None
        return [float(v) for v in (vector / norm)]
    except Exception as exc:  # noqa: BLE001
        log.warning("local embedding failed", extra={"fields": {"error": type(exc).__name__}})
        return None


async def embed(text: str, *, demo: bool, model: str = "bedrock/amazon.titan-embed-text-v2:0", region: str = "ap-south-1") -> list[float] | None:
    """DEMO → hashed; EMBEDDINGS_BACKEND=local → local MiniLM; else LiteLLM (384 dims).

    Returns None when the real call fails.
    """
    if demo:
        return hashed_embedding(text)
    if os.environ.get("EMBEDDINGS_BACKEND", "").lower() == "local":
        import asyncio  # noqa: PLC0415

        return await asyncio.to_thread(embed_local_sync, text)
    try:
        import litellm  # noqa: PLC0415

        kwargs: dict[str, object] = {"model": model, "input": [text[:8000]], "dimensions": DIM}
        if model.startswith("bedrock/"):
            kwargs["aws_region_name"] = region
        response = await litellm.aembedding(**kwargs)
        vector = list(response.data[0]["embedding"])
        if len(vector) != DIM:
            log.warning("embedding dimension mismatch", extra={"fields": {"got": len(vector), "want": DIM}})
            return None
        return vector
    except Exception as exc:  # noqa: BLE001 - embeddings are optional; text search still works
        log.warning("embedding failed", extra={"fields": {"error": type(exc).__name__}})
        return None
