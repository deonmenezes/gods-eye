// Sentinel — Earth canvas command center
//
// Layout: 3-column. Left feed (live incidents) | center 3D map | right detail.
// Pins are rendered on a CSS overlay layer above the 3D Map element. We project
// each camera's lat/lon to viewport pixels via gmp-map-3d's camera projection
// (with a 2D equirectangular fallback when 3D isn't available).

const cfg = window.SENTINEL_CONFIG || {};
const mapsApiKey = cfg.mapsApiKey;
const TICK_MS = (cfg.tickIntervalMs && Number(cfg.tickIntervalMs)) || 4000;

const SF = { lat: 37.78807, lng: -122.40760, altitude: 30 };

const STATE = {
  cameras: new Map(), // camera_id -> latest state
  pins: new Map(),    // camera_id -> { el }
  incidents: [],      // history (newest first)
  incidentById: new Map(),
  selectedCameraId: null,
  feedFilter: "all",
  using3D: false,
  map3d: null,
  fallbackReason: null,
  orbitOn: true,
  tickCursor: 0,
};

const $ = (sel) => document.querySelector(sel);
const mapRoot = $("#map-root");
const pinOverlay = $("#pin-overlay");

// =================================================================
// 3D MAP BOOT
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
    console.warn("[sentinel] Map Tiles preflight failed:", pre.reason);
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

  try {
    await google.maps.importLibrary("maps3d");
  } catch (e) {
    console.warn("maps3d library unavailable", e);
    return false;
  }
  if (!customElements.get("gmp-map-3d")) return false;

  const el = document.createElement("gmp-map-3d");
  el.style.width = "100%";
  el.style.height = "100%";
  el.setAttribute("default-labels-disabled", "false");
  mapRoot.appendChild(el);

  // Set camera via the element's API (more reliable than attributes).
  const setCamera = () => {
    try {
      el.center = { lat: SF.lat, lng: SF.lng, altitude: SF.altitude };
      el.range = 1400;
      el.tilt = 62;
      el.heading = 25;
    } catch (e) { console.warn("camera set failed", e); }
  };
  // First attempt immediately, then once the element is ready.
  setCamera();
  el.addEventListener("gmp-load", setCamera);
  el.addEventListener("gmp-error", (ev) => swapToFallback(`gmp-error: ${ev?.detail?.message || "unknown"}`));

  STATE.map3d = el;
  STATE.using3D = true;
  setTimeout(() => { if (STATE.using3D) startOrbit(); }, 1500);
  return true;
}

function swapToFallback(reason) {
  if (STATE.map3d) { STATE.map3d.remove(); STATE.map3d = null; }
  STATE.using3D = false;
  STATE.fallbackReason = reason;
  loadFallbackGlobe(reason);
  for (const cam of STATE.cameras.values()) projectPin(cam);
}

function loadFallbackGlobe(reason) {
  mapRoot.innerHTML = "";
  const fallback = document.createElement("div");
  fallback.style.cssText = `
    width: 100%; height: 100%; position: relative;
    background:
      radial-gradient(ellipse 50% 40% at 50% 50%, rgba(90,169,255,0.18), transparent 65%),
      radial-gradient(ellipse 30% 30% at 30% 60%, rgba(47,209,122,0.10), transparent 55%),
      linear-gradient(180deg, #0a0e16 0%, #050608 100%);
  `;
  const note = document.createElement("div");
  note.className = "fallback-notice";
  note.textContent = reason
    ? `2D fallback · ${reason}`
    : (mapsApiKey ? "3D Tiles unavailable — using 2D fallback." : "GOOGLE_MAPS_API_KEY not set — using 2D fallback.");
  fallback.appendChild(note);
  // SF area overlay
  const sfLabel = document.createElement("div");
  sfLabel.style.cssText = `
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    font-family: "JetBrains Mono", monospace; font-size: 13px;
    color: rgba(255,255,255,0.25); letter-spacing: 0.2em;
  `;
  sfLabel.textContent = "SAN FRANCISCO";
  fallback.appendChild(sfLabel);
  mapRoot.appendChild(fallback);
}

