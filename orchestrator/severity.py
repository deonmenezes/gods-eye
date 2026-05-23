"""Severity rules from agents/threat_analyst/AGENTS.md.

Kept as plain Python so we can apply the same rules in stub mode without going
through the model. In real mode the agent applies them itself; this module
also lets the orchestrator validate the agent's output."""

from __future__ import annotations

from typing import Iterable

LADDER: tuple[str, ...] = ("info", "low", "medium", "high", "critical")
_INDEX = {name: i for i, name in enumerate(LADDER)}

SKILL_LOCAL_SEVERITY = {
    "weapon_detection": "high",
    "forced_entry": "high",
    "loitering": "low",
}


def _bump(sev: str, delta: int) -> str:
    i = max(0, min(len(LADDER) - 1, _INDEX[sev] + delta))
    return LADDER[i]


def derive_severity(findings: Iterable[dict]) -> tuple[str, str, bool]:
    """Apply the rules in AGENTS.md.

    Returns (severity, reasoning, requires_human_review).
    """
    fired = [f for f in findings if f.get("fired")]
    reasoning_parts: list[str] = []

    if not fired:
        return "info", "no skills fired", False

    base = "info"
    for f in fired:
        local = SKILL_LOCAL_SEVERITY.get(f["name"], "info")
        if _INDEX[local] > _INDEX[base]:
            base = local
    reasoning_parts.append(f"base from highest fired skill = {base}")

    if len(fired) >= 2:
        before = base
        base = _bump(base, +1)
        reasoning_parts.append(f"multi-skill escalation: {before} -> {base}")

    weapon = next((f for f in fired if f["name"] == "weapon_detection"), None)
    if weapon and weapon.get("confidence", 0) >= 0.8 and _INDEX[base] < _INDEX["high"]:
        reasoning_parts.append(f"weapon override: {base} -> high")
        base = "high"

    low_conf = any(f.get("confidence", 1.0) < 0.6 for f in fired)
    requires_review = False
    if low_conf:
        before = base
        base = _bump(base, -1)
        requires_review = True
        reasoning_parts.append(
            f"low-confidence downgrade: {before} -> {base}, requires_human_review=True"
        )

    return base, "; ".join(reasoning_parts), requires_review


def recommended_action(severity: str) -> str:
    if severity in {"critical", "high"}:
        return "dispatch"
    if severity == "medium":
        return "notify"
    return "log"


def pin_color(severity: str) -> str:
    if severity in {"critical", "high"}:
        return "red"
    if severity in {"medium", "low"}:
        return "yellow"
    return "green"
