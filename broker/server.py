"""Sentinel status broker.

- POST /incidents — receives incident.json from the orchestrator.
- GET  /events    — SSE stream; emits initial state then live status changes.
- GET  /cameras   — current state of all cameras (lat/lon/status).
- GET  /incidents/{id} — full incident record (for the detail panel).
- GET  /config.js — emits window.SENTINEL_CONFIG with the maps API key from .env.
- GET  /         — serves earth/index.html.
- Static earth/ assets are mounted at /static.

Run with:
    uvicorn broker.server:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections import deque
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-5s broker: %(message)s")
log = logging.getLogger("broker")

EARTH_DIR = ROOT / "earth"
DATA_DIR = ROOT / "data"
AUDIT_DIR = ROOT / "audit"

CAMERAS = {c["camera_id"]: c for c in json.loads((DATA_DIR / "cameras.json").read_text())}

# In-memory state ---------------------------------------------------------------
# camera_id -> latest summarized status payload
STATE: dict[str, dict[str, Any]] = {
    cid: {
        "camera_id": cid,
        "label": c.get("label", cid),
        "lat": c["lat"],
        "lon": c["lon"],
        "altitude": c.get("altitude", 15),
        "zone_type": c.get("zone_type"),
        "pin_color": "green",
        "severity": "info",
        "last_incident_id": None,
        "updated_at": 0,
    }
    for cid, c in CAMERAS.items()
}
INCIDENTS: dict[str, dict[str, Any]] = {}
RECENT_EVENTS: deque[dict] = deque(maxlen=200)
SUBSCRIBERS: set[asyncio.Queue] = set()


def _publish(event: dict) -> None:
    RECENT_EVENTS.append(event)
    for q in list(SUBSCRIBERS):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            log.warning("dropping event for slow subscriber")


app = FastAPI(title="Sentinel Status Broker", version="0.1.0")


@app.get("/")
async def landing() -> FileResponse:
    return FileResponse(EARTH_DIR / "index.html")


@app.get("/connect")
async def connect() -> FileResponse:
    return FileResponse(EARTH_DIR / "connect.html")


@app.get("/dashboard")
async def dashboard() -> FileResponse:
    return FileResponse(EARTH_DIR / "dashboard.html")


@app.get("/landing.css")
async def landing_css() -> FileResponse:
    return FileResponse(EARTH_DIR / "landing.css", media_type="text/css")


@app.get("/landing.js")
async def landing_js() -> FileResponse:
    return FileResponse(EARTH_DIR / "landing.js", media_type="application/javascript")


@app.get("/config.js")
async def config_js() -> Response:
    key = os.environ.get("GOOGLE_MAPS_API_KEY", "")
    body = f"window.SENTINEL_CONFIG = {json.dumps({'mapsApiKey': key})};"
    return Response(content=body, media_type="application/javascript")


@app.get("/cameras")
async def cameras() -> JSONResponse:
    return JSONResponse(list(STATE.values()))


@app.get("/incidents/{incident_id}")
async def incident(incident_id: str) -> JSONResponse:
    rec = INCIDENTS.get(incident_id)
    if not rec:
        # Try audit dir as fallback
        audit_file = AUDIT_DIR / f"{incident_id}.json"
        if audit_file.exists():
            return JSONResponse(json.loads(audit_file.read_text()))
        raise HTTPException(404, "incident not found")
    return JSONResponse(rec)


@app.post("/incidents")
async def post_incident(req: Request) -> JSONResponse:
    incident = await req.json()
    cid = incident.get("camera_id")
    if cid not in STATE:
        raise HTTPException(400, f"unknown camera_id {cid}")

    INCIDENTS[incident["incident_id"]] = incident
    AUDIT_DIR.mkdir(exist_ok=True)
    (AUDIT_DIR / f"{incident['incident_id']}.json").write_text(json.dumps(incident, indent=2))

    color = incident.get("pin_color", "green")
    severity = incident.get("severity", "info")

    STATE[cid].update({
        "pin_color": color,
        "severity": severity,
        "last_incident_id": incident["incident_id"],
        "updated_at": int(time.time() * 1000),
    })

    event = {
        "type": "status",
        "camera_id": cid,
        "pin_color": color,
        "severity": severity,
        "incident_id": incident["incident_id"],
        "scenario_id": incident.get("scenario_id"),
        "recommended_action": incident.get("recommended_action"),
        "updated_at": STATE[cid]["updated_at"],
    }
    _publish(event)
    return JSONResponse({"ok": True})


@app.get("/events")
async def events(request: Request) -> EventSourceResponse:
    q: asyncio.Queue = asyncio.Queue(maxsize=512)
    SUBSCRIBERS.add(q)
    log.info("subscriber connected (total=%d)", len(SUBSCRIBERS))

    snapshot = {"type": "snapshot", "cameras": list(STATE.values())}

    async def gen():
        try:
            yield {"event": "message", "data": json.dumps(snapshot)}
            while True:
                if await request.is_disconnected():
                    break
                try:
                    item = await asyncio.wait_for(q.get(), timeout=15)
                    yield {"event": "message", "data": json.dumps(item)}
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "{}"}
        finally:
            SUBSCRIBERS.discard(q)
            log.info("subscriber gone (total=%d)", len(SUBSCRIBERS))

    return EventSourceResponse(gen())


# Serve earth/ assets at the root so paths match the Vercel build (where
# public/ is served from /). The explicit routes above (/, /config.js, etc.)
# take precedence over the static mount.
if EARTH_DIR.exists():
    app.mount("/static", StaticFiles(directory=EARTH_DIR), name="static")


@app.get("/styles.css")
async def styles() -> FileResponse:
    return FileResponse(EARTH_DIR / "styles.css", media_type="text/css")


@app.get("/app.js")
async def appjs() -> FileResponse:
    return FileResponse(EARTH_DIR / "app.js", media_type="application/javascript")


@app.get("/healthz")
async def healthz() -> dict:
    return {
        "ok": True,
        "cameras": len(CAMERAS),
        "subscribers": len(SUBSCRIBERS),
        "incidents": len(INCIDENTS),
    }


@app.get("/tick")
async def tick(request: Request) -> JSONResponse:
    """Front-end-compatible tick endpoint that runs one orchestrator step."""
    from orchestrator import agent_runner, veo_client

    qp = request.query_params
    cid = qp.get("camera")
    sid = qp.get("scenario")
    cameras_list = list(CAMERAS.values())
    if cid:
        camera = CAMERAS.get(cid) or cameras_list[0]
    else:
        import random as _rnd
        camera = _rnd.choice(cameras_list)
    import json as _json
    scenarios_list = _json.loads((ROOT / "scenarios" / "scenarios.json").read_text())
    if sid:
        scenario = next((s for s in scenarios_list if s["id"] == sid), scenarios_list[0])
    else:
        import random as _rnd
        matches = [s for s in scenarios_list if s["zone_type"] == camera.get("zone_type")]
        pool = matches * 3 + scenarios_list
        scenario = _rnd.choice(pool)

    mode = os.environ.get("SENTINEL_MODE", "stub")
    clip_meta = veo_client.get_clip(scenario, camera, mode=mode)
    incident = agent_runner.run(scenario, camera, clip_meta, mode=mode)

    from orchestrator.severity import pin_color as _pc
    incident["scenario_id"] = scenario["id"]
    incident["pin_color"] = _pc(incident["severity"])
    incident["camera"] = {
        "lat": camera["lat"],
        "lon": camera["lon"],
        "label": camera.get("label", camera["camera_id"]),
        "zone_type": camera.get("zone_type"),
        "altitude": camera.get("altitude", 15),
    }
    incident["_meta"] = {"mode": mode, "model": None, "latency_ms": 0, "error": None}

    # Update broker's own state so /cameras stays in sync.
    INCIDENTS[incident["incident_id"]] = incident
    STATE[camera["camera_id"]].update({
        "pin_color": incident["pin_color"],
        "severity": incident["severity"],
        "last_incident_id": incident["incident_id"],
        "updated_at": int(time.time() * 1000),
    })
    return JSONResponse(incident)
