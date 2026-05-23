"""GET /api/cameras → the camera roster (without runtime state)."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler

from . import _lib


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        out = [
            {
                "camera_id": c["camera_id"],
                "label": c.get("label", c["camera_id"]),
                "lat": c["lat"],
                "lon": c["lon"],
                "altitude": c.get("altitude", 15),
                "zone_type": c.get("zone_type"),
                "pin_color": "green",
                "severity": "info",
                "last_incident_id": None,
                "updated_at": 0,
            }
            for c in _lib.cameras()
        ]
        _lib.json_response(self, out)
