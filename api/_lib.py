"""Shared helpers for the Vercel serverless functions."""

from __future__ import annotations

import json
import os
import random
import re
import time
import urllib.request
from pathlib import Path
from typing import Any

def _find_root() -> Path:
    """Locate the project root by walking up looking for data/cameras.json.

    Vercel bundles function files at /var/task/api/_lib.py with includeFiles
    placing data/scenarios/agents at /var/task/. Locally it's the repo root.
    """
    here = Path(__file__).resolve()
    for candidate in (here.parents[1], here.parent, *here.parents):
        if (candidate / "data" / "cameras.json").exists():
            return candidate
    return here.parents[1]


ROOT = _find_root()
CAMERAS = json.loads((ROOT / "data" / "cameras.json").read_text())
SCENARIOS = json.loads((ROOT / "scenarios" / "scenarios.json").read_text())
CITIES_PATH = ROOT / "data" / "cities.json"
CITIES = json.loads(CITIES_PATH.read_text()) if CITIES_PATH.exists() else []

AGENTS_MD = (ROOT / "agents" / "threat_analyst" / "AGENTS.md").read_text()
SKILL_MD = {
    name: (ROOT / "agents" / "threat_analyst" / "skills" / name / "SKILL.md").read_text()
    for name in ("weapon_detection", "loitering", "forced_entry", "incident_report")
}

SEVERITY_LADDER = ("info", "low", "medium", "high", "critical")
SEVERITY_INDEX = {s: i for i, s in enumerate(SEVERITY_LADDER)}
SKILL_LOCAL_SEVERITY = {"weapon_detection": "high", "forced_entry": "high", "loitering": "low"}


def cameras() -> list[dict]:
    return CAMERAS


def scenarios() -> list[dict]:
    return SCENARIOS


def cities() -> list[dict]:
    return CITIES


def pick_camera(camera_id: str | None) -> dict:
    if camera_id:
        for c in CAMERAS:
            if c["camera_id"] == camera_id:
                return c
    return random.choice(CAMERAS)


def pick_scenario(scenario_id: str | None, camera: dict) -> dict:
    if scenario_id:
        for s in SCENARIOS:
            if s["id"] == scenario_id:
                return s
    matches = [s for s in SCENARIOS if s["zone_type"] == camera["zone_type"]]
    pool = matches * 3 + SCENARIOS
    return random.choice(pool)


def pin_color(severity: str) -> str:
    if severity in {"critical", "high"}:
        return "red"
    if severity in {"medium", "low"}:
        return "yellow"
    return "green"


def recommended_action(severity: str) -> str:
    if severity in {"critical", "high"}:
        return "dispatch"
    if severity == "medium":
        return "notify"
    return "log"


def apply_severity_rules(findings: list[dict]) -> tuple[str, str, bool]:
    fired = [f for f in findings if f.get("fired")]
    if not fired:
        return "info", "no skills fired", False

    base = "info"
    for f in fired:
        local = SKILL_LOCAL_SEVERITY.get(f["name"], "info")
        if SEVERITY_INDEX[local] > SEVERITY_INDEX[base]:
            base = local
    reasons = [f"base={base}"]

    if len(fired) >= 2:
        before = base
        idx = min(len(SEVERITY_LADDER) - 1, SEVERITY_INDEX[base] + 1)
        base = SEVERITY_LADDER[idx]
        reasons.append(f"multi-skill: {before}->{base}")

    weapon = next((f for f in fired if f["name"] == "weapon_detection"), None)
    if weapon and weapon.get("confidence", 0) >= 0.8 and SEVERITY_INDEX[base] < SEVERITY_INDEX["high"]:
        reasons.append(f"weapon override: {base}->high")
        base = "high"

    requires_review = False
    if any(f.get("confidence", 1.0) < 0.6 for f in fired):
        before = base
        idx = max(0, SEVERITY_INDEX[base] - 1)
        base = SEVERITY_LADDER[idx]
        requires_review = True
        reasons.append(f"low-conf: {before}->{base}, review=true")

    return base, "; ".join(reasons), requires_review


# ---------- Gemini call (REST, no SDK to keep cold-start small) ----------

GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"


def _gemini_prompt(camera: dict, scenario: dict) -> str:
    return f"""{AGENTS_MD}

---

Skills available (you must evaluate each):

{SKILL_MD['weapon_detection']}

---

{SKILL_MD['loitering']}

---

{SKILL_MD['forced_entry']}

---

Output schema (write a single JSON object matching this):

{SKILL_MD['incident_report']}

---

# This run

camera_meta.json:
{json.dumps({
    "camera_id": camera["camera_id"],
    "lat": camera["lat"],
    "lon": camera["lon"],
    "zone_type": camera["zone_type"],
    "time_of_day": scenario["time_of_day"],
    "expected_activity": scenario["expected_activity"],
    "agent_id": f"agent-{camera['camera_id']}",
}, indent=2)}

clip narrative (you do NOT see real video; treat this as ground truth of what
the synthetic Veo clip depicts, and reason as if you were watching it):
{scenario['narrative']}

Now produce ONLY the incident.json object — no markdown fences, no commentary.
Evaluate every skill (fired or not). Apply the severity rules from AGENTS.md
literally. Populate the trace with realistic relative timestamps.
"""