// Periodically rotate the camera around SF when 3D is up. Pure flair.
let orbitRaf = null;
function startOrbit() {
  if (!STATE.using3D || !STATE.map3d || !STATE.orbitOn) return;
  let lastT = performance.now();
  let heading = 25;
  const step = (now) => {
    const dt = (now - lastT) / 1000;
    lastT = now;
    if (!STATE.orbitOn || !STATE.using3D) { orbitRaf = null; return; }
    heading = (heading + dt * 3) % 360;
    try { STATE.map3d.heading = heading; } catch {}
    projectAllPins();
    orbitRaf = requestAnimationFrame(step);
  };
  orbitRaf = requestAnimationFrame(step);
}

// =================================================================
// PIN OVERLAY
// =================================================================

const SF_VIEW_BOUNDS = { latRange: 0.05, lngRange: 0.06 };

function projectPin(camera) {
  let rec = STATE.pins.get(camera.camera_id);
  if (!rec) {
    const el = document.createElement("div");
    el.className = `pin ${camera.pin_color || "green"}`;
    el.dataset.cameraId = camera.camera_id;
    el.addEventListener("mouseenter", (e) => showTooltip(camera, e.currentTarget));
    el.addEventListener("mouseleave", hideTooltip);
    el.addEventListener("click", () => selectCamera(camera.camera_id));
    pinOverlay.appendChild(el);
    rec = { el };
    STATE.pins.set(camera.camera_id, rec);
  }
  rec.el.className = `pin ${camera.pin_color || "green"}`
    + (STATE.selectedCameraId === camera.camera_id ? " selected" : "");

  const rect = pinOverlay.getBoundingClientRect();
  let x, y;
  if (STATE.using3D && STATE.map3d) {
    // 3D map projection: simplified — center the SF cluster around viewport
    // center and offset by lat/lon delta + camera heading rotation.
    const dLat = camera.lat - SF.lat;
    const dLng = camera.lng - SF.lng;
    const heading = (STATE.map3d.heading || 0) * Math.PI / 180;
    const cos = Math.cos(heading), sin = Math.sin(heading);
    const sx = dLng * 6000;  // scale degrees -> pixels (heuristic)
    const sy = dLat * 6000;
    x = rect.width / 2 + (sx * cos - sy * sin);
    y = rect.height / 2 - (sx * sin + sy * cos) * 0.8; // 0.8 for tilt foreshortening
  } else {
    // Equirectangular fallback over SF area.
    const dLng = (camera.lng - SF.lng) / SF_VIEW_BOUNDS.lngRange;
    const dLat = (SF.lat - camera.lat) / SF_VIEW_BOUNDS.latRange;
    x = rect.width / 2 + dLng * (rect.width * 0.35);
    y = rect.height / 2 + dLat * (rect.height * 0.35);
  }
  rec.el.style.left = `${x}px`;
  rec.el.style.top = `${y}px`;
}

function projectAllPins() {
  for (const cam of STATE.cameras.values()) projectPin(cam);
}

let tooltipEl = null;
function showTooltip(camera, anchor) {
  hideTooltip();
  const r = anchor.getBoundingClientRect();
  const tt = document.createElement("div");
  tt.className = "pin-tooltip";
  tt.innerHTML = `
    <div class="pt-label">${camera.label}</div>
    <div class="pt-sub">${camera.camera_id} · ${camera.zone_type || ""} · ${camera.severity || "info"}</div>
  `;
  tt.style.left = `${r.left + r.width / 2}px`;
  tt.style.top = `${r.top}px`;
  document.body.appendChild(tt);
  tooltipEl = tt;
}
function hideTooltip() { tooltipEl?.remove(); tooltipEl = null; }

window.addEventListener("resize", projectAllPins);

// =================================================================
// COUNTERS
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

// =================================================================
// INCIDENT FEED (LEFT)
// =================================================================

