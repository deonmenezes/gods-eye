// GODS EYE — Command Center
// Center stage: Google Photorealistic 3D Tiles (real Earth) with auto-orbit
// + interactive 3D pins per camera. Falls back to Cobe wireframe globe if
// the Google Maps key is missing or rejected.

import createGlobe from "https://esm.sh/cobe@0.6.3";

const cfg = window.SENTINEL_CONFIG || {};
const mapsApiKey = cfg.mapsApiKey;

const WORLD_VIEW = {
  center: { lat: 25, lng: -20, altitude: 0 },
  range: 19000000,
  tilt: 0,
  heading: 0,
};

const CITY = {
  "sf":  { lat: 37.78807,  lon: -122.40760, flag: "🇺🇸", label: "San Francisco" },
  "nyc": { lat: 40.75872,  lon:  -73.98545, flag: "🇺🇸", label: "New York" },
  "lon": { lat: 51.53080,  lon:   -0.12380, flag: "🇬🇧", label: "London" },
  "par": { lat: 48.87370,  lon:    2.33240, flag: "🇫🇷", label: "Paris" },
  "tyo": { lat: 35.65956,  lon:  139.70060, flag: "🇯🇵", label: "Tokyo" },
  "dxb": { lat: 25.19720,  lon:   55.27440, flag: "🇦🇪", label: "Dubai" },
  "syd": { lat: -33.86990, lon:  151.20760, flag: "🇦🇺", label: "Sydney" },
  "sao": { lat: -23.55610, lon:  -46.66120, flag: "🇧🇷", label: "São Paulo" },
  "fra": { lat: 50.11090,  lon:    8.68210, flag: "🇩🇪", label: "Frankfurt" },
  "sin": { lat: 1.29270,   lon:  103.85580, flag: "🇸🇬", label: "Singapore" },
};

const STATE = {
  cameras: [],
  map3d: null,
  pins: new Map(),
  using3D: false,
  orbitRaf: null,
};

const mapRoot = document.getElementById("map-root");
const statusEl = document.getElementById("map-status");
function setStatus(text) {
  if (!statusEl) return;
  if (!text) { statusEl.hidden = true; return; }
  statusEl.textContent = text;
  statusEl.hidden = false;
}

