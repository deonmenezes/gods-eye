// Sentinel — Two-mode global command center
//
// WORLD MODE   : slow auto-orbit over a satellite Earth. Each city is a
//                pulsing aggregate marker — color = worst-active severity,
//                count = number of red+yellow incidents. Click → fly in.
// CITY MODE    : flyCameraTo into the chosen city at street level. Each
//                camera is an individual gmp-marker-3d-interactive pin
//                that follows lat/lon natively (no DIY projection).
//
// The same right-side detail panel + CCTV viewport + left feed work in
// both modes. Tick loop keeps running so the world map breathes even
// when the operator isn't looking at any city.

const cfg = window.SENTINEL_CONFIG || {};
const mapsApiKey = cfg.mapsApiKey;
const TICK_MS = (cfg.tickIntervalMs && Number(cfg.tickIntervalMs)) || 4000;

const WORLD_VIEW = {
  center: { lat: 25, lng: -20, altitude: 0 },
  range: 19000000,
  tilt: 0,
  heading: 0,
};

const STATE = {
  mode: "world",            // "world" | "city"
  selectedCityId: null,
  cities: new Map(),        // city_id -> city record
  cityState: new Map(),     // city_id -> { red, yellow, green, lastIncidentAt }
  cameras: new Map(),       // camera_id -> camera state
  pinMarkers: new Map(),    // camera_id -> gmp-marker-3d-interactive element
  cityMarkers: new Map(),   // city_id -> gmp-marker-3d-interactive element
  incidents: [],
  incidentById: new Map(),
  selectedCameraId: null,
  feedFilter: "all",
  using3D: false,
  map3d: null,
  fallbackReason: null,
  orbitOn: true,
  tickCursor: 0,
};

const $ = (s) => document.querySelector(s);
const mapRoot = $("#map-root");

