"""Users-table auth (CONTRACT-v2 §3): bcrypt, TOTP MFA, HS256 JWT cookie `azzy_session`, RBAC deps,
Redis login rate limit and the CSRF header check."""

from __future__ import annotations

import hmac
import logging
import os
import time
from typing import Any

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, Response, WebSocket, status

from azzy.config import Settings, get_settings
from azzy.rbac import ADMIN, Principal, can_write, csrf_ok, is_valid_role

log = logging.getLogger("azzy.auth")

ALGORITHM = "HS256"


def _login_rate_limit() -> int:
    """Per-minute-per-IP login budget; `LOGIN_RATE_LIMIT_PER_MIN` in infra/.env overrides the default 10."""
    try:
        return max(1, int(os.environ.get("LOGIN_RATE_LIMIT_PER_MIN", "10")))
    except ValueError:
        return 10


LOGIN_RATE_LIMIT = _login_rate_limit()  # per minute per IP
_BCRYPT_PREFIXES = ("$2a$", "$2b$", "$2y$")


def is_bcrypt_hash(value: str) -> bool:
    return value.startswith(_BCRYPT_PREFIXES) and len(value) == 60


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt(rounds=12)).decode()


def check_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode()[:72], password_hash.encode())
    except ValueError:
        return False


def owner_seed_hash(settings: Settings | None = None) -> str:
    """Hash for the seeded admin: keep the env value if it already is a bcrypt hash."""
    settings = settings or get_settings()
    configured = settings.OWNER_PASSWORD
    return configured if is_bcrypt_hash(configured) else hash_password(configured)


def issue_token(email: str, role: str, settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    now = int(time.time())
    payload: dict[str, Any] = {"sub": email, "role": role, "iat": now, "exp": now + settings.SESSION_TTL_SECONDS, "iss": "azzy"}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=ALGORITHM)


def decode_token(token: str, settings: Settings | None = None) -> dict[str, Any] | None:
    settings = settings or get_settings()
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGORITHM], issuer="azzy")
    except jwt.PyJWTError:
        return None
    if not payload.get("sub") or not is_valid_role(str(payload.get("role", ""))):
        return None
    return payload


def set_session_cookie(response: Response, token: str, request: Request | None = None) -> None:
    settings = get_settings()
    secure = settings.cookie_secure
    if not secure and request is not None:
        proto = request.headers.get("x-forwarded-proto", request.url.scheme)
        secure = proto == "https"
    response.set_cookie(
        key=settings.cookie_name, value=token, max_age=settings.SESSION_TTL_SECONDS, httponly=True,
        samesite="lax", secure=secure, path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=get_settings().cookie_name, path="/")


def _principal_from_cookie(cookies: dict[str, str]) -> Principal | None:
    token = cookies.get(get_settings().cookie_name)
    if not token:
        return None
    payload = decode_token(token)
    if payload is None:
        return None
    return Principal(email=str(payload["sub"]).lower(), role=str(payload["role"]))


async def current_principal(request: Request) -> Principal:
    principal = _principal_from_cookie(request.cookies)
    if principal is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="not authenticated")
    if await is_disabled(principal.email):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="account disabled")
    request.state.principal = principal
    return principal


async def require_owner(request: Request) -> str:
    """Backwards-compatible dependency: any authenticated user; returns the email."""
    return (await current_principal(request)).email


async def require_writer(principal: Principal = Depends(current_principal)) -> Principal:
    if not can_write(principal.role):
        raise HTTPException(status_code=403, detail="read-only role")
    return principal


async def require_admin(principal: Principal = Depends(current_principal)) -> Principal:
    if principal.role != ADMIN:
        raise HTTPException(status_code=403, detail="admin only")
    return principal


def ws_owner(websocket: WebSocket) -> str | None:
    """Cookie-based auth for the WebSocket handshake (same origin behind nginx)."""
    principal = _principal_from_cookie(websocket.cookies)
    return principal.email if principal else None


def verify_webhook_secret(provided: str | None) -> bool:
    expected = get_settings().WEBHOOK_SECRET
    return bool(provided) and hmac.compare_digest(provided or "", expected)


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


DISABLED_SET = "azzy:users:disabled"


async def is_disabled(email: str) -> bool:
    """Disabled users are tracked in a Redis set so every uvicorn worker sees the change at once."""
    try:
        from azzy.bus import get_bus  # noqa: PLC0415

        return bool(await get_bus().redis.sismember(DISABLED_SET, email.lower()))
    except Exception:  # noqa: BLE001
        return False


async def set_disabled(email: str, disabled: bool) -> None:
    try:
        from azzy.bus import get_bus  # noqa: PLC0415

        redis = get_bus().redis
        if disabled:
            await redis.sadd(DISABLED_SET, email.lower())
        else:
            await redis.srem(DISABLED_SET, email.lower())
    except Exception:  # noqa: BLE001
        log.warning("could not update disabled set")


async def rate_limited(bus: Any, key: str, limit: int, window_seconds: int = 60) -> bool:
    """Redis fixed-window counter. Fails open when Redis is unavailable (never locks everyone out)."""
    try:
        redis = bus.redis
        bucket = f"azzy:rl:{key}:{int(time.time() // window_seconds)}"
        count = await redis.incr(bucket)
        if count == 1:
            await redis.expire(bucket, window_seconds + 1)
        return int(count) > limit
    except Exception:  # noqa: BLE001
        return False


async def csrf_middleware(request: Request, call_next: Any) -> Any:
    if not csrf_ok(request.method, request.url.path, dict(request.headers)):
        from fastapi.responses import JSONResponse  # noqa: PLC0415

        return JSONResponse({"detail": "missing X-Requested-With: azzy header"}, status_code=403)
    return await call_next(request)
