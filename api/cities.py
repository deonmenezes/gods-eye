"""GET /api/cities → the global cities list."""

from __future__ import annotations

import os
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(__file__))
import _lib


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        _lib.json_response(self, _lib.cities())
