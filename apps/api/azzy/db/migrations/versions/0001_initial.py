"""initial schema (zero-divergence: mirrors azzy.db.models exactly)

Revision ID: 0001
Revises:
Create Date: 2026-11-01
"""

from __future__ import annotations

from alembic import op

from azzy.db.models import Base

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
