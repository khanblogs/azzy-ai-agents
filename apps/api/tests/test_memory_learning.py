"""Tests for the 2026-11-02 memory/knowledge fixes: the memory-extraction line
parser and the lexical-search term extraction. Both helpers are pure functions,
so these run without any database or services."""

from __future__ import annotations

from azzy.agents.runner import _parse_memory_lines
from azzy.db.repo import _lexical_terms


def test_parse_memory_lines_happy_path() -> None:
    text = (
        "fact: Client B staging runs app version v2.3.1 behind nginx.\n"
        "lesson: Always check the migration state before restarting the worker.\n"
    )
    assert _parse_memory_lines(text) == [
        ("fact", "Client B staging runs app version v2.3.1 behind nginx."),
        ("lesson", "Always check the migration state before restarting the worker."),
    ]


def test_parse_memory_lines_forgives_list_markers_and_numbers() -> None:
    text = "- fact: The payments service retries three times with backoff.\n2. lesson: Scope scanner runs to the staging target list first."
    out = _parse_memory_lines(text)
    assert [k for k, _ in out] == ["fact", "lesson"]
    assert out[0][1].startswith("The payments service")


def test_parse_memory_lines_drops_junk() -> None:
    text = (
        "Here are the memories from this task:\n"  # no separator match on a known kind
        "note: unknown kinds are not memories at all, drop this line please\n"
        "fact: too short\n"  # body below the 20-char floor
        "random prose without any separator at all in this line\n"
    )
    assert _parse_memory_lines(text) == []


def test_parse_memory_lines_caps_at_three_and_allows_skill_proposal() -> None:
    lines = "\n".join(f"fact: Durable fact number {i} about the platform state." for i in range(5))
    assert len(_parse_memory_lines(lines)) == 3
    assert _parse_memory_lines("skill_proposal: Add a runbook check step before deploys.") == [
        ("skill_proposal", "Add a runbook check step before deploys.")
    ]


def test_parse_memory_lines_empty_input() -> None:
    assert _parse_memory_lines("") == []
    assert _parse_memory_lines(None or "") == []


def test_lexical_terms_basic() -> None:
    assert _lexical_terms("How do I restart the Worker?") == ["how", "restart", "the", "worker"]


def test_lexical_terms_dedupes_filters_and_caps() -> None:
    assert _lexical_terms("ecs ecs ECS deploy") == ["ecs", "deploy"]
    assert _lexical_terms("a an to of") == []  # every term below 3 chars
    terms = _lexical_terms("one two three four five six seven eight nine ten")
    assert len(terms) == 8 and terms[0] == "one"
