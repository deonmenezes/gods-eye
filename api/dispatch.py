"""POST /api/dispatch — place an outbound Twilio call describing a critical incident.

The front-end fires this with the incident JSON when severity is critical (or
when an operator clicks DISPATCH). The handler reads Twilio creds from env,
composes a natural-language brief, and calls Twilio's REST API. The actual
spoken content is rendered by /api/twiml with the message in a query param,
so Twilio fetches the TwiML at call time.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import sys
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(__file__))
import _lib

log = logging.getLogger("api.dispatch")


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("content-length", "0") or 0)
            body = json.loads(self.rfile.read(length).decode() or "{}") if length else {}

            sid = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
            token = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
            from_num = os.environ.get("TWILIO_FROM", "").strip()
            to_num = (body.get("to") or os.environ.get("TWILIO_TO", "")).strip()

            if not all([sid, token, from_num, to_num]):
                _lib.json_response(self, {
                    "ok": False,
                    "error": "Twilio not configured (need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, TWILIO_TO)",
                }, status=500)
                return

            label = body.get("camera_label") or body.get("camera_id") or "unknown camera"
            severity = (body.get("severity") or "critical").upper()
            scene = body.get("scene_summary") or "Critical incident detected by Sentinel AI."
            action = body.get("recommended_action") or "immediate response"
            city = body.get("city") or ""

            message = (
                f"This is an automated Sentinel security alert. "
                f"Severity: {severity}. "
                f"Camera: {label}{', in ' + city if city else ''}. "
                f"Scene: {scene} "
                f"Recommended action: {action}. "
                f"Please respond immediately."
            )

            host = self.headers.get("host") or self.headers.get("Host") or ""
            twiml_url = f"https://{host}/api/twiml?msg={urllib.parse.quote(message)}"

            twilio_url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Calls.json"
            form = urllib.parse.urlencode({
                "To": to_num,
                "From": from_num,
                "Url": twiml_url,
            }).encode()

            auth = base64.b64encode(f"{sid}:{token}".encode()).decode()
            req = urllib.request.Request(twilio_url, data=form, method="POST")
            req.add_header("Authorization", f"Basic {auth}")
            req.add_header("Content-Type", "application/x-www-form-urlencoded")

            try:
                with urllib.request.urlopen(req, timeout=15) as r:
                    resp = json.loads(r.read())
            except urllib.error.HTTPError as e:
                err_body = e.read().decode("utf-8", errors="replace")
                _lib.json_response(self, {
                    "ok": False,
                    "status_code": e.code,
                    "error": err_body[:500],
                }, status=502)
                return

            _lib.json_response(self, {
                "ok": True,
                "call_sid": resp.get("sid"),
                "status": resp.get("status"),
                "to": resp.get("to"),
                "from": resp.get("from"),
                "spoken_message_preview": message[:200],
            })
        except Exception as e:
            log.exception("dispatch handler failed")
            _lib.json_response(self, {"ok": False, "error": str(e)}, status=500)
