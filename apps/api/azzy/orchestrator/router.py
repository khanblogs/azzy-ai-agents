"""Keyword / Hinglish router: prompt → {lead, assignees, env_id, kind, title} (CONTRACT-v2 §1).

Pure module (stdlib + pydantic). Works identically in DEMO and real mode; in real mode the
service may follow it with one LLM refinement call.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field

TaskKind = Literal["command", "incident", "routine", "meeting", "chat", "workflow"]
AgentLiteral = Literal["jimmy", "emir", "cyber", "sara", "marwah"]
AGENTS: tuple[str, ...] = ("jimmy", "emir", "cyber", "sara", "marwah")


@dataclass(frozen=True, slots=True)
class EnvRef:
    """What the router needs to know about an environment."""

    id: str
    name: str
    kind: str
    aliases: tuple[str, ...] = field(default_factory=tuple)


DEFAULT_ENVS: tuple[EnvRef, ...] = (
    EnvRef("client-a-staging", "Client A — staging", "staging", ("client a", "client-a", "clienta", "staging", "stage")),
    EnvRef("client-b-vps", "Client B — VPS", "prod", ("client b", "client-b", "clientb", "vps", "prod", "production")),
    EnvRef("hq", "HQ", "hq", ("hq", "head office", "headquarters", "office")),
)


class Route(BaseModel):
    lead: AgentLiteral
    assignees: list[AgentLiteral]
    env_id: str | None = None
    kind: TaskKind = "command"
    title: str
    scores: dict[str, int] = Field(default_factory=dict)
    version: str | None = None
    matched: list[str] = Field(default_factory=list)


# keyword → weight per agent. Multi-word phrases are substring matches; single words use \b.
_KEYWORDS: dict[str, tuple[tuple[str, int], ...]] = {
    "jimmy": (
        ("deploy", 5), ("deployment", 5), ("rollback", 5), ("roll back", 5), ("restart", 4), ("ecs", 5), ("eks", 5),
        ("ec2", 4), ("terraform", 4), ("k8s", 4), ("kubernetes", 4), ("logs", 3), ("log", 2), ("cloudwatch", 4),
        ("infra", 4), ("infrastructure", 4), ("cost", 3), ("costs", 3), ("dns", 4), ("cloudfront", 4), ("waf", 4),
        ("route53", 4), ("route 53", 4), ("aws", 3), ("lambda", 3), ("s3", 2), ("rds", 3), ("server", 2), ("vps", 2),
        ("uptime", 2), ("fleet", 3), ("docker", 2), ("compose", 2), ("nginx", 2), ("ssm", 3), ("tailscale", 3),
        ("health", 2), ("ci/cd", 3), ("pipeline", 1), ("inventory", 3), ("account", 1),
    ),
    "emir": (
        ("code", 4), ("bug", 4), ("fix", 4), ("review", 4), ("code review", 5), ("pr", 3), ("pull request", 4),
        ("test", 3), ("tests", 3), ("refactor", 4), ("api", 3), ("schema", 4), ("model", 3), ("train", 4),
        ("training", 3), ("data", 3), ("notebook", 4), ("debug", 4), ("sql", 3), ("query", 2), ("dataset", 3),
        ("eval", 3), ("python", 2), ("typescript", 2), ("react", 2), ("fastapi", 2), ("endpoint", 3), ("ml", 3),
        ("root cause", 4), ("exception", 3), ("stacktrace", 3), ("crash", 3), ("regression", 3), ("application", 2),
    ),
    "cyber": (
        ("security", 5), ("vapt", 6), ("pentest", 5), ("pen test", 5), ("scan", 4), ("audit", 4), ("iam", 4),
        ("owasp", 5), ("compliance", 4), ("secrets", 4), ("secret", 3), ("zap", 5), ("nuclei", 5), ("release gate", 5),
        ("gate", 2), ("vulnerability", 5), ("vuln", 4), ("cve", 4), ("semgrep", 5), ("gitleaks", 5), ("trivy", 5),
        ("checkov", 5), ("sast", 5), ("dast", 5), ("xss", 4), ("sqli", 4), ("injection", 3), ("exploit", 4),
        ("hardening", 3), ("posture", 4), ("assessment", 3), ("e2e", 3), ("playwright", 4),
    ),
    "sara": (
        ("kpi", 5), ("kpis", 5), ("report", 3), ("ops", 4), ("operations", 5), ("operational", 4), ("plan", 3),
        ("planning", 3), ("schedule", 3), ("ticket", 4), ("zendesk", 4), ("budget", 4), ("incident summary", 6),
        ("resource", 3), ("resources", 3), ("coordination", 3), ("documentation", 3), ("excel", 4), ("xlsx", 4),
        ("spreadsheet", 4), ("deck", 3), ("pptx", 3), ("pdf", 3), ("client update", 5), ("email", 3), ("mail", 2),
        ("invoice", 3), ("meeting notes", 3), ("calendar", 3), ("summary", 2), ("workflow", 1),
    ),
    "marwah": (
        ("marketing", 6), ("campaign", 5), ("brand", 5), ("branding", 5), ("content", 4), ("social", 4),
        ("social media", 5), ("seo", 5), ("newsletter", 5), ("positioning", 5), ("growth", 4), ("launch", 4),
        ("engagement", 3), ("audience", 3), ("ads", 3), ("adwords", 4), ("linkedin", 3), ("twitter", 3),
        ("instagram", 3), ("blog", 3), ("copy", 2), ("tagline", 4), ("persona", 3), ("funnel", 4), ("market research", 5),
    ),
}

# Hinglish verbs → agent bias.
_HINGLISH: tuple[tuple[str, str, int], ...] = (
    ("deploy karo", "jimmy", 4), ("deploy kar do", "jimmy", 4), ("restart karo", "jimmy", 4), ("rollback karo", "jimmy", 4),
    ("logs dekho", "jimmy", 3), ("check karo", "jimmy", 1),
    ("fix karo", "emir", 4), ("fix kar do", "emir", 4), ("review karo", "emir", 4), ("test karo", "emir", 3),
    ("debug karo", "emir", 4), ("code dekho", "emir", 3),
    ("scan karo", "cyber", 5), ("audit karo", "cyber", 4), ("security dekho", "cyber", 4),
    ("report banao", "sara", 4), ("ticket banao", "sara", 4), ("mail karo", "sara", 3), ("bhejo", "sara", 2), ("bhej do", "sara", 2),
    ("campaign banao", "marwah", 5), ("post banao", "marwah", 4), ("banao", "marwah", 1),
)

_HINGLISH_VERBS = ("karo", "kar do", "bhejo", "banao", "check karo", "dekho", "dikhao", "bhej do", "bana do")

_CODEISH = re.compile(
    r"(\.py\b|\.ts\b|\.js\b|\.go\b|\.java\b|\bgithub\b|\brepo\b|\bfunction\b|\bclass\b|\bendpoint\b|"
    r"\bcommit\b|\bbranch\b|\bmerge\b|\btraceback\b|\berror\b|\bjson\b|\bmigration\b)",
    re.IGNORECASE,
)
_VERSION = re.compile(r"\bv?(\d+\.\d+(?:\.\d+)?)\b", re.IGNORECASE)
_MEETING = re.compile(r"\b(call|start|hold|schedule)\s+(a\s+)?(team\s+)?(meeting|standup|stand-up|sync|huddle)\b", re.IGNORECASE)
_INCIDENT = re.compile(r"\b(incident|outage|war\s*room|sev\s?[123]|alarm|is\s+down|went\s+down|5xx)\b", re.IGNORECASE)

# Workflow detection: a prompt that chains ≥ 3 distinct phases across agents.
_WORKFLOW_PHASES: dict[str, re.Pattern[str]] = {
    "investigate": re.compile(r"\b(investigat\w*|diagnos\w*|debug|root\s*cause|failing|find\s+out\s+why)\b", re.IGNORECASE),
    "fix": re.compile(r"\b(fix\w*|patch\w*|repair|resolve\s+the\s+(bug|issue)|propose\w*\s+a?\s*fix)\b", re.IGNORECASE),
    "test": re.compile(r"\b(test\w*|verify|validate|qa)\b", re.IGNORECASE),
    "security": re.compile(r"\b(security|vapt|pentest|scan\w*|assess\w*|audit)\b", re.IGNORECASE),
    "deploy": re.compile(r"\b(deploy\w*|release|ship|roll\s*out|approv\w*)\b", re.IGNORECASE),
}

# Chat intents that should become a real command task (CONTRACT-v2 §4).
_ACTION_INTENT = re.compile(
    r"\b(deploy|rollback|roll back|restart|scan|audit|run\s+(the\s+)?(tests?|suite|pipeline|audit|scan)|open\s+a\s+pr|"
    r"build\s+(a|the)\s+(deck|report|model|pdf|campaign)|send\s+(an?\s+)?(email|mail|newsletter)|create\s+(a\s+)?ticket|"
    r"fix\s+(the|this)|investigate|generate\s+(a|the)\s+report)\b",
    re.IGNORECASE,
)
_ACTION_HINGLISH = re.compile(r"\b(deploy|restart|rollback|scan|fix|audit)\s+(karo|kar do)\b", re.IGNORECASE)


def _normalise(prompt: str) -> str:
    text = prompt.lower().strip()
    text = re.sub(r"[“”\"'`]", "", text)
    text = re.sub(r"\s+", " ", text)
    return text


def detect_env(prompt: str, envs: tuple[EnvRef, ...] | list[EnvRef] = DEFAULT_ENVS) -> str | None:
    """Match env id / name / aliases. Longer aliases win; specific client names beat generic kinds."""
    text = _normalise(prompt)
    best: tuple[int, str] | None = None
    for env in envs:
        candidates = {env.id.lower(), env.name.lower(), *[a.lower() for a in env.aliases]}
        candidates.add(env.name.lower().split("—")[0].strip())
        for candidate in candidates:
            if not candidate:
                continue
            pattern = r"(?<![\w-])" + re.escape(candidate) + r"(?![\w-])"
            if re.search(pattern, text):
                score = len(candidate)
                if best is None or score > best[0]:
                    best = (score, env.id)
    return best[1] if best else None


def workflow_phases(prompt: str) -> list[str]:
    return [name for name, pattern in _WORKFLOW_PHASES.items() if pattern.search(prompt)]


def detect_kind(prompt: str) -> TaskKind:
    if _MEETING.search(prompt):
        return "meeting"
    if _INCIDENT.search(prompt):
        return "incident"
    phases = workflow_phases(prompt)
    if len(phases) >= 3 and ("fix" in phases or "deploy" in phases):
        return "workflow"
    return "command"


def detect_version(prompt: str) -> str | None:
    match = _VERSION.search(prompt)
    if not match:
        return None
    return "v" + match.group(1)


def score_agents(prompt: str) -> tuple[dict[str, int], list[str]]:
    text = _normalise(prompt)
    scores = {agent: 0 for agent in _KEYWORDS}
    matched: list[str] = []
    for agent, keywords in _KEYWORDS.items():
        for keyword, weight in keywords:
            if " " in keyword or "/" in keyword:
                hit = keyword in text
            else:
                hit = re.search(r"(?<![\w-])" + re.escape(keyword) + r"(?![\w-])", text) is not None
            if hit:
                scores[agent] += weight
                matched.append(keyword)
    for phrase, agent, weight in _HINGLISH:
        if phrase in text:
            scores[agent] += weight
            matched.append(phrase)
    return scores, matched


def has_hinglish_verb(prompt: str) -> bool:
    text = _normalise(prompt)
    return any(re.search(r"\b" + re.escape(v) + r"\b", text) for v in _HINGLISH_VERBS)


def is_action_request(text: str) -> bool:
    """True when a chat message asks the agent to *do* something that should become a task."""
    if "?" in text and not _ACTION_HINGLISH.search(text) and not re.search(r"\b(can|could|would|will)\s+you\s+(please\s+)?(deploy|rollback|restart|scan|fix|run|build|send|audit)\b", text, re.IGNORECASE):
        return False
    return bool(_ACTION_INTENT.search(text) or _ACTION_HINGLISH.search(text))


def make_title(prompt: str, limit: int = 72) -> str:
    title = " ".join(prompt.strip().split())
    if not title:
        return "Untitled task"
    title = title[0].upper() + title[1:]
    if len(title) > limit:
        title = title[: limit - 1].rstrip() + "…"
    return title


def route(prompt: str, envs: tuple[EnvRef, ...] | list[EnvRef] = DEFAULT_ENVS) -> Route:
    """Deterministic routing. See CONTRACT.md "Routing" and CONTRACT-v2 §1."""
    kind = detect_kind(prompt)
    env_id = detect_env(prompt, envs)
    scores, matched = score_agents(prompt)
    version = detect_version(prompt)
    title = make_title(prompt)

    if kind == "meeting":
        return Route(lead="sara", assignees=list(AGENTS), env_id=env_id, kind="meeting", title=title, scores=scores, version=version, matched=matched)
    if kind == "incident":
        return Route(lead="jimmy", assignees=["jimmy", "emir", "cyber", "sara"], env_id=env_id, kind="incident", title=title, scores=scores, version=version, matched=matched)
    if kind == "workflow":
        return Route(lead="jimmy", assignees=["jimmy", "emir", "cyber", "sara"], env_id=env_id, kind="workflow", title=title, scores=scores, version=version, matched=matched)

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    top_agent, top_score = ranked[0]
    if top_score == 0:
        lead = "emir" if _CODEISH.search(prompt) else "sara"
    else:
        lead = top_agent

    assignees = [lead]
    for agent, score in ranked:
        if agent != lead and score >= 3 and score >= top_score * 0.4:
            assignees.append(agent)
            break
    change_words = ("deploy", "rollback", "fix", "pr", "pull request", "refactor", "deploy karo", "deploy kar do", "fix karo")
    if lead in {"jimmy", "emir"} and "cyber" not in assignees and any(k in matched for k in change_words):
        assignees.append("cyber")
    if lead != "sara" and "sara" not in assignees:
        assignees.append("sara")  # docs stage

    return Route(lead=lead, assignees=assignees, env_id=env_id, kind="command", title=title, scores=scores, version=version, matched=matched)
