"""Loads packages/agents/*.yaml into validated `AgentConfig` models. Only the four ids are accepted."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

from azzy.events import AGENT_META, AgentId
from azzy.paths import agents_dir

AGENT_IDS: tuple[str, ...] = tuple(a.value for a in AgentId)


class Avatar(BaseModel):
    model_config = ConfigDict(extra="allow")
    kind: str = "human"  # human | panther | cheetah
    hair: str | None = None
    glasses: bool = False
    headset: bool = False
    spots: bool = False
    skin: str | None = None
    fur: str | None = None
    outfit: str | None = None
    accent: str | None = None


class Budgets(BaseModel):
    daily_usd: float = Field(gt=0)
    max_tokens_per_task: int = Field(gt=0)
    model: str


class Routine(BaseModel):
    id: str
    cron: str
    title: str
    prompt: str


class AgentConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: AgentId
    name: str
    role: str
    domain_role: str
    color: str
    avatar: Avatar = Field(default_factory=Avatar)
    system_prompt: str
    tools: list[str]
    budgets: Budgets
    routines: list[Routine] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)

    @field_validator("color")
    @classmethod
    def _hex_color(cls, value: str) -> str:
        if not (value.startswith("#") and len(value) == 7):
            raise ValueError("color must be #rrggbb")
        return value.lower()

    @property
    def display_role(self) -> str:
        """Role label used by the UI (matches packages/events AGENT_META)."""
        return AGENT_META[self.id]["role"]

    @property
    def short_role(self) -> str:
        return AGENT_META[self.id]["short"]

    def allows_tool(self, tool: str) -> bool:
        return tool in self.tools


def load_agent(path: Path) -> AgentConfig:
    with path.open("r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    config = AgentConfig.model_validate(data)
    if config.id not in AGENT_IDS:  # pragma: no cover - the enum already enforces it
        raise ValueError(f"{path.name}: unknown agent id {config.id!r}")
    expected = AGENT_META[config.id]["color"].lower()
    if config.color != expected:
        raise ValueError(f"{path.name}: color {config.color} does not match packages/events ({expected})")
    if config.domain_role != AGENT_META[config.id]["domainRole"]:
        raise ValueError(f"{path.name}: domain_role {config.domain_role} does not match packages/events")
    return config


def load_agents(directory: Path | None = None) -> dict[str, AgentConfig]:
    directory = directory or agents_dir()
    agents: dict[str, AgentConfig] = {}
    for file in sorted(directory.glob("*.yaml")):
        if file.name == "policy.yaml":
            continue
        config = load_agent(file)
        if config.id in agents:
            raise ValueError(f"duplicate agent id {config.id!r} in {file.name}")
        agents[config.id] = config
    missing = set(AGENT_IDS) - set(agents)
    if missing:
        raise ValueError(f"missing agent yaml for: {sorted(missing)} in {directory}")
    return agents


@lru_cache(maxsize=1)
def get_agents() -> dict[str, AgentConfig]:
    return load_agents()


def get_agent(agent_id: str) -> AgentConfig:
    try:
        return get_agents()[agent_id]
    except KeyError as exc:
        raise KeyError(f"unknown agent {agent_id!r}") from exc
