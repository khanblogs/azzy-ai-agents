"""Local MiniLM embedder: real-vector contract + semantic ordering.

Skips when the model files are not baked into the image (e.g. a bare checkout).
"""
import math
import os

import pytest

from azzy.embeddings import cosine, embed_local_sync

MODEL_DIR = os.environ.get("LOCAL_EMBEDDINGS_DIR", "/opt/models/all-MiniLM-L6-v2")

pytestmark = pytest.mark.skipif(
    not os.path.exists(f"{MODEL_DIR}/model.onnx"),
    reason="local embedding model not present in this image",
)


def test_local_embedding_shape_and_norm():
    vector = embed_local_sync("kubernetes cluster autoscaling")
    assert vector is not None
    assert len(vector) == 384
    assert abs(math.sqrt(sum(v * v for v in vector)) - 1.0) < 1e-3


def test_local_embedding_semantic_ordering():
    a = embed_local_sync("kubernetes cluster autoscaling with karpenter")
    b = embed_local_sync("how to scale pods in a kubernetes cluster")
    c = embed_local_sync("banana bread recipe with walnuts")
    assert a and b and c
    assert cosine(a, b) > cosine(a, c)