// =================================================================
// MAP BOOT — Google Photorealistic 3D Tiles
// =================================================================
async function preflightMapTiles(key) {
  try {
    const r = await fetch(
      `https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapType: "satellite", language: "en-US", region: "US" }),
      },
    );
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      let parsed; try { parsed = JSON.parse(body); } catch {}
      return { ok: false, reason: parsed?.error?.message || `HTTP ${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message || String(e) };
  }
}

async function loadMaps3D() {
  if (!mapsApiKey) {
    setStatus("GOOGLE_MAPS_API_KEY not set · using 2D wireframe globe");
    return false;
  }

  const pre = await preflightMapTiles(mapsApiKey);
  if (!pre.ok) {
    setStatus(`Map Tiles API rejected: ${pre.reason} · using 2D fallback`);
    return false;
  }

  window.gm_authFailure = () => fallbackToCobe("Google Maps auth failure");

  try {
    await new Promise((resolve, reject) => {
      if (window.google?.maps) return resolve();
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(mapsApiKey)}&v=alpha&libraries=maps3d,marker`;
      s.async = true; s.defer = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load Google Maps JS API"));
      document.head.appendChild(s);
    });
    await google.maps.importLibrary("maps3d");
  } catch (e) {
    setStatus(`maps3d unavailable: ${e.message}`);
    return false;
  }

  if (!customElements.get("gmp-map-3d")) {
    setStatus("gmp-map-3d not registered");
    return false;
  }

  const el = document.createElement("gmp-map-3d");
  el.style.width = "100%";
  el.style.height = "100%";
  el.setAttribute("default-labels-disabled", "false");
  mapRoot.innerHTML = "";
  mapRoot.appendChild(el);

  await new Promise((r) => setTimeout(r, 80));
  const apply = (view) => {
    try {
      el.center = view.center;
      el.range = view.range;
      el.tilt = view.tilt;
      el.heading = view.heading;
    } catch {}
  };
  apply(WORLD_VIEW);
  el.addEventListener("gmp-load", () => apply(WORLD_VIEW));
  el.addEventListener("gmp-error", (ev) => fallbackToCobe(`gmp-error: ${ev?.detail?.message || "unknown"}`));

  STATE.map3d = el;
  STATE.using3D = true;
  setStatus(null);

  placePins();
  startOrbit();
  return true;
}

function placePins() {
  if (!STATE.using3D || !customElements.get("gmp-marker-3d-interactive")) return;
  for (const m of STATE.pins.values()) m.remove();
  STATE.pins.clear();

  for (const cam of STATE.cameras) {
    if (!cam.lat || !cam.lon) continue;
    const m = document.createElement("gmp-marker-3d-interactive");
    try {
      m.position = { lat: cam.lat, lng: cam.lon, altitude: 0 };
      m.altitudeMode = "RELATIVE_TO_GROUND";
    } catch {}
    const pin = document.createElement("div");
    pin.className = `gmp-pin ${cam.pin_color || "green"}`;
    pin.title = cam.label || cam.camera_id;
    pin.dataset.cameraId = cam.camera_id;
    m.appendChild(pin);
    // Both the marker element and the inner pin can receive clicks.
    m.addEventListener("gmp-click", () => flyToCamera(cam));
    pin.addEventListener("click", (e) => { e.stopPropagation(); flyToCamera(cam); });
    STATE.map3d.appendChild(m);
    STATE.pins.set(cam.camera_id, m);
  }
}

// ---- City + camera fly-throughs ----

const SF_LIKE_VIEW = (cam) => ({
  center: { lat: cam.lat, lng: cam.lon, altitude: cam.altitude || 30 },
  range: 600, tilt: 65, heading: 25,
});

function flyToCamera(cam) {
  if (!STATE.map3d) return;
  cancelAnimationFrame(STATE.orbitRaf);
  try {
    if (STATE.map3d.flyCameraTo) {
      STATE.map3d.flyCameraTo({ endCamera: SF_LIKE_VIEW(cam), durationMillis: 2500 });
    } else {
      const v = SF_LIKE_VIEW(cam);
      STATE.map3d.center = v.center;
      STATE.map3d.range = v.range;
      STATE.map3d.tilt = v.tilt;
      STATE.map3d.heading = v.heading;
    }
  } catch {}
  showBackButton(true);
  // Open the right panel with this camera's latest incident.
  applyIncident({
    type: "status",
    camera_id: cam.camera_id,
    pin_color: cam.pin_color,
    scenario_id: cam.last_scenario_id,
    incident_id: cam.last_incident_id,
    recommended_action: cam.label,
    severity: cam.severity,
  });
}

function flyToWorld() {
  if (!STATE.map3d) return;
  try {
    if (STATE.map3d.flyCameraTo) {
      STATE.map3d.flyCameraTo({ endCamera: WORLD_VIEW, durationMillis: 3000 });
    } else {
      STATE.map3d.center = WORLD_VIEW.center;
      STATE.map3d.range = WORLD_VIEW.range;
      STATE.map3d.tilt = WORLD_VIEW.tilt;
      STATE.map3d.heading = WORLD_VIEW.heading;
    }
  } catch {}
  showBackButton(false);
  setTimeout(() => startOrbit(), 1500);
}

function showBackButton(visible) {
  let b = document.getElementById("globe-back-btn");
  if (!b) {
    b = document.createElement("button");
    b.id = "globe-back-btn";
    b.textContent = "◀ back to world";
    b.style.cssText = `
      position: absolute; top: 14px; right: 14px; z-index: 12;
      background: rgba(8,10,16,0.85); color: #eef2f8;
      border: 1px solid rgba(255,255,255,0.16); border-radius: 8px;
      padding: 8px 14px; font: 11px/1 "JetBrains Mono", monospace;
      letter-spacing: 0.1em; text-transform: uppercase; cursor: pointer;
      backdrop-filter: blur(8px); opacity: 0; pointer-events: none;
      transition: opacity 0.2s;
    `;
    b.addEventListener("click", flyToWorld);
    document.getElementById("map-root")?.parentElement?.appendChild(b);
  }
  b.style.opacity = visible ? "1" : "0";
  b.style.pointerEvents = visible ? "auto" : "none";
}

function updatePinColor(cameraId, color) {
  const m = STATE.pins.get(cameraId);
  if (!m) return;
  const pin = m.querySelector(".gmp-pin");
  if (pin) pin.className = `gmp-pin ${color}`;
}

function startOrbit() {
  if (!STATE.using3D || !STATE.map3d) return;
  cancelAnimationFrame(STATE.orbitRaf);
  let last = performance.now();
  let heading = 0;
  const step = (now) => {
    const dt = (now - last) / 1000;
    last = now;
    heading = (heading + dt * 4) % 360;
    try { STATE.map3d.heading = heading; } catch {}
    STATE.orbitRaf = requestAnimationFrame(step);
  };
  STATE.orbitRaf = requestAnimationFrame(step);
}

// =================================================================
// FALLBACK — Cobe wireframe globe
// =================================================================
function fallbackToCobe(reason) {
  if (STATE.map3d) { try { STATE.map3d.remove(); } catch {} STATE.map3d = null; }
  cancelAnimationFrame(STATE.orbitRaf);
  STATE.using3D = false;
  setStatus(reason ? `2D fallback · ${reason}` : "2D fallback");

  const canvas = document.getElementById("cobe-globe");
  if (!canvas) return;
  canvas.hidden = false;
  initCobe(canvas);
}

let cobePhi = 1.6;
let cobeTheta = 0.18;
let cobePointer = null;
let cobeDx = 0;
let cobeAuto = true;

function initCobe(canvas) {
  const size = canvas.clientWidth || 600;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  createGlobe(canvas, {
    devicePixelRatio: dpr,
    width: size * dpr,
    height: size * dpr,
    phi: cobePhi,
    theta: cobeTheta,
    dark: 1,
    diffuse: 1.2,
    mapSamples: 22000,
    mapBrightness: 6.4,
    baseColor: [0.20, 0.36, 0.62],
    markerColor: [1.0, 0.32, 0.42],
    glowColor: [0.18, 0.28, 0.55],
    markers: STATE.cameras.filter((c) => c.lat).map((c) => ({
      location: [c.lat, c.lon],
      size: c.pin_color === "red" ? 0.10 : c.pin_color === "yellow" ? 0.07 : 0.05,
    })),
    onRender: (state) => {
      if (cobeAuto && cobePointer === null) cobePhi += 0.0025;
      state.phi = cobePhi + cobeDx;
      state.theta = cobeTheta;
      state.width = size * dpr;
      state.height = size * dpr;
    },
  });

  canvas.classList.add("ready");
  canvas.addEventListener("pointerdown", (e) => {
    cobePointer = e.clientX - cobeDx; cobeAuto = false; canvas.style.cursor = "grabbing";
  });
  const release = () => {
    if (cobePointer !== null) cobePhi += cobeDx;
    cobePointer = null; cobeDx = 0; canvas.style.cursor = "grab";
    setTimeout(() => (cobeAuto = true), 1500);
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointerleave", release);
  canvas.addEventListener("pointermove", (e) => {
    if (cobePointer === null) return;
    cobeDx = (e.clientX - cobePointer) / 200;
  });

  positionCallouts();
}

// =================================================================
// Country callouts (only visible in fallback mode)
// =================================================================
const CALLOUT_CITIES = [
  { code: "nyc", flag: "🇺🇸", name: "New York",   sub: "Threat Detected" },
  { code: "lon", flag: "🇬🇧", name: "London",     sub: "Threat Detected" },
  { code: "fra", flag: "🇩🇪", name: "Frankfurt",  sub: "Threat Detected" },
  { code: "sin", flag: "🇸🇬", name: "Singapore",  sub: "Threat Detected" },
];
let calloutEls = [];

function ensureCallouts() {
  const host = document.getElementById("globe-callouts");
  if (!host || calloutEls.length) return;
  calloutEls = CALLOUT_CITIES.map((c) => {
    const el = document.createElement("div");
    el.className = "callout visible";
    el.innerHTML = `
      <span class="callout-flag">${c.flag}</span>
      <div class="callout-text"><span>${c.name}</span><span class="callout-sub">${c.sub}</span></div>
    `;
    host.appendChild(el);
    return { ...c, el };
  });
}

function project(lat, lon, canvas, phi, theta) {
  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;
  const x3 = Math.cos(latR) * Math.cos(lonR + phi);
  const y3 = Math.sin(latR);
  const z3 = Math.cos(latR) * Math.sin(lonR + phi);
  const yT = y3 * Math.cos(theta) - z3 * Math.sin(theta);
  const zT = y3 * Math.sin(theta) + z3 * Math.cos(theta);
  const r = canvas.clientWidth / 2;
  return { visible: zT > -0.15, x: r + x3 * r * 0.92, y: r - yT * r * 0.92 };
}

function positionCallouts() {
  if (STATE.using3D) return;
  const canvas = document.getElementById("cobe-globe");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const parent = canvas.parentElement.getBoundingClientRect();
  const offX = rect.left - parent.left;
  const offY = rect.top - parent.top;

  ensureCallouts();
  calloutEls.forEach((c) => {
    const city = CITY[c.code];
    if (!city) return;
    const p = project(city.lat, city.lon, canvas, -cobePhi - cobeDx, cobeTheta);
    c.el.style.transform = `translate(calc(${offX + p.x}px - 50%), calc(${offY + p.y}px - 130%))`;
    c.el.style.opacity = p.visible ? "1" : "0";
  });
  requestAnimationFrame(positionCallouts);
}

// =================================================================
// Data load + overview/feed/right-panel
// =================================================================
async function loadCameras() {
  try {
    const res = await fetch("/cameras");
    STATE.cameras = await res.json();
  } catch {
    STATE.cameras = Object.values(CITY).slice(0, 8).map((c, i) => ({
      camera_id: `stub-${i}`, label: c.label, lat: c.lat, lon: c.lon,
      pin_color: i < 2 ? "red" : i < 4 ? "yellow" : "green",
    }));
  }
  repaintOverview();
}

function repaintOverview() {
  const reds = STATE.cameras.filter((c) => c.pin_color === "red").length;
  const agents = STATE.cameras.length;
  set("ov-active", reds || 8);
  set("ov-agents", agents || 8);
  set("mon-agents", agents || 8);
  set("stat-agents", agents || 8);
}
function set(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

const FEED_SEED = [
  { flag: "🇺🇸", name: "Unauthorized Access",    loc: "New York, US",   ago: "23s ago" },
  { flag: "🇩🇪", name: "Reconnaissance Scan",    loc: "Frankfurt, DE",  ago: "37s ago" },
  { flag: "🇸🇬", name: "Malware Download",       loc: "Singapore, SG",  ago: "58s ago" },
  { flag: "🇬🇧", name: "Brute Force Attempt",    loc: "London, UK",     ago: "1m ago" },
  { flag: "🇧🇷", name: "Exploit Attempt",        loc: "São Paulo, BR",  ago: "2m ago" },
];

function renderFeed() {
  const ul = document.getElementById("feed-list");
  if (!ul) return;
  ul.innerHTML = "";
  FEED_SEED.forEach((it) => {
    const li = document.createElement("li");
    li.className = "feed-item";
    li.innerHTML = `
      <span class="feed-flag">${it.flag}</span>
      <div class="feed-text">
        <div class="feed-name">${it.name}</div>
        <div class="feed-loc">${it.loc}</div>
      </div>
      <span class="feed-time">${it.ago}</span>
    `;
    ul.appendChild(li);
  });
}

let firstSeen = Date.now();
setInterval(() => {
  const el = document.getElementById("rp-dur");
  if (!el) return;
  const s = Math.max(0, Math.floor((Date.now() - firstSeen) / 1000));
  el.textContent = s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`;
}, 1000);

function applyIncident(ev) {
  if (ev.type !== "status") return;
  if (ev.camera_id && ev.pin_color) updatePinColor(ev.camera_id, ev.pin_color);
  // Remember last incident on the camera so a manual click can replay it.
  const cam = STATE.cameras.find((c) => c.camera_id === ev.camera_id);
  if (cam) {
    cam.pin_color = ev.pin_color || cam.pin_color;
    cam.severity = ev.severity || cam.severity;
    cam.last_incident_id = ev.incident_id || cam.last_incident_id;
    cam.last_scenario_id = ev.scenario_id || cam.last_scenario_id;
  }
  if (ev.pin_color !== "red" && ev.pin_color !== "yellow") return;
  const camRef = cam || {};
  const title = (ev.recommended_action || ev.scenario_id || "Unauthorized Access Attempt")
    .replace(/_/g, " ").replace(/^scn-/, "")
    .replace(/\b\w/g, (m) => m.toUpperCase());
  set("rp-title", title);
  set("rp-place", camRef.label || ev.camera_id || "Unknown location");
  set("rp-cam", (camRef.camera_id || "").toUpperCase() || "GE-CAM-LIVE");
  set("rp-id", `ID: ${ev.incident_id || "INC-LIVE"}`);
  if (ev.scenario_id) {
    const v = document.getElementById("cctv-video");
    if (v) {
      v.src = `/clips/${ev.scenario_id}.mp4`;
      v.play?.().catch(() => {});
      v.parentElement.classList.add("has-video");
    }
  }
  firstSeen = Date.now();
  repaintOverview();

  // Auto-dispatch on critical (Twilio call). Per-camera 30min cooldown.
  if (ev.severity === "critical") maybeDispatch(ev, camRef);
}

// ---- Twilio dispatch on critical incidents ----

const DISPATCH_COOLDOWN_MS = 30 * 60 * 1000;
const GLOBAL_DISPATCH_COOLDOWN_MS = 10 * 60 * 1000;
const lastDispatchAt = new Map();
let lastGlobalDispatchAt = 0;
const inFlightDispatch = new Set();
const dispatchMuted = () => localStorage.getItem("sentinel_mute_calls") === "1";

async function maybeDispatch(ev, cam) {
  const cid = ev.camera_id;
  if (!cid || dispatchMuted()) return;
  if (inFlightDispatch.has(cid)) return;
  const last = lastDispatchAt.get(cid) || 0;
  if (Date.now() - last < DISPATCH_COOLDOWN_MS) return;
  if (Date.now() - lastGlobalDispatchAt < GLOBAL_DISPATCH_COOLDOWN_MS) return;
  inFlightDispatch.add(cid);
  try {
    const r = await fetch("/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incident_id: ev.incident_id,
        camera_id: cid,
        camera_label: cam.label || cid,
        severity: ev.severity,
        scene_summary: ev.scene_summary,
        recommended_action: ev.recommended_action,
      }),
    });
    const out = await r.json().catch(() => ({}));
    if (r.ok && out.ok) {
      lastDispatchAt.set(cid, Date.now());
      lastGlobalDispatchAt = Date.now();
      console.log("📞 dispatch placed:", out.call_sid, "→", out.to);
    } else {
      console.warn("dispatch failed:", out.error || r.status);
    }
  } catch (e) {
    console.warn("dispatch fetch failed:", e);
  } finally {
    inFlightDispatch.delete(cid);
  }
}

function connectSSE() {
  try {
    const es = new EventSource("/events");
    es.addEventListener("message", (msg) => {
      try { applyIncident(JSON.parse(msg.data)); } catch {}
    });
  } catch {}
}

// =================================================================
// Misc UI
// =================================================================
document.querySelectorAll(".dim-toggle button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".dim-toggle button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    if (STATE.map3d) {
      try { STATE.map3d.tilt = b.dataset.dim === "2d" ? 0 : 45; } catch {}
    }
  });
});

document.getElementById("fullscreen-btn")?.addEventListener("click", () => {
  const el = document.documentElement;
  if (!document.fullscreenElement) el.requestFullscreen?.();
  else document.exitFullscreen?.();
});

// =================================================================
// Boot
// =================================================================
(async function boot() {
  renderFeed();
  await loadCameras();
  const ok = await loadMaps3D();
  if (!ok) fallbackToCobe();
  connectSSE();
})();
