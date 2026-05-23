"""Agent runner: one Managed Agent (Antigravity) interaction per camera tick.

`real` mode calls the Managed Agents API (preview). `stub` mode synthesizes an
incident.json from the scenario's expected_severity and skills_expected_to_fire
so the full pipeline runs without API access.
"""

from __future__ import annotations

import json
import logging
import os
import random
import time
import uuid
from pathlib import Path
from typing import Optional

from .severity import (
    SKILL_LOCAL_SEVERITY,
    derive_severity,
    pin_color,
    recommended_action,
)

log = logging.getLogger(__name__)

AGENT_FOLDER = Path(__file__).resolve().parents[1] / "agents" / "threat_analyst"
ALL_SKILLS = ("weapon_detection", "loitering", "forced_entry")


def _trace(events: list[dict], event: str, t0: float, **detail) -> None:
    entry = {"t_ms": int((time.time() - t0) * 1000), "event": event}
    if detail:
        entry["detail"] = detail
    events.append(entry)


def _stub_finding(name: str, fired: bool, scenario: dict) -> dict:
    if not fired:
        return {
            "name": name,
            "fired": False,
            "confidence": 0.0,
            "evidence_timestamps": [],
        }
    if scenario.get("expected_severity") == "low" and name == "weapon_detection":
        confidence = round(random.uniform(0.45, 0.59), 2)
    else:
        confidence = round(random.uniform(0.72, 0.94), 2)
    n_evidence = random.randint(1, 3)
    timestamps = sorted(
        f"00:0{random.randint(1, 7)}.{random.randint(0, 999):03d}" for _ in range(n_evidence)
    )
    return {
        "name": name,
        "fired": True,
        "confidence": confidence,
        "evidence_timestamps": timestamps,
    }


def run_stub(scenario: dict, camera: dict, clip_meta: dict) -> dict:
    """Synthesize a realistic incident.json from the scenario expectations."""
    t0 = time.time()
    trace: list[dict] = []
    _trace(trace, "sandbox_init", t0)
    _trace(trace, "input_mount", t0, clip_uri=clip_meta["clip_uri"])

    if clip_meta.get("refusal"):
        _trace(trace, "veo_refusal_detected", t0)
        report = _empty_report(camera, clip_meta, trace, "veo_refusal")
        _trace(trace, "sandbox_terminate", t0)
        report["trace"] = trace
        return report

    expected = set(scenario.get("skills_expected_to_fire", []))
    findings = []
    for skill in ALL_SKILLS:
        fired = skill in expected
        finding = _stub_finding(skill, fired, scenario)
        findings.append(finding)
        _trace(trace, "skill_evaluated", t0, name=skill, fired=fired,
               confidence=finding["confidence"])

    severity, reasoning, requires_review = derive_severity(findings)
    _trace(trace, "severity_computed", t0, severity=severity, reasoning=reasoning)

    action = recommended_action(severity)
    _trace(trace, "routing_decided", t0, recommended_action=action)
    _trace(trace, "sandbox_terminate", t0)

    return {
        "incident_id": str(uuid.uuid4()),
        "camera_id": camera["camera_id"],
        "agent_id": camera.get("agent_id", f"agent-{camera['camera_id']}"),
        "clip_uri": clip_meta["clip_uri"],
        "clip_hash": clip_meta["clip_hash"],
        "scene_summary": _stub_summary(scenario, camera),
        "findings": findings,
        "severity": severity,
        "severity_reasoning": reasoning,
        "requires_human_review": requires_review,
        "recommended_action": action,
        "routing_target": _routing_target(camera, action),
        "trace": trace,
        "notes": f"stub run for scenario {scenario['id']}",
    }


def _empty_report(camera: dict, clip_meta: dict, trace: list[dict], note: str) -> dict:
    return {
        "incident_id": str(uuid.uuid4()),
        "camera_id": camera["camera_id"],
        "agent_id": camera.get("agent_id", f"agent-{camera['camera_id']}"),
        "clip_uri": clip_meta.get("clip_uri"),
        "clip_hash": clip_meta.get("clip_hash"),
        "scene_summary": "Clip unavailable",
        "findings": [
            {"name": s, "fired": False, "confidence": 0.0, "evidence_timestamps": []}
            for s in ALL_SKILLS
        ],
        "severity": "info",
        "severity_reasoning": "clip unavailable",
        "requires_human_review": True,
        "recommended_action": "log",
        "routing_target": None,
        "trace": trace,
        "notes": note,
    }


def _stub_summary(scenario: dict, camera: dict) -> str:
    return (
        f"{camera.get('label', camera['camera_id'])} ({scenario['zone_type']}, "
        f"{scenario['time_of_day']}): {scenario['narrative']}"
    )


def _routing_target(camera: dict, action: str) -> Optional[str]:
    if action == "dispatch":
        return "pagerduty:onsite"
    if action == "notify":
        return f"slack:site_{camera['camera_id']}"
    return None


def run_real(scenario: dict, camera: dict, clip_meta: dict) -> dict:
    """Real Managed Agents (Antigravity) interaction.

    The Managed Agents preview API is in flux; the call shape here follows
    the public docs as of 2026-05. Pin the SDK version in production.
    """
    try:
        from google import genai  # type: ignore
    except ImportError as e:
        raise RuntimeError("google-genai not installed") from e

    api_key = os.environ.get("GOOGLE_AI_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_AI_API_KEY not set")
    if "managed_agents" not in dir(genai):
        log.warning("managed_agents API not available in this SDK build; falling back to stub")
        return run_stub(scenario, camera, clip_meta)

    client = genai.Client(api_key=api_key)
    agent_id = camera.get("agent_id")
    if not agent_id:
        raise RuntimeError(f"camera {camera['camera_id']} has no agent_id; run register_agents.py first")

    camera_meta = json.dumps({
        "camera_id": camera["camera_id"],
        "lat": camera["lat"],
        "lon": camera["lon"],
        "zone_type": camera["zone_type"],
        "time_of_day": scenario["time_of_day"],
        "expected_activity": scenario["expected_activity"],
        "agent_id": agent_id,
    })

    interaction = client.managed_agents.interactions.create(  # type: ignore[attr-defined]
        agent_id=agent_id,
        inputs=[
            {"name": "clip.mp4", "uri": clip_meta["clip_uri"]},
            {"name": "camera_meta.json", "content": camera_meta},
        ],
    )

    deadline = time.time() + 5 * 60
    while interaction.status != "succeeded" and time.time() < deadline:
        time.sleep(3)
        interaction = client.managed_agents.interactions.get(interaction.id)  # type: ignore[attr-defined]
    if interaction.status != "succeeded":
        raise RuntimeError(f"interaction {interaction.id} did not succeed: {interaction.status}")

    output = client.managed_agents.interactions.read_output(  # type: ignore[attr-defined]
        interaction.id, path="/outputs/incident.json"
    )
    return json.loads(output)


def run(scenario: dict, camera: dict, clip_meta: dict, mode: str = "stub") -> dict:
    if mode == "real":
        try:
            return run_real(scenario, camera, clip_meta)
        except Exception as e:
            log.error("real agent failed (%s); falling back to stub", e)
            return run_stub(scenario, camera, clip_meta)
    return run_stub(scenario, camera, clip_meta)