function renderFeed() {
  const list = $("#feed-list");
  const filtered = STATE.incidents.filter(inc => {
    if (STATE.feedFilter === "all") return true;
    return inc.pin_color === STATE.feedFilter;
  });
  list.innerHTML = filtered.slice(0, 50).map(inc => feedCardHtml(inc)).join("");
  for (const card of list.querySelectorAll(".feed-card")) {
    card.addEventListener("click", () => selectCamera(card.dataset.cameraId, card.dataset.incidentId));
  }
  $("#feed-meta").textContent = `${STATE.incidents.length} events · ${filtered.length} shown`;
}

function feedCardHtml(inc) {
  const sel = STATE.selectedCameraId === inc.camera_id ? "selected" : "";
  const cam = STATE.cameras.get(inc.camera_id) || {};
  const ago = relativeTime(inc._receivedAt);
  return `
    <div class="feed-card ${inc.pin_color} ${sel}"
         data-camera-id="${inc.camera_id}"
         data-incident-id="${inc.incident_id}">
      <div class="fc-row1">
        <div class="fc-label">${escapeHtml(cam.label || inc.camera_id)}</div>
        <div class="fc-time">${ago}</div>
      </div>
      <div class="fc-row2">
        <div class="fc-zone">${escapeHtml(cam.zone_type || "—")}</div>
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

setInterval(() => { renderFeed(); renderRoster(); }, 5000);

document.addEventListener("click", e => {
  const tab = e.target.closest(".feed-tab");
  if (!tab) return;
  document.querySelectorAll(".feed-tab").forEach(t => t.classList.toggle("active", t === tab));
  STATE.feedFilter = tab.dataset.filter;
  renderFeed();
});

function renderRoster() {
  const roster = $("#feed-roster");
  if (!roster) return;
  const reds = [...STATE.cameras.values()].filter(c => c.pin_color === "red").length;
  const total = STATE.cameras.size;
  roster.textContent = `${total - reds} / ${total} ok`;
}

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

  // Background: rolling vertical gradient + faint scan noise
  cctvCtx.fillStyle = "#04060a";
  cctvCtx.fillRect(0, 0, w, h);

  // Subtle floor grid suggesting a CCTV-style scene
  cctvCtx.strokeStyle = `rgba(40, 90, 160, 0.18)`;
  cctvCtx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const y = h * 0.55 + i * (h * 0.07);
    cctvCtx.beginPath(); cctvCtx.moveTo(0, y); cctvCtx.lineTo(w, y); cctvCtx.stroke();
  }
  for (let i = -4; i <= 4; i++) {
    const x0 = w / 2;
    const yTop = h * 0.55;
    const yBot = h;
    const xt = x0 + i * 60 * (yTop / yBot);
    const xb = x0 + i * 60;
    cctvCtx.beginPath(); cctvCtx.moveTo(xt, yTop); cctvCtx.lineTo(xb, yBot); cctvCtx.stroke();
  }

  // Actors based on severity
  drawActors(w, h);

  // Top ambient haze
  const grad = cctvCtx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(20, 30, 60, 0.45)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  cctvCtx.fillStyle = grad;
  cctvCtx.fillRect(0, 0, w, h);

  // Scan lines
  cctvCtx.globalAlpha = 0.06;
  for (let y = 0; y < h; y += 3) {
    cctvCtx.fillStyle = "#ffffff";
    cctvCtx.fillRect(0, y, w, 1);
  }
  cctvCtx.globalAlpha = 1;

  // Animated noise
  const noiseDensity = cctvSeverity === "critical" ? 600 : (cctvSeverity === "high" ? 400 : 200);
  cctvCtx.fillStyle = "rgba(255,255,255,0.08)";
  for (let i = 0; i < noiseDensity; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    cctvCtx.fillRect(x, y, 1, 1);
  }

  // Severity tint
  if (cctvSeverity === "critical" || cctvSeverity === "high") {
    cctvCtx.fillStyle = `rgba(255, 57, 86, ${0.04 + Math.sin(cctvTime * 8) * 0.02})`;
    cctvCtx.fillRect(0, 0, w, h);
  } else if (cctvSeverity === "medium" || cctvSeverity === "low") {
    cctvCtx.fillStyle = "rgba(255, 200, 59, 0.03)";
    cctvCtx.fillRect(0, 0, w, h);
  }

  // Update timecode
  const now = new Date();
  $("#cctv-time").textContent = `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;

  requestAnimationFrame(cctvFrame);
}

