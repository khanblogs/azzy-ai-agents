"""Shared FastAPI dependencies."""

from __future__ import annotations

from collections.abc import AsyncIterator

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from azzy.auth import current_principal, require_admin, require_owner, require_writer
from azzy.bus import Bus, get_bus
from azzy.config import Settings, get_settings
from azzy.db.engine import get_sessionmaker
from azzy.rbac import Principal


async def db_session() -> AsyncIterator[AsyncSession]:
    async with get_sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


def bus_dep() -> Bus:
    return get_bus()


def settings_dep() -> Settings:
    return get_settings()


def forbid(detail: str) -> HTTPException:
    return HTTPException(status_code=403, detail=detail)


DB = Depends(db_session)
BusDep = Depends(bus_dep)
SettingsDep = Depends(settings_dep)
OwnerDep = Depends(require_owner)  # any authenticated user → email
PrincipalDep = Depends(current_principal)  # → Principal(email, role)
WriterDep = Depends(require_writer)  # any role except readonly
AdminDep = Depends(require_admin)

__all__ = ["DB", "AdminDep", "BusDep", "OwnerDep", "Principal", "PrincipalDep", "SettingsDep", "WriterDep", "forbid"]
