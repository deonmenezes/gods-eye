"""Validate severity rules from agents/threat_analyst/AGENTS.md.

Runs without pytest:  python -m tests.test_severity
"""

from __future__ import annotations

import sys

from orchestrator.severity import derive_severity, pin_color, recommended_action

FAIL = 0


def check(name: str, got, want):
    global FAIL
    ok = got == want
    print(f"  [{'OK' if ok else 'FAIL'}] {name}: got={got!r} want={want!r}")
    if not ok:
        FAIL += 1


def main() -> int:
    print("severity rule tests")

    # 1. No skills fire -> info.
    sev, _, _ = derive_severity([
        {"name": "weapon_detection", "fired": False, "confidence": 0.0},
        {"name": "loitering", "fired": False, "confidence": 0.0},
        {"name": "forced_entry", "fired": False, "confidence": 0.0},
    ])
    check("no skills -> info", sev, "info")
    check("info -> green pin", pin_color(sev), "green")
    check("info -> log", recommended_action(sev), "log")

    # 2. weapon_detection with confidence 0.9 -> high (weapon override).
    sev, reason, review = derive_severity([
        {"name": "weapon_detection", "fired": True, "confidence": 0.9},
        {"name": "loitering", "fired": False, "confidence": 0.0},
        {"name": "forced_entry", "fired": False, "confidence": 0.0},
    ])
    check("weapon 0.9 -> high", sev, "high")
    check("weapon high -> dispatch", recommended_action(sev), "dispatch")
    check("weapon -> red pin", pin_color(sev), "red")
    check("weapon 0.9 -> no human review", review, False)

    # 3. Two skills fire -> escalate one level.
    sev, _, _ = derive_severity([
        {"name": "loitering", "fired": True, "confidence": 0.8},
        {"name": "forced_entry", "fired": True, "confidence": 0.85},
        {"name": "weapon_detection", "fired": False, "confidence": 0.0},
    ])
    # base = high (from forced_entry), multi-skill escalation -> critical
    check("loiter+forced -> critical", sev, "critical")

    # 4. Low-confidence weapon (0.5) -> downgrade + human review.
    sev, _, review = derive_severity([
        {"name": "weapon_detection", "fired": True, "confidence": 0.5},
        {"name": "loitering", "fired": False, "confidence": 0.0},
        {"name": "forced_entry", "fired": False, "confidence": 0.0},
    ])
    # base = high, no multi-skill, weapon override does NOT trigger at <0.8,
    # low-confidence downgrade -> medium, requires_review True.
    check("weapon 0.5 -> medium", sev, "medium")
    check("weapon 0.5 -> requires human review", review, True)
    check("medium -> yellow pin", pin_color(sev), "yellow")
    check("medium -> notify", recommended_action(sev), "notify")

    # 5. Single loitering with 0.8 confidence -> low (no boost rule by default).
    sev, _, _ = derive_severity([
        {"name": "loitering", "fired": True, "confidence": 0.8},
        {"name": "forced_entry", "fired": False, "confidence": 0.0},
        {"name": "weapon_detection", "fired": False, "confidence": 0.0},
    ])
    check("loitering only -> low", sev, "low")
    check("low -> yellow", pin_color(sev), "yellow")

    print(f"\n{'PASS' if FAIL == 0 else f'FAIL ({FAIL} cases)'}")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
