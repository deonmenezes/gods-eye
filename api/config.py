"""GET /api/config.js → injects window.SENTINEL_CONFIG with the Maps API key.

The Maps key is the only secret we hand to the browser — it should be
restricted to the production domain by HTTP-referrer in Google Cloud Console.
The Gemini key stays server-side and is never sent here.
"""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        cfg = {
            "mapsApiKey": os.environ.get("GOOGLE_MAPS_API_KEY", ""),
            "tickIntervalMs": int(os.environ.get("SENTINEL_TICK_MS", "4000")),
            "geminiEnabled": bool(os.environ.get("GOOGLE_AI_API_KEY", "").strip()),
        }
        body = f"window.SENTINEL_CONFIG = {json.dumps(cfg)};"
        self.send_response(200)
        self.send_header("Content-Type", "application/javascript")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body.encode())
