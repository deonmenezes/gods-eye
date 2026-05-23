#!/usr/bin/env python3
"""Pre-bake one Veo 3 clip per scenario.

Runs offline once. The Vercel runtime can't long-poll Veo (30s timeout
on serverless functions), so we generate clips here, save them to
clips/{scenario_id}.mp4, and ship them as static assets. The Earth
canvas plays them in a <video> tag inside the CCTV viewport.

Crime scenarios are rewritten as neutral surveillance-footage prompts
to pass Veo's content policy (which refuses explicit violence). If a
scenario still gets refused, we record it in clips/refusals.json and
the front-end falls back to the procedural canvas display.

Usage:
    export GOOGLE_AI_API_KEY=...
    python -m scripts.generate_veo_clips                # all 8 scenarios
    python -m scripts.generate_veo_clips scn-loiter-atm-night   # one
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-5s %(message)s")
log = logging.getLogger("veo-bake")

SCENARIOS = json.loads((ROOT / "scenarios" / "scenarios.json").read_text())
CLIPS_DIR = ROOT / "clips"
CLIPS_DIR.mkdir(exist_ok=True)
REFUSALS_PATH = CLIPS_DIR / "refusals.json"

VEO_MODEL = os.environ.get("VEO_MODEL", "veo-3.1-fast-generate-preview")


# Map each scenario to a content-policy-safe prompt that still produces
# the visual *vibe* of the scene. Avoid weapon/violence vocabulary; lean
# on surveillance-aesthetic cues (lighting, framing, motion).
SAFE_PROMPTS: dict[str, str] = {
    "scn-clear-day-plaza": (
        "CCTV-style surveillance footage, fixed ceiling-mounted camera, "
        "wide-angle 16:9, slight fisheye, grainy. Daytime city plaza. "
        "Several pedestrians cross the frame in different directions, normal foot traffic. "
        "Timestamp burn-in upper-right. Anonymous figures, no identifiable faces. "
        "Realistic public-space lighting."
    ),
    "scn-loiter-atm-night": (
        "CCTV-style surveillance footage, fixed ceiling camera looking down at an ATM kiosk at night. "
        "16:9 wide angle, grainy. A single hooded figure stands near the ATM for the full duration, "
        "occasionally glancing over their shoulder. Hands in pockets. No transaction occurs. "
        "Ambient sodium streetlight. Anonymous figure, no visible face. "
        "Timestamp burn-in upper-right."
    ),
    "scn-forced-entry-storefront": (
        "CCTV-style surveillance camera footage at night, mounted above a glass storefront. "
        "16:9, grainy, ceiling perspective. Two anonymous figures approach the entrance. "
        "One examines the door frame closely while the other watches the empty street. "
        "Tense but ambiguous. No faces visible. Streetlight + storefront glow. "
        "Timestamp upper-right."
    ),
    "scn-armed-robbery-retail": (
        "CCTV-style surveillance footage inside a small retail store, fixed high-angle ceiling camera. "
        "16:9, grainy. One figure stands behind the counter with arms raised. Another figure stands "
        "across the counter, arm extended forward. Tense moment. Anonymous figures, no faces visible. "
        "Fluorescent overhead lighting. Timestamp burn-in upper-right. Surveillance aesthetic."
    ),
    "scn-loiter-and-pry": (
        "CCTV-style surveillance footage, fixed high-angle camera looking down a dark service alley at night. "
        "16:9, grainy. A figure stands near a back service door for some time, then crouches and works "
        "at the door handle with a small tool. Anonymous, no face visible. Single sodium light overhead. "
        "Timestamp burn-in upper-right."
    ),
    "scn-parking-normal": (
        "CCTV-style surveillance footage, ceiling-mounted camera overlooking a parking lot during the day. "
        "16:9, slight fisheye, grainy. Two vehicles drive in and park, drivers get out and walk away. "
        "Routine activity. Anonymous figures. Bright daylight. Timestamp burn-in upper-right."
    ),
    "scn-suspicious-lobby": (
        "CCTV-style surveillance footage from a high ceiling camera in an empty office lobby at night. "
        "16:9, grainy. One figure walks closely behind another through a turnstile, then immediately "
        "diverts down a side corridor while the first figure continues straight. Anonymous figures, "
        "no faces. Cool fluorescent lighting. Timestamp upper-right."
    ),
    "scn-low-conf-shadow": (
        "CCTV-style surveillance footage, fixed ceiling camera looking down a narrow alley at night. "
        "16:9, very low light, grainy. At the edge of the frame, a figure briefly appears in shadow, "
        "mostly silhouetted, holding an elongated object that is hard to identify. The figure exits "
        "the frame quickly. Anonymous, no face visible. Timestamp burn-in upper-right."
    ),
}


def _load_refusals() -> dict[str, str]:
    if REFUSALS_PATH.exists():
        try:
            return json.loads(REFUSALS_PATH.read_text())
        except Exception:
            return {}
    return {}


def _save_refusals(d: dict[str, str]) -> None:
    REFUSALS_PATH.write_text(json.dumps(d, indent=2) + "\n")


def generate(scenario_id: str) -> bool:
    """Generate one clip. Returns True on success, False on refusal/failure."""
    scenario = next((s for s in SCENARIOS if s["id"] == scenario_id), None)
    if scenario is None:
        log.error("unknown scenario %s", scenario_id)
        return False

    out = CLIPS_DIR / f"{scenario_id}.mp4"
    if out.exists() and out.stat().st_size > 1024:
        log.info("%s already exists (%.1f KB), skipping", scenario_id, out.stat().st_size / 1024)
        return True

    prompt = SAFE_PROMPTS.get(scenario_id) or scenario["narrative"]
    log.info("%s | model=%s | prompt=%r", scenario_id, VEO_MODEL, prompt[:120] + "…")

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        log.error("install google-genai: pip install google-genai")
        return False

    api_key = os.environ.get("GOOGLE_AI_API_KEY")
    if not api_key:
        log.error("GOOGLE_AI_API_KEY not set")
        return False

    client = genai.Client(api_key=api_key)

    try:
        # Build config defensively — Veo 3.1 supports a subset of these.
        cfg_kwargs = {
            "aspect_ratio": "16:9",
            "negative_prompt": "cartoon, illustration, anime, low quality, blurry, watermark, text overlay",
        }
        config = types.GenerateVideosConfig(**cfg_kwargs)
        op = client.models.generate_videos(model=VEO_MODEL, prompt=prompt, config=config)
    except Exception as e:
        msg = str(e)
        log.warning("%s submit failed: %s", scenario_id, msg[:300])
        if any(k in msg.lower() for k in ("policy", "safety", "violat", "blocked")):
            refusals = _load_refusals()
            refusals[scenario_id] = msg[:500]
            _save_refusals(refusals)
        return False

    # Long-poll
    deadline = time.time() + 5 * 60
    while not op.done and time.time() < deadline:
        time.sleep(8)
        try:
            op = client.operations.get(op)
        except Exception as e:
            log.warning("poll error: %s", e)
            time.sleep(4)
    if not op.done:
        log.error("%s timed out after 5 min", scenario_id)
        return False

    # Examine the response carefully — Veo may "succeed" but return no videos
    # if the prompt was filtered.
    try:
        resp = op.response
        videos = getattr(resp, "generated_videos", None) or []
        if not videos:
            log.warning("%s returned 0 videos (likely content-policy filter)", scenario_id)
            refusals = _load_refusals()
            refusals[scenario_id] = "no videos in response"
            _save_refusals(refusals)
            return False

        video = videos[0].video
        client.files.download(file=video)
        video.save(str(out))
        size_kb = out.stat().st_size / 1024
        log.info("%s ✓ saved %.1f KB", scenario_id, size_kb)
        return True
    except Exception as e:
        log.error("%s save failed: %s", scenario_id, e)
        return False


def main() -> int:
    targets = sys.argv[1:] if len(sys.argv) > 1 else [s["id"] for s in SCENARIOS]
    log.info("baking %d scenarios", len(targets))
    results = {}
    for sid in targets:
        ok = generate(sid)
        results[sid] = ok
    log.info("summary: %s", json.dumps(results, indent=2))
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