function pad(n) { return String(n).padStart(2, "0"); }

function drawActors(w, h) {
  // Render 1–2 "subjects" that move horizontally. Scenario type changes behavior.
  const scenario = cctvScenarioId || "";
  const t = cctvTime;
  const isWeapon = scenario.includes("armed") || scenario.includes("weapon");
  const isForced = scenario.includes("forced") || scenario.includes("pry");
  const isLoiter = scenario.includes("loiter");
  const isClear = !isWeapon && !isForced && !isLoiter && scenario;

  const ground = h * 0.78;

  if (isLoiter) {
    // One subject lingers near a structure (ATM box)
    cctvCtx.fillStyle = "rgba(140, 150, 170, 0.7)";
    cctvCtx.fillRect(w * 0.22, ground - 80, 90, 80); // ATM box
    cctvCtx.fillStyle = "rgba(60, 70, 90, 0.4)";
    cctvCtx.fillRect(w * 0.22 + 10, ground - 70, 70, 30); // screen
    drawSubject(w * 0.45 + Math.sin(t * 0.6) * 10, ground, "#c4d0e5");
  } else if (isForced) {
    // Two subjects at a door
    cctvCtx.fillStyle = "rgba(80, 80, 90, 0.7)";
    cctvCtx.fillRect(w * 0.42, ground - 110, 80, 110); // door
    cctvCtx.fillStyle = "rgba(40, 40, 50, 0.9)";
    cctvCtx.fillRect(w * 0.48, ground - 70, 4, 6); // doorknob
    drawSubject(w * 0.55, ground, "#a8b5c8");
    drawSubject(w * 0.36, ground - 4, "#9da9bc");
    // Crowbar
    cctvCtx.strokeStyle = "rgba(220, 220, 220, 0.7)";
    cctvCtx.lineWidth = 2;
    cctvCtx.beginPath();
    cctvCtx.moveTo(w * 0.5, ground - 60);
    cctvCtx.lineTo(w * 0.43, ground - 50);
    cctvCtx.stroke();
  } else if (isWeapon) {
    // Counter + clerk + subject with handgun (small marker)
    cctvCtx.fillStyle = "rgba(80, 90, 110, 0.6)";
    cctvCtx.fillRect(0, ground - 30, w * 0.55, 30); // counter
    drawSubject(w * 0.30, ground - 32, "#b8c2d8");  // clerk (hands up shape)
    cctvCtx.fillStyle = "#b8c2d8";
    cctvCtx.beginPath(); // clerk hands raised
    cctvCtx.arc(w * 0.30 - 14, ground - 80, 5, 0, Math.PI * 2);
    cctvCtx.arc(w * 0.30 + 14, ground - 80, 5, 0, Math.PI * 2);
    cctvCtx.fill();
    drawSubject(w * 0.62, ground, "#a0aac0");       // robber
    // Handgun blip
    cctvCtx.fillStyle = "rgba(255, 80, 80, 0.85)";
    cctvCtx.fillRect(w * 0.55, ground - 56, 6, 4);
  } else if (isClear) {
    // Commuters walking
    const x1 = (t * 30) % (w + 80) - 40;
    const x2 = ((t + 4) * 22) % (w + 100) - 50;
    drawSubject(x1, ground, "#a8b5c8");
    drawSubject(w - x2, ground - 6, "#9eaabd");
  } else {
    // Generic empty scene
    drawSubject(w * 0.5 + Math.sin(t * 0.4) * 40, ground, "#a0aac0");
  }
}

