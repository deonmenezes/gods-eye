"""GET or POST /api/twiml?msg=<urlencoded message> → TwiML for Twilio.

Twilio fetches this when placing the dispatch call. The ?msg= param contains
the briefing text we want the recipient to hear. We escape XML special chars
and emit a single <Say> element with the alice voice.
"""

from __future__ import annotations

import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(__file__))


def _xml_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
         .replace("<", "&lt;")
         .replace(">", "&gt;")
         .replace('"', "&quot;")
         .replace("'", "&apos;")
    )


def _twiml_for(self):
    qs = parse_qs(urlparse(self.path).query)
    msg = (qs.get("msg", [""])[0]) or "Sentinel security alert. Please respond immediately."
    body = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say voice="Polly.Joanna-Neural">{_xml_escape(msg)}</Say>
  <Pause length="1"/>
  <Say voice="Polly.Joanna-Neural">Repeating. {_xml_escape(msg)}</Say>
</Response>"""
    self.send_response(200)
    self.send_header("Content-Type", "text/xml; charset=utf-8")
    self.send_header("Cache-Control", "no-store")
    self.end_headers()
    self.wfile.write(body.encode("utf-8"))


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        _twiml_for(self)

    def do_POST(self):
        _twiml_for(self)
