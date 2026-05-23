"""Vercel serverless function: one Sentinel "tick".

GET /api/tick                  → random camera + scenario
GET /api/tick?camera=sf-001    → that camera
GET /api/tick?scenario=scn-...&camera=sf-002 → that pair

Uses Gemini (Google AI Studio API) when GOOGLE_AI_API_KEY is set, else stubs.
"""

from __future__ import annotations

import logging
import os
import sys
import time
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(__file__))
import _lib  # bundled neighbor; underscore-prefixed so Vercel doesn't expose it

log = logging.getLogger("api.tick")


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            params = parse_qs(urlparse(self.path).query)
            camera_id = params.get("camera", [None])[0]
            scenario_id = params.get("scenario", [None])[0]

            camera = _lib.pick_camera(camera_id)
            scenario = _lib.pick_scenario(scenario_id, camera)

            api_key = os.environ.get("GOOGLE_AI_API_KEY", "").strip()
            model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

            t0 = time.time()
            mode = "stub"
            error = None
            video_used = False

            host = self.headers.get("host") or self.headers.get("Host")

            if api_key:
                # Fetch the pre-baked Veo MP4 so Gemini can analyze the actual frames.
                video_bytes = _lib.fetch_clip_bytes(scenario["id"], host)
                video_used = bool(video_bytes)
                # Cap the inline payload to keep us under the 30s function budget.
                # Gemini accepts up to 20 MB inline; our clips are well under.
                try:
                    incident = _lib.call_gemini(
                        camera, scenario, api_key, model,
                        video_bytes=video_bytes,
                        timeout=24.0,
                    )
                    incident = _lib.enrich_incident(incident, camera, scenario)
                    mode = "gemini_video" if video_used else "gemini"
                except Exception as e:
                    log.exception("gemini call failed")
                    error = f"{type(e).__name__}: {e}"[:300]
                    # Retry once without video (faster) if the video call timed out.
                    if video_used:
                        try:
                            incident = _lib.call_gemini(
                                camera, scenario, api_key, model,
                                video_bytes=None, timeout=18.0,
                            )
                            incident = _lib.enrich_incident(incident, camera, scenario)
                            mode = "gemini"
                            video_used = False
                            error = None
                        except Exception as e2:
                            error = f"{type(e2).__name__}: {e2}"[:300]
                            incident = _lib.stub_incident(camera, scenario)
                    else:
                        incident = _lib.stub_incident(camera, scenario)
            else:
                incident = _lib.stub_incident(camera, scenario)

            incident["_meta"] = {
                "mode": mode,
                "latency_ms": int((time.time() - t0) * 1000),
                "model": model if mode.startswith("gemini") else None,
                "video": video_used,
                "error": error,
            }
            _lib.json_response(self, incident)
        except Exception as e:  # pragma: no cover - safety net
            log.exception("tick handler crashed")
            _lib.json_response(self, {"error": str(e)}, status=500)
