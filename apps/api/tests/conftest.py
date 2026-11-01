"""Test bootstrap: make `azzy` importable and pin AGENTS_DIR to the repo's packages/agents."""

from __future__ import annotations

import os
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parents[1]

if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

os.environ.setdefault("AGENTS_DIR", str(REPO_ROOT / "packages" / "agents"))
os.environ.setdefault("ARTIFACTS_DIR", str(API_ROOT / ".artifacts-test"))
os.environ.setdefault("DEMO", "1")
