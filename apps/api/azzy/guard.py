"""Injection guard + PII scrub applied to every tool output before it reaches the LLM.

Pure module (stdlib only). `scrub()` is the single entry point:
  1. neutralise instruction-like lines (prompt-injection patterns),
  2. mask PII / secrets,
  3. truncate to MAX_TOOL_OUTPUT with a marker.
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass

MAX_TOOL_OUTPUT = 12_000
REDACTED_LINE = "[redacted: instruction-like content]"
TRUNCATION_MARKER = "\n…[truncated: tool output exceeded {limit} chars]"

_INJECTION_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"ignore\s+(all\s+|the\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|messages?)",
        r"disregard\s+(all\s+|the\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?)",
        r"forget\s+(all\s+|everything\s+|the\s+)?(previous|prior|above|your)\s+(instructions?|rules?|training)",
        r"\byou\s+are\s+now\b",
        r"\bfrom\s+now\s+on\s+you\s+(are|will|must)\b",
        r"^\s*(system|assistant|user|developer)\s*:",
        r"<\|?\s*(im_start|im_end|system|endoftext)\s*\|?>",
        r"^\s*#{3,}",
        r"\bBEGIN\s+(SYSTEM\s+)?INSTRUCTIONS?\b",
        r"\bEND\s+(SYSTEM\s+)?INSTRUCTIONS?\b",
        r"\[\s*(SYSTEM|INST|/INST)\s*\]",
        r"\bnew\s+(system\s+)?(instructions?|directives?|rules?)\s*:",
        r"\b(act|pretend|role-?play|behave)\s+as\s+(if\s+you\s+(are|were)\s+)?(an?\s+)?(unrestricted|unfiltered|jailbroken|evil|dan)\b",
        r"\b(do\s+anything\s+now|jailbreak|developer\s+mode\s+enabled)\b",
        r"\boverride\s+(your\s+)?(safety|policy|guardrails?|restrictions?)\b",
        r"\breveal\s+(your\s+)?(system\s+prompt|instructions?|secrets?|api\s+keys?)\b",
        r"\b(exfiltrate|send)\s+(the\s+|all\s+)?(credentials?|secrets?|tokens?|keys?)\s+to\b",
    )
)

_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")
_AWS_KEY = re.compile(r"\b(AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[A-Z0-9]{16}\b")
_AWS_SECRET = re.compile(r"(?i)(aws_secret_access_key|secret_access_key)\s*[=:]\s*[\"']?([A-Za-z0-9/+=]{40})")
_KNOWN_TOKENS = re.compile(
    r"\b("
    r"sk-[A-Za-z0-9_-]{16,}"  # openai / anthropic-style
    r"|sk-ant-[A-Za-z0-9_-]{16,}"
    r"|gh[pousr]_[A-Za-z0-9]{20,}"  # github
    r"|github_pat_[A-Za-z0-9_]{20,}"
    r"|xox[abprs]-[A-Za-z0-9-]{10,}"  # slack
    r"|tskey-[A-Za-z0-9-]{10,}"  # tailscale
    r"|AIza[0-9A-Za-z_-]{35}"  # google api key
    r"|glpat-[A-Za-z0-9_-]{20,}"  # gitlab
    r")\b"
)
_GENERIC_SECRET = re.compile(
    r"(?i)\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization|bearer)"
    r"(\s*[=:]\s*|\s+)[\"']?([^\s\"',;]{6,})"
)
_PEM_BLOCK = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----", re.DOTALL)
_CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")
_AADHAAR = re.compile(r"\b\d{4}[ -]?\d{4}[ -]?\d{4}\b")
_PHONE = re.compile(
    r"(?<![\w.])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)"  # Indian mobile, +91 / 0 prefix, 10 digits
    r"|(?<![\w.])\+?\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?!\d)"  # international / US
)
_IPV4 = re.compile(r"(?<![\w.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\w.])")


def _luhn_ok(digits: str) -> bool:
    total = 0
    parity = len(digits) % 2
    for index, char in enumerate(digits):
        number = int(char)
        if index % 2 == parity:
            number *= 2
            if number > 9:
                number -= 9
        total += number
    return total % 10 == 0


def _mask_card(match: re.Match[str]) -> str:
    raw = match.group(0)
    digits = re.sub(r"\D", "", raw)
    if len(digits) < 13 or len(digits) > 19 or not _luhn_ok(digits):
        return raw
    return f"[card ****{digits[-4:]}]"


def _mask_aadhaar(match: re.Match[str]) -> str:
    digits = re.sub(r"\D", "", match.group(0))
    return f"[aadhaar ********{digits[-4:]}]"


def _mask_phone(match: re.Match[str]) -> str:
    raw = match.group(0)
    digits = re.sub(r"\D", "", raw)
    if len(digits) < 10:
        return raw
    return f"[phone ***{digits[-3:]}]"


def _mask_ip(match: re.Match[str]) -> str:
    raw = match.group(0)
    try:
        address = ipaddress.IPv4Address(raw)
    except ipaddress.AddressValueError:
        return raw
    if address.is_private or address.is_loopback or address.is_link_local or address.is_unspecified:
        return raw
    # Tailscale CGNAT range 100.64.0.0/10 is "private" for our purposes (internal mesh).
    if address in ipaddress.IPv4Network("100.64.0.0/10"):
        return raw
    a, b, c, _ = raw.split(".")
    return f"{a}.{b}.{c}.xxx"


def _mask_generic_secret(match: re.Match[str]) -> str:
    key, sep, value = match.group(1), match.group(2), match.group(3)
    if value.startswith("[") or (key.lower() == "bearer" and value.lower() in {"token", "auth"}):
        return match.group(0)
    return f"{key}{sep}[redacted]"


def neutralise_injection(text: str) -> str:
    """Replace any line matching an injection pattern with REDACTED_LINE."""
    out: list[str] = []
    for line in text.splitlines():
        if any(p.search(line) for p in _INJECTION_PATTERNS):
            out.append(REDACTED_LINE)
        else:
            out.append(line)
    result = "\n".join(out)
    if text.endswith("\n"):
        result += "\n"
    return result


def scrub_pii(text: str) -> str:
    """Mask emails, phones, keys, tokens, cards, Aadhaar-like numbers and public IPv4s."""
    text = _PEM_BLOCK.sub("[redacted private key]", text)
    text = _JWT.sub("[redacted jwt]", text)
    text = _AWS_SECRET.sub(lambda m: f"{m.group(1)}=[redacted]", text)
    text = _AWS_KEY.sub(lambda m: f"{m.group(1)}****************", text)
    text = _KNOWN_TOKENS.sub("[redacted token]", text)
    text = _GENERIC_SECRET.sub(_mask_generic_secret, text)
    text = _EMAIL.sub(lambda m: _mask_email(m.group(0)), text)
    text = _CARD.sub(_mask_card, text)
    text = _AADHAAR.sub(_mask_aadhaar, text)
    # Park IPv4 addresses behind sentinels so the phone matcher cannot eat dotted quads, then put
    # them back: private/CGNAT kept verbatim, public ones with the last octet masked.
    parked: list[str] = []

    def _park(match: re.Match[str]) -> str:
        parked.append(_mask_ip(match))
        return f"\x00IP{len(parked) - 1}\x00"

    text = _IPV4.sub(_park, text)
    text = _PHONE.sub(_mask_phone, text)
    text = re.sub(r"\x00IP(\d+)\x00", lambda m: parked[int(m.group(1))], text)
    return text


def _mask_email(address: str) -> str:
    local, _, domain = address.partition("@")
    head = local[:1]
    return f"{head}***@{domain}"


def truncate(text: str, limit: int = MAX_TOOL_OUTPUT) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + TRUNCATION_MARKER.format(limit=limit)


@dataclass(frozen=True, slots=True)
class ScrubReport:
    text: str
    redacted_lines: int
    truncated: bool


def scrub_with_report(text: str, limit: int = MAX_TOOL_OUTPUT) -> ScrubReport:
    if not isinstance(text, str):
        text = str(text)
    guarded = neutralise_injection(text)
    redacted = guarded.count(REDACTED_LINE)
    cleaned = scrub_pii(guarded)
    final = truncate(cleaned, limit)
    return ScrubReport(text=final, redacted_lines=redacted, truncated=len(final) != len(cleaned))


def scrub(text: str, limit: int = MAX_TOOL_OUTPUT) -> str:
    """Guard + PII scrub + truncate. Safe to call on any string (or object; it is str()'d)."""
    return scrub_with_report(text, limit).text