// =================================================================
// MAP BOOT
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
  if (!mapsApiKey) return false;

  const pre = await preflightMapTiles(mapsApiKey);
  if (!pre.ok) {
    STATE.fallbackReason = `Map Tiles API rejected the key — ${pre.reason}`;
    return false;
  }

  window.gm_authFailure = () => swapToFallback("auth failure");

  await new Promise((resolve, reject) => {
    if (window.google?.maps) return resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(mapsApiKey)}&v=alpha&libraries=maps3d,marker`;
    s.async = true; s.defer = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load Google Maps JS API"));
    document.head.appendChild(s);
  });

  try { await google.maps.importLibrary("maps3d"); }
  catch (e) { console.warn("maps3d library unavailable", e); return false; }
  if (!customElements.get("gmp-map-3d")) return false;

  const el = document.createElement("gmp-map-3d");
  el.style.width = "100%";
  el.style.height = "100%";
  el.setAttribute("default-labels-disabled", "false");
  mapRoot.appendChild(el);

  await new Promise(r => setTimeout(r, 100));

  const apply = (view) => {
    try {
      el.center = view.center;
      el.range = view.range;
      el.tilt = view.tilt;
      el.heading = view.heading;
    } catch (e) { console.warn("camera set failed", e); }
  };
  apply(WORLD_VIEW);
  el.addEventListener("gmp-load", () => apply(WORLD_VIEW));
  el.addEventListener("gmp-error", (ev) => swapToFallback(`gmp-error: ${ev?.detail?.message || "unknown"}`));

  STATE.map3d = el;
  STATE.using3D = true;
  startWorldOrbit();
  return true;
}

function swapToFallback(reason) {
  if (STATE.map3d) { STATE.map3d.remove(); STATE.map3d = null; }
  STATE.using3D = false;
  STATE.fallbackReason = reason;
  loadFallbackGlobe(reason);
}

function loadFallbackGlobe(reason) {
  mapRoot.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.style.cssText = `
    width: 100%; height: 100%; position: relative;
    background:
      radial-gradient(circle at 50% 50%, rgba(90,169,255,0.18), transparent 55%),
      radial-gradient(circle at 30% 70%, rgba(180,135,255,0.10), transparent 60%),
      linear-gradient(180deg, #050813 0%, #02030a 100%);
  `;
  const note = document.createElement("div");
  note.className = "fallback-notice";
  note.textContent = reason
    ? `2D fallback · ${reason}`
    : (mapsApiKey ? "3D Tiles unavailable — using 2D fallback." : "GOOGLE_MAPS_API_KEY not set — using 2D fallback.");
  wrap.appendChild(note);

  // Big circular world placeholder with pulsing city dots projected by equirect.
  const globe = document.createElement("div");
  globe.id = "fallback-globe";
  globe.style.cssText = `
    position: absolute; left: 50%; top: 50%;
    transform: translate(-50%, -50%);
    width: min(80%, 800px); aspect-ratio: 1;
    border-radius: 50%;
    background:
      radial-gradient(circle at 35% 35%, rgba(120,180,255,0.35), rgba(20,40,70,0.85) 65%, rgba(0,0,0,0.95) 100%);
    box-shadow: 0 0 80px rgba(90,169,255,0.25), inset -40px -60px 120px rgba(0,0,0,0.7);
  `;
  wrap.appendChild(globe);
  mapRoot.appendChild(wrap);
  // Place city dots inside the fallback globe via equirectangular.
  for (const city of STATE.cities.values()) {
    const dot = document.createElement("div");
    dot.className = "fallback-city-dot";
    dot.dataset.cityId = city.city_id;
    const x = 50 + (city.lon / 360) * 100;
    const y = 50 - (city.lat / 180) * 100;
    dot.style.left = `${x}%`;
    dot.style.top = `${y}%`;
    dot.title = city.name;
    dot.addEventListener("click", () => enterCity(city.city_id));
    globe.appendChild(dot);
  }
}

// =================================================================
// WORLD ORBIT
// =================================================================

let orbitRaf = null;
function startWorldOrbit() {
  if (!STATE.using3D || !STATE.map3d) return;
  cancelAnimationFrame(orbitRaf);
  let lastT = performance.now();
  let heading = 0;
  const step = (now) => {
    const dt = (now - lastT) / 1000; lastT = now;
    if (STATE.mode !== "world" || !STATE.orbitOn || !STATE.using3D) { orbitRaf = null; return; }
    heading = (heading + dt * 4) % 360;
    try { STATE.map3d.heading = heading; } catch {}
    orbitRaf = requestAnimationFrame(step);
  };
  orbitRaf = requestAnimationFrame(step);
}

function stopOrbit() { cancelAnimationFrame(orbitRaf); orbitRaf = null; }

// =================================================================
// CITY AGGREGATE MARKERS (WORLD MODE)
// =================================================================

function placeCityMarkers() {
  if (!STATE.using3D || !STATE.map3d) return;
  if (!customElements.get("gmp-marker-3d-interactive")) return;

  // Clear any existing markers first.
  for (const m of STATE.cityMarkers.values()) m.remove();
  STATE.cityMarkers.clear();

  for (const city of STATE.cities.values()) {
    const m = document.createElement("gmp-marker-3d-interactive");
    try {
      // Sit on the surface so the globe occludes far-side markers — gives
      // a real spherical sense rather than dots floating through Earth.
      m.position = { lat: city.lat, lng: city.lon, altitude: 0 };
      m.altitudeMode = "RELATIVE_TO_GROUND";
    } catch {}
    const wrap = document.createElement("div");
    wrap.className = `city-marker`;
    wrap.dataset.cityId = city.city_id;
    wrap.innerHTML = `
      <div class="city-glyph">
        <div class="city-pulse"></div>
        <div class="city-ring"></div>
        <div class="city-dot"></div>
        <div class="city-count">0</div>
      </div>
      <div class="city-label">${escapeHtml(city.name)}</div>
    `;
    m.appendChild(wrap);
    m.addEventListener("gmp-click", () => enterCity(city.city_id));
    wrap.addEventListener("click", (e) => { e.stopPropagation(); enterCity(city.city_id); });

    STATE.map3d.appendChild(m);
    STATE.cityMarkers.set(city.city_id, m);
  }
  refreshCityMarkers();
}

function refreshCityMarkers() {
  for (const [cityId, m] of STATE.cityMarkers.entries()) {
    const st = STATE.cityState.get(cityId) || { red: 0, yellow: 0, green: 0 };
    const wrap = m.querySelector(".city-marker");
    if (!wrap) continue;
    let color = "green";
    if (st.red > 0) color = "red";
    else if (st.yellow > 0) color = "yellow";
    wrap.classList.remove("red", "yellow", "green");
    wrap.classList.add(color);
    const count = st.red + st.yellow;
    const countEl = wrap.querySelector(".city-count");
    if (countEl) {
      countEl.textContent = count > 0 ? String(count) : "";
      countEl.style.display = count > 0 ? "flex" : "none";
    }
  }
}

// =================================================================
// CITY MODE — CAMERA PIN MARKERS
// =================================================================

function placeCityPins(cityId) {
  if (!STATE.using3D || !STATE.map3d) return;
  if (!customElements.get("gmp-marker-3d-interactive")) return;

  for (const m of STATE.pinMarkers.values()) m.remove();
  STATE.pinMarkers.clear();

  const cams = [...STATE.cameras.values()].filter(c => c.city_id === cityId);
  for (const cam of cams) {
    const m = document.createElement("gmp-marker-3d-interactive");
    try {
      m.position = { lat: cam.lat, lng: cam.lon, altitude: (cam.altitude || 15) };
      m.altitudeMode = "RELATIVE_TO_GROUND";
    } catch {}
    const pin = document.createElement("div");
    pin.className = `pin ${cam.pin_color || "green"}` + (STATE.selectedCameraId === cam.camera_id ? " selected" : "");
    pin.dataset.cameraId = cam.camera_id;
    m.appendChild(pin);
    m.addEventListener("gmp-click", () => selectCamera(cam.camera_id));
    pin.addEventListener("click", (e) => { e.stopPropagation(); selectCamera(cam.camera_id); });
    pin.addEventListener("mouseenter", () => showPinTooltip(cam, pin));
    pin.addEventListener("mouseleave", hideTooltip);
    STATE.map3d.appendChild(m);
    STATE.pinMarkers.set(cam.camera_id, m);
  }
}

function refreshCityPins() {
  for (const [cid, m] of STATE.pinMarkers.entries()) {
    const cam = STATE.cameras.get(cid);
    const pin = m.querySelector(".pin");
    if (!pin || !cam) continue;
    pin.className = `pin ${cam.pin_color || "green"}` + (STATE.selectedCameraId === cid ? " selected" : "");
  }
}

let tooltipEl = null;
function showPinTooltip(camera, anchor) {
  hideTooltip();
  const r = anchor.getBoundingClientRect();
  const tt = document.createElement("div");
  tt.className = "pin-tooltip";
  tt.innerHTML = `
    <div class="pt-label">${escapeHtml(camera.label)}</div>
    <div class="pt-sub">${camera.camera_id} · ${camera.zone_type || ""} · ${camera.severity || "info"}</div>
  `;
  tt.style.left = `${r.left + r.width / 2}px`;
  tt.style.top = `${r.top}px`;
  document.body.appendChild(tt);
  tooltipEl = tt;
}
function hideTooltip() { tooltipEl?.remove(); tooltipEl = null; }

// =================================================================
// CITY ENTER / EXIT (FLY CAMERA)
// =================================================================

function enterCity(cityId) {
  const city = STATE.cities.get(cityId);
  if (!city) return;
  STATE.mode = "city";
  STATE.selectedCityId = cityId;
  stopOrbit();

  // Remove city aggregate markers, add per-camera pins
  for (const m of STATE.cityMarkers.values()) m.remove();
  STATE.cityMarkers.clear();

  if (STATE.using3D && STATE.map3d?.flyCameraTo) {
    try {
      STATE.map3d.flyCameraTo({
        endCamera: {
          center: { lat: city.lat, lng: city.lon, altitude: city.view_altitude || 30 },
          range: city.view_range || 1500,
          tilt: city.view_tilt || 62,
          heading: 25,
        },
        durationMillis: 4000,
      });
    } catch (e) {
      // Fallback: just set the camera directly.
      try {
        STATE.map3d.center = { lat: city.lat, lng: city.lon, altitude: city.view_altitude };
        STATE.map3d.range = city.view_range || 1500;
        STATE.map3d.tilt = city.view_tilt || 62;
        STATE.map3d.heading = 25;
      } catch {}
    }
  }

  setTimeout(() => placeCityPins(cityId), 1200);

  $("#locator-coords").textContent =
    `${city.name.toUpperCase()} · ${formatCoord(city.lat, "N", "S")} ${formatCoord(city.lon, "E", "W")}`;
  const cams = [...STATE.cameras.values()].filter(c => c.city_id === cityId);
  $("#locator-sub").textContent = `${cams.length} cameras · ${city.country}`;
  $("#back-btn").classList.add("visible");
}

function exitToWorld() {
  STATE.mode = "world";
  STATE.selectedCityId = null;
  STATE.selectedCameraId = null;

  for (const m of STATE.pinMarkers.values()) m.remove();
  STATE.pinMarkers.clear();

  if (STATE.using3D && STATE.map3d?.flyCameraTo) {
    try {
      STATE.map3d.flyCameraTo({ endCamera: WORLD_VIEW, durationMillis: 3500 });
    } catch {
      try {
        STATE.map3d.center = WORLD_VIEW.center;
        STATE.map3d.range = WORLD_VIEW.range;
        STATE.map3d.tilt = WORLD_VIEW.tilt;
        STATE.map3d.heading = WORLD_VIEW.heading;
      } catch {}
    }
  }

  setTimeout(() => { placeCityMarkers(); startWorldOrbit(); }, 1600);
  $("#locator-coords").textContent = "GLOBAL · 0°N 0°W";
  $("#locator-sub").textContent = `${STATE.cameras.size} cameras · ${STATE.cities.size} cities`;
  $("#back-btn").classList.remove("visible");
}

function formatCoord(deg, pos, neg) {
  return `${Math.abs(deg).toFixed(2)}°${deg >= 0 ? pos : neg}`;
}

// =================================================================
// COUNTERS / FEED / DETAIL (mostly carried over)
// =================================================================

function recomputeCounters() {
  let r = 0, y = 0, g = 0;
  for (const c of STATE.cameras.values()) {
    if (c.pin_color === "red") r++;
    else if (c.pin_color === "yellow") y++;
    else g++;
  }
  $("#count-red").textContent = r;
  $("#count-yellow").textContent = y;
  $("#count-green").textContent = g;
}

function recomputeCityState() {
  for (const c of STATE.cities.values()) {
    STATE.cityState.set(c.city_id, { red: 0, yellow: 0, green: 0 });
  }
  for (const cam of STATE.cameras.values()) {
    const st = STATE.cityState.get(cam.city_id);
    if (!st) continue;
    st[cam.pin_color || "green"] = (st[cam.pin_color || "green"] || 0) + 1;
  }
  refreshCityMarkers();
}

function renderFeed() {
  const list = $("#feed-list");
  const filtered = STATE.incidents.filter(inc => {
    if (STATE.feedFilter === "all") return true;
    return inc.pin_color === STATE.feedFilter;
  });
  list.innerHTML = filtered.slice(0, 60).map(inc => feedCardHtml(inc)).join("");
  for (const card of list.querySelectorAll(".feed-card")) {
    card.addEventListener("click", () => {
      const cam = STATE.cameras.get(card.dataset.cameraId);
      if (cam && cam.city_id !== STATE.selectedCityId) {
        // Jump to that camera's city first, then select after fly-in
        enterCity(cam.city_id);
        setTimeout(() => selectCamera(card.dataset.cameraId, card.dataset.incidentId), 1500);
      } else {
        selectCamera(card.dataset.cameraId, card.dataset.incidentId);
      }
    });
  }
  $("#feed-meta").textContent = `${STATE.incidents.length} events · ${filtered.length} shown`;
}

function feedCardHtml(inc) {
  const sel = STATE.selectedCameraId === inc.camera_id ? "selected" : "";
  const cam = STATE.cameras.get(inc.camera_id) || {};
  const city = STATE.cities.get(cam.city_id);
  const cityLabel = city ? `${city.name}` : "";
  return `
    <div class="feed-card ${inc.pin_color} ${sel}"
         data-camera-id="${inc.camera_id}"
         data-incident-id="${inc.incident_id}">
      <div class="fc-row1">
        <div class="fc-label">${escapeHtml(cam.label || inc.camera_id)}</div>
        <div class="fc-time">${relativeTime(inc._receivedAt)}</div>
      </div>
      <div class="fc-row2">
        <div class="fc-zone">${escapeHtml(cityLabel)} · ${escapeHtml(cam.zone_type || "—")}</div>
        <div class="fc-sev">${inc.severity}</div>
      </div>
      <div class="fc-action">↳ ${inc.recommended_action || "—"}</div>
    </div>
  `;
}

function relativeTime(ts) {
  if (!ts) return "—";
  const dt = (Date.now() - ts) / 1000;
  if (dt < 5) return "just now";
  if (dt < 60) return `${Math.floor(dt)}s ago`;
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`;
  return `${Math.floor(dt / 3600)}h ago`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

setInterval(() => { renderFeed(); }, 5000);

document.addEventListener("click", e => {
  const tab = e.target.closest(".feed-tab");
  if (!tab) return;
  document.querySelectorAll(".feed-tab").forEach(t => t.classList.toggle("active", t === tab));
  STATE.feedFilter = tab.dataset.filter;
  renderFeed();
});

// =================================================================
// CCTV CANVAS RENDERER
// =================================================================

const cctvCanvas = $("#cctv-canvas");
const cctvCtx = cctvCanvas.getContext("2d");
let cctvTime = 0;
let cctvScenarioId = null;
let cctvSeverity = "info";

function cctvFrame() {
  const w = cctvCanvas.width, h = cctvCanvas.height;
  cctvTime += 1 / 30;

  cctvCtx.fillStyle = "#04060a";
  cctvCtx.fillRect(0, 0, w, h);

  cctvCtx.strokeStyle = `rgba(40, 90, 160, 0.18)`;
  cctvCtx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const y = h * 0.55 + i * (h * 0.07);
    cctvCtx.beginPath(); cctvCtx.moveTo(0, y); cctvCtx.lineTo(w, y); cctvCtx.stroke();
  }
  for (let i = -4; i <= 4; i++) {
    const x0 = w / 2;
    const yTop = h * 0.55;
    const xt = x0 + i * 60 * (yTop / h);
    const xb = x0 + i * 60;
    cctvCtx.beginPath(); cctvCtx.moveTo(xt, yTop); cctvCtx.lineTo(xb, h); cctvCtx.stroke();
  }

  drawActors(w, h);

  const grad = cctvCtx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(20, 30, 60, 0.45)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  cctvCtx.fillStyle = grad;
  cctvCtx.fillRect(0, 0, w, h);

  cctvCtx.globalAlpha = 0.06;
  for (let y = 0; y < h; y += 3) { cctvCtx.fillStyle = "#ffffff"; cctvCtx.fillRect(0, y, w, 1); }
  cctvCtx.globalAlpha = 1;

  const noiseDensity = cctvSeverity === "critical" ? 600 : (cctvSeverity === "high" ? 400 : 200);
  cctvCtx.fillStyle = "rgba(255,255,255,0.08)";
  for (let i = 0; i < noiseDensity; i++) {
    cctvCtx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }

  if (cctvSeverity === "critical" || cctvSeverity === "high") {
    cctvCtx.fillStyle = `rgba(255, 57, 86, ${0.04 + Math.sin(cctvTime * 8) * 0.02})`;
    cctvCtx.fillRect(0, 0, w, h);
  } else if (cctvSeverity === "medium" || cctvSeverity === "low") {
    cctvCtx.fillStyle = "rgba(255, 200, 59, 0.03)";
    cctvCtx.fillRect(0, 0, w, h);
  }

  const now = new Date();
  $("#cctv-time").textContent = `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
  requestAnimationFrame(cctvFrame);
}
function pad(n) { return String(n).padStart(2, "0"); }

function drawActors(w, h) {
  const scenario = cctvScenarioId || "";
  const t = cctvTime;
  const isWeapon = scenario.includes("armed") || scenario.includes("weapon");
  const isForced = scenario.includes("forced") || scenario.includes("pry");
  const isLoiter = scenario.includes("loiter");
  const isClear = !isWeapon && !isForced && !isLoiter && scenario;
  const ground = h * 0.78;

  if (isLoiter) {
    cctvCtx.fillStyle = "rgba(140, 150, 170, 0.7)";
    cctvCtx.fillRect(w * 0.22, ground - 80, 90, 80);
    cctvCtx.fillStyle = "rgba(60, 70, 90, 0.4)";
    cctvCtx.fillRect(w * 0.22 + 10, ground - 70, 70, 30);
    drawSubject(w * 0.45 + Math.sin(t * 0.6) * 10, ground, "#c4d0e5");
  } else if (isForced) {
    cctvCtx.fillStyle = "rgba(80, 80, 90, 0.7)";
    cctvCtx.fillRect(w * 0.42, ground - 110, 80, 110);
    cctvCtx.fillStyle = "rgba(40, 40, 50, 0.9)";
    cctvCtx.fillRect(w * 0.48, ground - 70, 4, 6);
    drawSubject(w * 0.55, ground, "#a8b5c8");
    drawSubject(w * 0.36, ground - 4, "#9da9bc");
    cctvCtx.strokeStyle = "rgba(220, 220, 220, 0.7)"; cctvCtx.lineWidth = 2;
    cctvCtx.beginPath(); cctvCtx.moveTo(w * 0.5, ground - 60); cctvCtx.lineTo(w * 0.43, ground - 50); cctvCtx.stroke();
  } else if (isWeapon) {
    cctvCtx.fillStyle = "rgba(80, 90, 110, 0.6)";
    cctvCtx.fillRect(0, ground - 30, w * 0.55, 30);
    drawSubject(w * 0.30, ground - 32, "#b8c2d8");
    cctvCtx.fillStyle = "#b8c2d8";
    cctvCtx.beginPath();
    cctvCtx.arc(w * 0.30 - 14, ground - 80, 5, 0, Math.PI * 2);
    cctvCtx.arc(w * 0.30 + 14, ground - 80, 5, 0, Math.PI * 2);
    cctvCtx.fill();
    drawSubject(w * 0.62, ground, "#a0aac0");
    cctvCtx.fillStyle = "rgba(255, 80, 80, 0.85)";
    cctvCtx.fillRect(w * 0.55, ground - 56, 6, 4);
  } else if (isClear) {
    const x1 = (t * 30) % (w + 80) - 40;
    const x2 = ((t + 4) * 22) % (w + 100) - 50;
    drawSubject(x1, ground, "#a8b5c8");
    drawSubject(w - x2, ground - 6, "#9eaabd");
  } else {
    drawSubject(w * 0.5 + Math.sin(t * 0.4) * 40, ground, "#a0aac0");
  }
}

function drawSubject(x, y, color) {
  cctvCtx.fillStyle = color;
  cctvCtx.beginPath();
  cctvCtx.arc(x, y - 80, 10, 0, Math.PI * 2);
  cctvCtx.fill();
  cctvCtx.fillRect(x - 12, y - 70, 24, 50);
  cctvCtx.fillRect(x - 10, y - 22, 8, 22);
  cctvCtx.fillRect(x + 2, y - 22, 8, 22);
}
requestAnimationFrame(cctvFrame);

// =================================================================
// VEO CLIP LOADER
// =================================================================

const CCTV_BOX = document.querySelector(".cctv");
const CCTV_VIDEO = $("#cctv-video");
const KNOWN_CLIPS = new Set();
const MISSING_CLIPS = new Set();

async function loadVeoClipFor(scenarioId, meta) {
  if (!scenarioId) { useCanvas(meta); return; }
  if (MISSING_CLIPS.has(scenarioId)) { useCanvas(meta); return; }

  const src = `/clips/${scenarioId}.mp4`;
  if (KNOWN_CLIPS.has(scenarioId)) { useVideo(src, meta); return; }

  try {
    const r = await fetch(src, { method: "HEAD" });
    if (r.ok) { KNOWN_CLIPS.add(scenarioId); useVideo(src, meta); }
    else { MISSING_CLIPS.add(scenarioId); useCanvas(meta); }
  } catch { MISSING_CLIPS.add(scenarioId); useCanvas(meta); }
}

function useVideo(src, meta) {
  const want = new URL(src, location.href).href;
  if (CCTV_VIDEO.src !== want) {
    CCTV_VIDEO.src = src;
    CCTV_VIDEO.play().catch(() => {});
  }
  CCTV_BOX.classList.add("has-video");
  CCTV_BOX.classList.remove("no-video");
  $("#cctv-tag").textContent = (meta?.mode === "gemini")
    ? `VEO 3.1 · real · gemini ${meta.latency_ms}ms`
    : "VEO 3.1 · real";
}

function useCanvas(meta) {
  CCTV_BOX.classList.add("no-video");
  CCTV_BOX.classList.remove("has-video");
  try { CCTV_VIDEO.pause(); CCTV_VIDEO.removeAttribute("src"); CCTV_VIDEO.load(); } catch {}
  $("#cctv-tag").textContent = (meta?.mode === "gemini")
    ? `VEO 3.1 · synthetic · gemini ${meta.latency_ms}ms`
    : "VEO 3.1 · synthetic · stub";
}

// =================================================================
// DETAIL PANEL
// =================================================================

function selectCamera(cameraId, incidentId) {
  STATE.selectedCameraId = cameraId;
  const cam = STATE.cameras.get(cameraId);
  if (!cam) return;
  refreshCityPins();
  renderFeed();

  $("#d-label").textContent = cam.label || cameraId;
  $("#d-cam").textContent = cameraId;
  $("#d-zone").textContent = cam.zone_type || "—";
  const sevEl = $("#d-sev");
  sevEl.className = `sev-pill ${cam.severity || "info"}`;
  sevEl.textContent = cam.severity || "info";

  $("#d-deeplink").value = `${location.origin}/#camera=${cameraId}`;

  const incident = incidentId
    ? STATE.incidentById.get(incidentId)
    : (cam.last_incident_id ? STATE.incidentById.get(cam.last_incident_id) : null);
  if (incident) renderIncident(incident);
  else renderNoIncident();
}

function renderNoIncident() {
  $("#d-action").textContent = "—";
  $("#cctv-cam-id").textContent = "—";
  $("#cctv-scenario").textContent = "—";
  $("#d-summary").textContent = "Waiting for first analysis…";
  $("#d-sev-reason").textContent = "—";
  $("#d-findings").innerHTML = "";
  $("#d-trace").innerHTML = "";
  cctvScenarioId = null; cctvSeverity = "info";
}

function renderIncident(inc) {
  cctvScenarioId = inc.scenario_id || "";
  cctvSeverity = inc.severity || "info";

  $("#cctv-cam-id").textContent = inc.camera_id;
  $("#cctv-scenario").textContent = (inc.scenario_id || "").replace(/^scn-/, "");

  // Swap to real Veo MP4 if it exists for this scenario; otherwise fall back
  // to the procedural canvas display.
  loadVeoClipFor(inc.scenario_id, inc._meta);

  $("#d-action").textContent = inc.recommended_action || "—";
  $("#d-summary").textContent = inc.scene_summary || "—";
  $("#d-sev-reason").textContent = inc.severity_reasoning || "—";

  $("#d-findings").innerHTML = (inc.findings || []).map(f => {
    const pct = Math.round((f.confidence || 0) * 100);
    return `
      <li class="${f.fired ? "fired" : "silent"}">
        <div class="f-row">
          <span class="f-name">${escapeHtml(f.name)}</span>
          <span class="f-status">${f.fired ? "fired" : "silent"}</span>
        </div>
        ${f.fired ? `
          <div class="f-confbar"><div class="f-confbar-fill" style="width: ${pct}%"></div></div>
          <div class="f-meta">
            <span>conf ${f.confidence.toFixed(2)}</span>
            <span>${(f.evidence_timestamps || []).join(" · ")}</span>
          </div>
        ` : ""}
      </li>`;
  }).join("");

  $("#d-trace").innerHTML = (inc.trace || []).map(t => {
    const isFired = t.event === "skill_evaluated" && t.detail?.fired;
    const isSev = t.event === "severity_computed";
    const cls = isFired ? "skill-fired" : (isSev ? "severity" : "");
    const detail = t.detail ? ` — ${formatDetail(t.detail)}` : "";
    return `<li class="${cls}"><span class="t-time">${(t.t_ms / 1000).toFixed(2)}s</span>${escapeHtml(t.event)}${escapeHtml(detail)}</li>`;
  }).join("");
}

function formatDetail(d) {
  if (!d) return "";
  return Object.entries(d).map(([k, v]) => {
    if (typeof v === "string" && v.length > 50) return `${k}=${v.slice(0, 50)}…`;
    return `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`;
  }).join(", ");
}

$("#copy-link").addEventListener("click", () => {
  navigator.clipboard?.writeText($("#d-deeplink").value);
  const b = $("#copy-link"); const orig = b.textContent;
  b.textContent = "copied"; setTimeout(() => b.textContent = orig, 1200);
});

$("#orbit-toggle").addEventListener("click", () => {
  STATE.orbitOn = !STATE.orbitOn;
  $("#orbit-toggle").classList.toggle("active", STATE.orbitOn);
  if (STATE.mode === "world" && STATE.orbitOn) startWorldOrbit();
});
$("#recenter-btn").addEventListener("click", () => {
  if (STATE.mode === "world") return;
  const city = STATE.cities.get(STATE.selectedCityId);
  if (!city || !STATE.using3D || !STATE.map3d) return;
  try {
    STATE.map3d.flyCameraTo({
      endCamera: {
        center: { lat: city.lat, lng: city.lon, altitude: city.view_altitude || 30 },
        range: city.view_range || 1500, tilt: city.view_tilt || 62, heading: 25,
      },
      durationMillis: 2000,
    });
  } catch {}
});

// =================================================================
// UTC CLOCK
// =================================================================
function updateClock() {
  const now = new Date();
  $("#utc-clock").textContent = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} UTC`;
}
setInterval(updateClock, 1000); updateClock();

// =================================================================
// TICK LOOP
// =================================================================

async function bootstrap() {
  const status = $("#conn-status"), text = $("#conn-text");
  try {
    const [camsR, citiesR] = await Promise.all([
      fetch("/cameras", { cache: "no-store" }),
      fetch("/cities", { cache: "no-store" }),
    ]);
    if (!camsR.ok) throw new Error(`/cameras ${camsR.status}`);
    const cams = await camsR.json();
    const cities = citiesR.ok ? await citiesR.json() : [];

    for (const c of cities) STATE.cities.set(c.city_id, c);
    for (const cam of cams) { cam.lng = cam.lon; STATE.cameras.set(cam.camera_id, cam); }

    recomputeCityState();
    recomputeCounters();
    status.className = "conn-dot online";
    text.textContent = "live";

    if (STATE.using3D) placeCityMarkers();

    $("#locator-coords").textContent = "GLOBAL · 0°N 0°W";
    $("#locator-sub").textContent = `${STATE.cameras.size} cameras · ${STATE.cities.size} cities`;

    const m = location.hash.match(/camera=([\w-]+)/);
    if (m) {
      const cam = STATE.cameras.get(m[1]);
      if (cam) { enterCity(cam.city_id); setTimeout(() => selectCamera(m[1]), 1500); }
    }
  } catch (e) {
    status.className = "conn-dot offline";
    text.textContent = "broker offline";
    console.error(e);
  }
}

async function tickOnce() {
  const ids = [...STATE.cameras.keys()];
  if (!ids.length) return;
  const cid = ids[STATE.tickCursor % ids.length];
  STATE.tickCursor = (STATE.tickCursor + 1) % ids.length;

  try {
    const r = await fetch(`/tick?camera=${encodeURIComponent(cid)}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`/tick ${r.status}`);
    const inc = await r.json();
    inc._receivedAt = Date.now();
    STATE.incidentById.set(inc.incident_id, inc);
    STATE.incidents.unshift(inc);
    if (STATE.incidents.length > 200) STATE.incidents.length = 200;

    const cam = STATE.cameras.get(inc.camera_id);
    if (cam) {
      cam.pin_color = inc.pin_color;
      cam.severity = inc.severity;
      cam.last_incident_id = inc.incident_id;
    }
    recomputeCityState();
    recomputeCounters();
    refreshCityPins();
    renderFeed();

    $("#conn-status").className = "conn-dot online";
    $("#conn-text").textContent = inc._meta?.mode === "gemini"
      ? `live · gemini ${inc._meta.latency_ms}ms`
      : "live · stub";

    if (!STATE.selectedCameraId && inc.severity !== "info") {
      // do not auto-enter city; let the user pick
    } else if (STATE.selectedCameraId === inc.camera_id) {
      renderIncident(inc);
      const sevEl = $("#d-sev"); sevEl.className = `sev-pill ${inc.severity}`; sevEl.textContent = inc.severity;
    }
  } catch (e) {
    $("#conn-status").className = "conn-dot offline";
    $("#conn-text").textContent = "reconnecting…";
    console.warn(e);
  }
}

function startTickLoop() {
  setInterval(tickOnce, TICK_MS);
  tickOnce();
}

// Back button (added dynamically below)
function ensureBackButton() {
  if ($("#back-btn")) return;
  const b = document.createElement("button");
  b.id = "back-btn";
  b.className = "back-btn";
  b.innerHTML = `<span>◀</span> back to world`;
  b.addEventListener("click", exitToWorld);
  document.querySelector(".map-section").appendChild(b);
}

// =================================================================
// BOOT
// =================================================================

(async () => {
  ensureBackButton();
  const ok = await loadMaps3D().catch(err => { console.warn(err); return false; });
  if (!ok) loadFallbackGlobe(STATE.fallbackReason);
  await bootstrap();
  startTickLoop();
})();
