"""Runtime settings (pydantic-settings). Secrets come from env only and are never logged."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from azzy.paths import agents_dir, artifacts_dir


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", case_sensitive=False)

    DEMO: bool = True
    DATABASE_URL: str = "postgresql+asyncpg://azzy:azzy@postgres:5432/azzy"
    DATABASE_RO_URL: str | None = None
    REDIS_URL: str = "redis://redis:6379/0"
    JWT_SECRET: str = Field(default="change-me-in-infra-env", min_length=8)
    OWNER_EMAIL: str = "owner@azzy.local"
    OWNER_PASSWORD: str = "change-me"
    WEBHOOK_SECRET: str = "change-me-webhook"
    SLACK_WEBHOOK_URL: str | None = None
    AUTHORIZED_TARGETS: str = "https://staging.client-a.example.com,http://localhost:3000"
    AWS_REGION: str = "ap-south-1"
    BEDROCK_MODEL: str = "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0"
    ANTHROPIC_API_KEY: str | None = None
    OPENAI_API_KEY: str | None = None
    PUBLIC_BASE_URL: str | None = None
    BACKUP_BUCKET: str | None = None
    GITHUB_TOKEN: str | None = None
    GMAIL_CREDENTIALS_JSON: str | None = None
    ZENDESK_SUBDOMAIN: str | None = None
    ZENDESK_EMAIL: str | None = None
    ZENDESK_API_TOKEN: str | None = None
    KNOWLEDGE_DIR: Path = Path("/data/knowledge")
    UVICORN_WORKERS: int = 1
    EMBEDDINGS_MODEL: str = "bedrock/amazon.titan-embed-text-v2:0"
    KNOWLEDGE_RETENTION_DAYS: int = 365
    MEMORY_RETENTION_DAYS: int = 180
    OIDC_ISSUER: str | None = None  # reserved, not implemented
    OIDC_CLIENT_ID: str | None = None
    OIDC_CLIENT_SECRET: str | None = None
    DAILY_BUDGET_USD: float = 25.0
    AGENTS_DIR: Path = Field(default_factory=agents_dir)
    ARTIFACTS_DIR: Path = Field(default_factory=artifacts_dir)
    SESSION_TTL_SECONDS: int = 7 * 24 * 3600
    APPROVAL_TIMEOUT_SECONDS: int = 3600
    HEALTH_PROBE_SECONDS: int = 60  # never below 60 s (lightweight host)
    WORKER_CONCURRENCY: int = 2  # at most 2 agent loops at once on the 2 vCPU pilot host
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 5
    LOG_LEVEL: str = "INFO"

    @field_validator("ARTIFACTS_DIR", mode="before")
    @classmethod
    def _resolve_artifacts_dir(cls, value: object) -> Path:
        return artifacts_dir(str(value) if value not in (None, "") else None)

    @field_validator("BEDROCK_MODEL", mode="before")
    @classmethod
    def _normalise_bedrock_model(cls, value: object) -> str:
        """Compose may pass the bare Bedrock model id; litellm needs the `bedrock/` prefix."""
        model = str(value or "").strip()
        if not model:
            return "bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0"
        if "/" not in model:
            return f"bedrock/{model}"
        return model

    @field_validator("AGENTS_DIR", mode="before")
    @classmethod
    def _resolve_agents_dir(cls, value: object) -> Path:
        if value in (None, ""):
            return agents_dir()
        path = Path(str(value))
        return path if (path / "policy.yaml").is_file() else agents_dir()

    @field_validator("KNOWLEDGE_DIR", mode="before")
    @classmethod
    def _resolve_knowledge_dir(cls, value: object) -> Path:
        from azzy.paths import writable_dir  # noqa: PLC0415

        return writable_dir(str(value) if value not in (None, "") else "/data/knowledge", "knowledge")

    @field_validator("HEALTH_PROBE_SECONDS", mode="after")
    @classmethod
    def _min_probe_interval(cls, value: int) -> int:
        return max(60, int(value))

    @field_validator("WORKER_CONCURRENCY", mode="after")
    @classmethod
    def _bounded_concurrency(cls, value: int) -> int:
        return max(1, min(int(value), 4))

    @property
    def authorized_targets(self) -> tuple[str, ...]:
        return tuple(t.strip().rstrip("/") for t in self.AUTHORIZED_TARGETS.split(",") if t.strip())

    @property
    def cookie_name(self) -> str:
        return "azzy_session"

    @property
    def cookie_secure(self) -> bool:
        return bool(self.PUBLIC_BASE_URL and self.PUBLIC_BASE_URL.lower().startswith("https://"))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def apply_overrides(settings: Settings, overrides: dict[str, object]) -> None:
    """Apply admin-editable values persisted in the `settings` table (PATCH /settings)."""
    if "daily_budget_usd" in overrides:
        settings.DAILY_BUDGET_USD = float(overrides["daily_budget_usd"])  # type: ignore[arg-type]
    if "authorized_targets" in overrides and isinstance(overrides["authorized_targets"], list):
        settings.AUTHORIZED_TARGETS = ",".join(str(t) for t in overrides["authorized_targets"])
    if "knowledge_retention_days" in overrides:
        settings.KNOWLEDGE_RETENTION_DAYS = int(overrides["knowledge_retention_days"])  # type: ignore[arg-type]
    if "memory_retention_days" in overrides:
        settings.MEMORY_RETENTION_DAYS = int(overrides["memory_retention_days"])  # type: ignore[arg-type]
