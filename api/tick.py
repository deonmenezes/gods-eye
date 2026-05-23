"""Vercel serverless function: one Sentinel "tick".

GET /api/tick                  → random camera + scenario
GET /api/tick?camera=sf-001    → that camera
GET /api/tick?scenario=scn-...&camera=sf-002 → that pair

Uses Gemini (Google AI Studio API) when GOOGLE_AI_API_KEY is set, else stubs.
"""

from __future__ import annotations

import logging
import os
import time
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

from . import _lib

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

            if api_key:
                try:
                    incident = _lib.call_gemini(camera, scenario, api_key, model)
                    incident = _lib.enrich_incident(incident, camera, scenario)
                    mode = "gemini"
                except Exception as e:
                    log.exception("gemini call failed")
                    error = f"{type(e).__name__}: {e}"
                    incident = _lib.stub_incident(camera, scenario)
            else:
                incident = _lib.stub_incident(camera, scenario)

            incident["_meta"] = {
                "mode": mode,
                "latency_ms": int((time.time() - t0) * 1000),
                "model": model if mode == "gemini" else None,
                "error": error,
            }
            _lib.json_response(self, incident)
        except Exception as e:  # pragma: no cover - safety net
            log.exception("tick handler crashed")
            _lib.json_response(self, {"error": str(e)}, status=500)
