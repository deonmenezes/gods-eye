"""Sentinel orchestrator.

Loop: for each camera tick, pick a scenario, fetch (or generate) a Veo clip,
run the per-camera agent, POST the resulting incident.json to the status
broker. Run with:

    python -m orchestrator.main
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import signal
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

from . import agent_runner, veo_client
from .severity import pin_color

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)s: %(message)s",
)
log = logging.getLogger("orchestrator")

MODE = os.environ.get("SENTINEL_MODE", "stub")
TICK = float(os.environ.get("SENTINEL_TICK_SECONDS", "4"))
BROKER = f"http://{os.environ.get('SENTINEL_BROKER_HOST', '127.0.0.1')}:{os.environ.get('SENTINEL_BROKER_PORT', '8000')}"
AUDIT_DIR = ROOT / "audit"
AUDIT_DIR.mkdir(exist_ok=True)

CAMERAS = json.loads((ROOT / "data" / "cameras.json").read_text())
SCENARIOS = json.loads((ROOT / "scenarios" / "scenarios.json").read_text())


def _pick_scenario(camera: dict) -> dict:
    """Pick a scenario weighted toward those matching the camera's zone."""
    matches = [s for s in SCENARIOS if s["zone_type"] == camera["zone_type"]]
    pool = matches * 3 + SCENARIOS
    return random.choice(pool)


def _pick_scenario_for(camera: dict) -> dict:
    pinned = camera.get("pinned_scenario")
    if pinned:
        match = next((s for s in SCENARIOS if s["id"] == pinned), None)
        if match:
            return match
    return _pick_scenario(camera)


def _antigravity_incident(scenario: dict, camera: dict) -> dict | None:
    """Best-effort Antigravity tick; returns None on failure (caller falls back)."""
    import sys as _sys
    _sys.path.insert(0, str(ROOT / "api"))
    try:
        import _lib as api_lib  # type: ignore
    except Exception as e:
        log.warning("api/_lib import failed: %s", e)
        return None
    api_key = os.environ.get("GOOGLE_AI_API_KEY", "").strip()
    if not api_key:
        return None
    try:
        inc = api_lib.call_antigravity(camera, scenario, api_key, timeout=120)
        return api_lib.enrich_incident(inc, camera, scenario)
    except Exception as e:
        log.warning("antigravity failed for %s: %s", camera["camera_id"], e)
        return None


async def _process_camera(client: httpx.AsyncClient, camera: dict) -> None:
    scenario = _pick_scenario_for(camera)
    use_antigravity = os.environ.get("SENTINEL_AGENT", "").lower() == "antigravity"
    incident = None
    inc_mode = MODE
    if use_antigravity:
        incident = _antigravity_incident(scenario, camera)
        if incident is not None:
            inc_mode = "antigravity"
    if incident is None:
        clip_meta = veo_client.get_clip(scenario, camera, mode=MODE)
        incident = agent_runner.run(scenario, camera, clip_meta, mode=MODE)
    incident.setdefault("_meta", {})
    incident["_meta"].update({"mode": inc_mode})
    incident["scenario_id"] = scenario["id"]
    incident["pin_color"] = pin_color(incident["severity"])
    incident["camera"] = {
        "lat": camera["lat"],
        "lon": camera["lon"],
        "label": camera.get("label", camera["camera_id"]),
        "zone_type": camera["zone_type"],
        "altitude": camera.get("altitude", 15),
    }

    audit_file = AUDIT_DIR / f"{incident['incident_id']}.json"
    audit_file.write_text(json.dumps(incident, indent=2))

    try:
        r = await client.post(f"{BROKER}/incidents", json=incident, timeout=5)
        r.raise_for_status()
        log.info(
            "%s %s -> %s (%s) %s",
            camera["camera_id"],
            scenario["id"],
            incident["severity"],
            incident["pin_color"],
            incident["recommended_action"],
        )
    except Exception as e:
        log.warning("broker post failed for %s: %s", camera["camera_id"], e)


async def main() -> None:
    log.info("Sentinel orchestrator starting | mode=%s tick=%ss broker=%s cameras=%d",
             MODE, TICK, BROKER, len(CAMERAS))

    stop = asyncio.Event()

    def _shutdown(*_):
        log.info("shutdown signal received")
        stop.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _shutdown)
        except ValueError:
            pass

    async with httpx.AsyncClient() as client:
        i = 0
        while not stop.is_set():
            camera = CAMERAS[i % len(CAMERAS)]
            asyncio.create_task(_process_camera(client, camera))
            i += 1
            try:
                await asyncio.wait_for(stop.wait(), timeout=TICK)
            except asyncio.TimeoutError:
                pass


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