function drawSubject(x, y, color) {
  // simple human silhouette: head + body
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
// DETAIL PANEL
// =================================================================

function selectCamera(cameraId, incidentId) {
  STATE.selectedCameraId = cameraId;
  const cam = STATE.cameras.get(cameraId);
  if (!cam) return;
  // Re-render pins for selection styling
  for (const c of STATE.cameras.values()) projectPin(c);
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
  cctvScenarioId = null;
  cctvSeverity = "info";
}

function renderIncident(inc) {
  cctvScenarioId = inc.scenario_id || "";
  cctvSeverity = inc.severity || "info";

  $("#cctv-cam-id").textContent = inc.camera_id;
  $("#cctv-scenario").textContent = (inc.scenario_id || "").replace(/^scn-/, "");
  $("#cctv-tag").textContent = (inc._meta?.mode === "gemini")
    ? `VEO 3.1 · synthetic · gemini ${inc._meta.latency_ms}ms`
    : "VEO 3.1 · synthetic · stub";

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
      </li>
    `;
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

document.querySelectorAll(".detail-actions .action-btn").forEach(b => {
  b.addEventListener("click", () => {
    b.style.transform = "scale(0.96)";
    setTimeout(() => b.style.transform = "", 120);
  });
});
$("#copy-link").addEventListener("click", () => {
  navigator.clipboard?.writeText($("#d-deeplink").value);
  const b = $("#copy-link"); const orig = b.textContent;
  b.textContent = "copied"; setTimeout(() => b.textContent = orig, 1200);
});

$("#orbit-toggle").addEventListener("click", () => {
  STATE.orbitOn = !STATE.orbitOn;
  $("#orbit-toggle").classList.toggle("active", STATE.orbitOn);
  if (STATE.orbitOn) startOrbit();
});
$("#recenter-btn").addEventListener("click", () => {
  if (!STATE.using3D || !STATE.map3d) return;
  try {
    STATE.map3d.center = { lat: SF.lat, lng: SF.lng, altitude: SF.altitude };
    STATE.map3d.range = 1400;
    STATE.map3d.tilt = 62;
  } catch {}
});

// =================================================================
// UTC CLOCK
// =================================================================
function updateClock() {
  const now = new Date();
  $("#utc-clock").textContent = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} UTC`;
}
setInterval(updateClock, 1000);
updateClock();

// =================================================================
// TICK LOOP
// =================================================================

async function bootstrap() {
  const status = $("#conn-status");
  const text = $("#conn-text");
  try {
    const r = await fetch("/cameras", { cache: "no-store" });
    if (!r.ok) throw new Error(`/cameras ${r.status}`);
    const cams = await r.json();
    for (const cam of cams) {
      // map.lng for our internal use; server gives .lon
      cam.lng = cam.lon;
      STATE.cameras.set(cam.camera_id, cam);
      projectPin(cam);
    }
    recomputeCounters();
    renderRoster();
    status.className = "conn-dot online";
    text.textContent = "live";
    const m = location.hash.match(/camera=([\w-]+)/);
    if (m) selectCamera(m[1]);
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
      projectPin(cam);
    }
    recomputeCounters();
    renderRoster();
    renderFeed();

    $("#conn-status").className = "conn-dot online";
    $("#conn-text").textContent = inc._meta?.mode === "gemini"
      ? `live · gemini ${inc._meta.latency_ms}ms`
      : "live · stub";

    // Auto-select the first non-info incident so the right panel populates.
    if (!STATE.selectedCameraId && inc.severity !== "info") {
      selectCamera(inc.camera_id, inc.incident_id);
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
  tickOnce(); // first tick immediately
}

// =================================================================
// BOOT
// =================================================================

(async () => {
  const ok = await loadMaps3D().catch(err => { console.warn(err); return false; });
  if (!ok) loadFallbackGlobe(STATE.fallbackReason);
  await bootstrap();
  startTickLoop();
})();
