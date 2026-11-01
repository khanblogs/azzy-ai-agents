"""Encryption at rest for small secrets (external IDs, MFA secrets).

Fernet (AES-128-CBC + HMAC-SHA256) with a key derived from JWT_SECRET via HKDF-SHA256, so no
extra key material has to be provisioned. Rotating JWT_SECRET invalidates stored ciphertexts;
the README documents this.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import struct
import time
from functools import lru_cache

from azzy.config import get_settings

_HKDF_INFO = b"azzy-ai-agents/v2/at-rest"
_HKDF_SALT = b"azzy-static-salt-v2"


def _hkdf_sha256(secret: bytes, salt: bytes, info: bytes, length: int = 32) -> bytes:
    prk = hmac.new(salt, secret, hashlib.sha256).digest()
    okm = b""
    block = b""
    counter = 1
    while len(okm) < length:
        block = hmac.new(prk, block + info + bytes([counter]), hashlib.sha256).digest()
        okm += block
        counter += 1
    return okm[:length]


@lru_cache(maxsize=1)
def _fernet():  # noqa: ANN202 - cryptography type kept out of the signature for lazy import
    from cryptography.fernet import Fernet  # noqa: PLC0415

    key = _hkdf_sha256(get_settings().JWT_SECRET.encode(), _HKDF_SALT, _HKDF_INFO)
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(token: str) -> str:
    from cryptography.fernet import InvalidToken  # noqa: PLC0415

    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise ValueError("cannot decrypt stored secret (JWT_SECRET rotated?)") from exc


# ---- TOTP (RFC 6238, stdlib only) ---------------------------------------------------------------


def new_totp_secret() -> str:
    import secrets  # noqa: PLC0415

    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_code(secret_b32: str, at: float | None = None, step: int = 30, digits: int = 6) -> str:
    padded = secret_b32.upper() + "=" * (-len(secret_b32) % 8)
    key = base64.b32decode(padded)
    counter = int((at if at is not None else time.time()) // step)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()  # noqa: S324 - RFC 6238 mandates HMAC-SHA1
    offset = digest[-1] & 0x0F
    code = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % (10**digits)
    return str(code).zfill(digits)


def verify_totp(secret_b32: str, otp: str, window: int = 1) -> bool:
    otp = (otp or "").strip().replace(" ", "")
    if not otp.isdigit():
        return False
    now = time.time()
    return any(hmac.compare_digest(totp_code(secret_b32, now + offset * 30), otp) for offset in range(-window, window + 1))


def otpauth_uri(secret_b32: str, email: str, issuer: str = "AZZY AI AGENTS") -> str:
    from urllib.parse import quote  # noqa: PLC0415

    label = quote(f"{issuer}:{email}")
    return f"otpauth://totp/{label}?secret={secret_b32}&issuer={quote(issuer)}&algorithm=SHA1&digits=6&period=30"
