"""Veo 3.1 client with scenario-hash caching.

In `real` mode, calls google-genai's Veo video generation and long-polls until
the clip is ready. In `stub` mode, returns a synthetic local placeholder path
so the rest of the pipeline can run without API credentials.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).resolve().parents[1] / "cache" / "veo"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def scenario_hash(scenario: dict, camera: dict) -> str:
    """Stable hash of scenario + camera identity for cache lookup."""
    payload = {
        "scenario_id": scenario["id"],
        "zone_type": scenario["zone_type"],
        "time_of_day": scenario["time_of_day"],
        "narrative": scenario["narrative"],
        "camera_zone": camera.get("zone_type"),
    }
    blob = json.dumps(payload, sort_keys=True).encode()
    return hashlib.sha256(blob).hexdigest()[:16]


def _veo_prompt(scenario: dict, camera: dict) -> str:
    return (
        "Synthetic CCTV footage, ceiling-mounted fixed camera, 16:9, "
        "timestamp burn-in upper-right, slight fisheye, no audio. "
        f"Setting: {camera.get('label', camera.get('camera_id'))} "
        f"({scenario['zone_type']}, {scenario['time_of_day']}). "
        f"Expected activity: {scenario['expected_activity']}. "
        f"Scene: {scenario['narrative']} "
        "Subjects are anonymous; do not depict identifiable faces. "
        "Realistic lighting, grainy CCTV quality."
    )


def get_clip(scenario: dict, camera: dict, mode: str = "stub") -> dict:
    """Return {clip_uri, clip_hash, cached, prompt, refusal?}.

    clip_uri is a local path (file://) in stub mode or a real URI in real mode.
    """
    h = scenario_hash(scenario, camera)
    meta_path = CACHE_DIR / f"{h}.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
        meta["cached"] = True
        return meta

    prompt = _veo_prompt(scenario, camera)

    if mode == "stub":
        clip_path = CACHE_DIR / f"{h}.placeholder.txt"
        clip_path.write_text(f"[stub clip for scenario {scenario['id']} on {camera['camera_id']}]\n")
        meta = {
            "clip_uri": str(clip_path),
            "clip_hash": h,
            "cached": False,
            "prompt": prompt,
            "mode": "stub",
        }
        meta_path.write_text(json.dumps(meta, indent=2))
        return meta

    return _real_veo(prompt, h, meta_path)


def _real_veo(prompt: str, h: str, meta_path: Path) -> dict:
    """Real Veo 3.1 call. Long-polls until clip is ready."""
    try:
        from google import genai  # type: ignore
        from google.genai import types  # type: ignore
    except ImportError as e:
        raise RuntimeError("google-genai not installed; run: pip install google-genai") from e

    api_key = os.environ.get("GOOGLE_AI_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_AI_API_KEY not set")

    model = os.environ.get("VEO_MODEL", "veo-3.1-generate-001")
    client = genai.Client(api_key=api_key)

    log.info("Veo generate start: model=%s hash=%s", model, h)
    try:
        op = client.models.generate_videos(
            model=model,
            prompt=prompt,
            config=types.GenerateVideosConfig(
                aspect_ratio="16:9",
                duration_seconds=8,
                number_of_videos=1,
            ),
        )
    except Exception as e:  # pragma: no cover - depends on SDK shape
        msg = str(e)
        if "policy" in msg.lower() or "safety" in msg.lower():
            return _refusal(prompt, h, meta_path, msg)
        raise

    deadline = time.time() + 5 * 60
    while not op.done and time.time() < deadline:
        time.sleep(5)
        op = client.operations.get(op)
    if not op.done:
        raise TimeoutError("Veo generation timed out")

    video = op.response.generated_videos[0].video
    clip_path = CACHE_DIR / f"{h}.mp4"
    client.files.download(file=video)
    video.save(str(clip_path))
    meta = {
        "clip_uri": str(clip_path),
        "clip_hash": h,
        "cached": False,
        "prompt": prompt,
        "mode": "real",
    }
    meta_path.write_text(json.dumps(meta, indent=2))
    return meta


def _refusal(prompt: str, h: str, meta_path: Path, reason: str) -> dict:
    meta = {
        "clip_uri": None,
        "clip_hash": h,
        "cached": False,
        "prompt": prompt,
        "mode": "real",
        "refusal": reason,
    }
    meta_path.write_text(json.dumps(meta, indent=2))
    return meta