def call_gemini(camera: dict, scenario: dict, api_key: str, model: str) -> dict:
    """Call Gemini with structured JSON output. Returns parsed incident dict."""
    prompt = _gemini_prompt(camera, scenario)
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.4,
            "responseMimeType": "application/json",
        },
    }
    url = GEMINI_ENDPOINT.format(model=model, key=api_key)
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        payload = json.loads(r.read())
    text = payload["candidates"][0]["content"]["parts"][0]["text"]
    text = _strip_fences(text)
    return json.loads(text)


def _strip_fences(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n", "", s)
        s = re.sub(r"\n```$", "", s)
    return s.strip()


# ---------- Stub incident generator (no API key needed) ----------

def stub_incident(camera: dict, scenario: dict) -> dict:
    import uuid

    expected = set(scenario.get("skills_expected_to_fire", []))
    findings = []
    trace = [{"t_ms": 0, "event": "sandbox_init"},
             {"t_ms": 12, "event": "input_mount",
              "detail": {"clip_uri": f"stub://{scenario['id']}/{camera['camera_id']}"}}]
    t = 200
    for skill in ("weapon_detection", "loitering", "forced_entry"):
        fired = skill in expected
        if fired:
            if scenario.get("expected_severity") == "low" and skill == "weapon_detection":
                conf = round(random.uniform(0.45, 0.59), 2)
            else:
                conf = round(random.uniform(0.72, 0.94), 2)
            n_ev = random.randint(1, 3)
            evidence = sorted(
                f"00:0{random.randint(1, 7)}.{random.randint(0, 999):03d}"
                for _ in range(n_ev)
            )
        else:
            conf, evidence = 0.0, []
        findings.append({
            "name": skill,
            "fired": fired,
            "confidence": conf,
            "evidence_timestamps": evidence,
        })
        trace.append({"t_ms": t, "event": "skill_evaluated",
                      "detail": {"name": skill, "fired": fired, "confidence": conf}})
        t += random.randint(80, 220)

    severity, reasoning, requires_review = apply_severity_rules(findings)
    action = recommended_action(severity)
    trace.append({"t_ms": t, "event": "severity_computed",
                  "detail": {"severity": severity, "reasoning": reasoning}})
    t += 30
    trace.append({"t_ms": t, "event": "routing_decided",
                  "detail": {"recommended_action": action}})
    t += 20
    trace.append({"t_ms": t, "event": "sandbox_terminate"})

    return {
        "incident_id": str(uuid.uuid4()),
        "camera_id": camera["camera_id"],
        "agent_id": f"agent-{camera['camera_id']}",
        "clip_uri": f"stub://{scenario['id']}/{camera['camera_id']}",
        "clip_hash": scenario["id"][-12:],
        "scene_summary": (
            f"{camera.get('label', camera['camera_id'])} "
            f"({scenario['zone_type']}, {scenario['time_of_day']}): "
            f"{scenario['narrative']}"
        ),
        "findings": findings,
        "severity": severity,
        "severity_reasoning": reasoning,
        "requires_human_review": requires_review,
        "recommended_action": action,
        "routing_target": ("pagerduty:onsite" if action == "dispatch"
                           else (f"slack:site_{camera['camera_id']}" if action == "notify"
                                 else None)),
        "trace": trace,
        "notes": f"stub run for scenario {scenario['id']}",
        "scenario_id": scenario["id"],
        "pin_color": pin_color(severity),
        "camera": {
            "lat": camera["lat"],
            "lon": camera["lon"],
            "label": camera.get("label", camera["camera_id"]),
            "zone_type": camera["zone_type"],
            "altitude": camera.get("altitude", 15),
        },
    }


def enrich_incident(incident: dict, camera: dict, scenario: dict) -> dict:
    """Make sure Gemini's output has the fields the front-end expects."""
    sev = incident.get("severity", "info")
    incident.setdefault("scenario_id", scenario["id"])
    incident["pin_color"] = pin_color(sev)
    incident.setdefault("recommended_action", recommended_action(sev))
    incident["camera"] = {
        "lat": camera["lat"],
        "lon": camera["lon"],
        "label": camera.get("label", camera["camera_id"]),
        "zone_type": camera["zone_type"],
        "altitude": camera.get("altitude", 15),
    }
    return incident


def json_response(handler, body: Any, status: int = 200) -> None:
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(json.dumps(body).encode())
