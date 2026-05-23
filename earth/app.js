// Sentinel Earth canvas
// - Loads Photorealistic 3D Tiles via Google Maps JavaScript API (Map3DElement).
// - Falls back to a static-tile globe if the Maps API key is missing.
// - Subscribes to /events (SSE) for live status updates.

const cfg = window.SENTINEL_CONFIG || {};
const mapsApiKey = cfg.mapsApiKey;
const mapRoot = document.getElementById("map-root");

const STATE = {
  cameras: new Map(),
  pins: new Map(), // camera_id -> {el, marker3d}
  map3d: null,
  using3D: false,
};

// ---------- Map bootstrap ----------

async function loadMaps3D() {
  if (!mapsApiKey) return false;

  // Inject the Google Maps JS API loader.
  await new Promise((resolve, reject) => {
    if (window.google?.maps) return resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(mapsApiKey)}&v=alpha&libraries=maps3d,marker`;
    s.async = true; s.defer = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load Google Maps JS API"));
    document.head.appendChild(s);
  });

  // Wait for the maps3d library to register the custom element.
  try {
    await google.maps.importLibrary("maps3d");
  } catch (e) {
    console.warn("maps3d library unavailable", e);
    return false;
  }
  if (!customElements.get("gmp-map-3d")) {
    console.warn("gmp-map-3d not registered after import");
    return false;
  }

  const el = document.createElement("gmp-map-3d");
  el.setAttribute("center", "37.78807,-122.40760,420");
  el.setAttribute("tilt", "60");
  el.setAttribute("heading", "20");
  el.setAttribute("range", "1800");
  el.setAttribute("default-labels-disabled", "true");
  el.style.width = "100%"; el.style.height = "100%";
  mapRoot.appendChild(el);
  STATE.map3d = el;
  STATE.using3D = true;
  return true;
}

function loadFallbackGlobe() {
  // Lightweight 2D fallback: a CSS world map gradient + projected pins.
  const fallback = document.createElement("div");
  fallback.style.cssText = `
    width: 100%; height: 100%; position: relative;
    background:
      radial-gradient(ellipse at 30% 40%, rgba(90,169,255,0.15), transparent 55%),
      radial-gradient(ellipse at 70% 60%, rgba(47,209,122,0.10), transparent 60%),
      linear-gradient(180deg, #0a0e16, #050609 80%);
  `;
  const note = document.createElement("div");
  note.className = "fallback-notice";
  note.innerHTML = mapsApiKey
    ? "3D Tiles unavailable — using 2D fallback. Verify Map Tiles API + billing in Google Cloud Console."
    : "GOOGLE_MAPS_API_KEY not set in .env — using 2D fallback. Add the key to enable Photorealistic 3D Earth.";
  fallback.appendChild(note);

  const grid = document.createElement("div");
  grid.id = "fallback-grid";
  grid.style.cssText = `position:absolute; inset:0; pointer-events:none;`;
  fallback.appendChild(grid);
  mapRoot.appendChild(fallback);
  STATE.using3D = false;
}

// ---------- Pins ----------

function placePin(camera) {
  removePin(camera.camera_id);

  const el = document.createElement("div");
  el.className = `pin ${camera.pin_color || "green"}`;
  el.dataset.cameraId = camera.camera_id;

  let tooltip;
  el.addEventListener("mouseenter", () => {
    tooltip = document.createElement("div");
    tooltip.className = "pin-tooltip";
    tooltip.innerHTML = `<div>${camera.label}</div>
      <div class="small">${camera.zone_type || ""} · ${camera.severity || "info"}</div>`;
    el.parentElement.appendChild(tooltip);
    positionTooltip(tooltip, el);
  });
  el.addEventListener("mouseleave", () => {
    tooltip?.remove();
    tooltip = null;
  });
  el.addEventListener("click", () => openDetail(camera.camera_id));

  if (STATE.using3D && STATE.map3d && customElements.get("gmp-marker-3d-interactive")) {
    const m = document.createElement("gmp-marker-3d-interactive");
    m.setAttribute("position", `${camera.lat},${camera.lon},${camera.altitude || 15}`);
    m.setAttribute("altitude-mode", "relative-to-ground");
    m.appendChild(el);
    STATE.map3d.appendChild(m);
    STATE.pins.set(camera.camera_id, { el, marker3d: m });
  } else {
    // Fallback: project lat/lon to viewport using an equirectangular projection
    // centered on the same area as the 3D map default.
    const grid = document.getElementById("fallback-grid") || mapRoot;
    const { x, y } = projectFallback(camera.lat, camera.lon);
    el.style.position = "absolute";
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    el.style.pointerEvents = "auto";
    grid.appendChild(el);
    STATE.pins.set(camera.camera_id, { el });
  }
}

function projectFallback(lat, lon) {
  // Center on SF for the v0 demo so the 8 SF pins are visible without a real map.
  const centerLat = 37.7849, centerLon = -122.4094;
  const dLat = centerLat - lat;  // north is up
  const dLon = lon - centerLon;
  const scale = 800; // degrees -> percent multiplier (zoomed in)
  return {
    x: 50 + dLon * scale,
    y: 50 + dLat * scale,
  };
}

function positionTooltip(tooltip, anchor) {
  const r = anchor.getBoundingClientRect();
  tooltip.style.left = `${r.left + r.width / 2}px`;
  tooltip.style.top = `${r.top}px`;
  tooltip.style.position = "fixed";
}

function updatePin(cameraId, pinColor) {
  const rec = STATE.pins.get(cameraId);
  if (!rec) return;
  rec.el.classList.remove("red", "yellow", "green");
  rec.el.classList.add(pinColor);
}

function removePin(cameraId) {
  const rec = STATE.pins.get(cameraId);
  if (!rec) return;
  rec.el.remove();
  rec.marker3d?.remove();
  STATE.pins.delete(cameraId);
}

// ---------- Counters ----------

function recomputeCounters() {
  let r = 0, y = 0, g = 0;
  for (const c of STATE.cameras.values()) {
    if (c.pin_color === "red") r++;
    else if (c.pin_color === "yellow") y++;
    else g++;
  }
  document.getElementById("count-red").textContent = r;
  document.getElementById("count-yellow").textContent = y;
  document.getElementById("count-green").textContent = g;
}

// ---------- Detail panel ----------

async function openDetail(cameraId) {
  const cam = STATE.cameras.get(cameraId);
  if (!cam) return;
  const panel = document.getElementById("detail-panel");
  panel.classList.remove("hidden");
  document.getElementById("d-label").textContent = cam.label || cameraId;
  document.getElementById("d-cam").textContent = cameraId;
  document.getElementById("d-zone").textContent = cam.zone_type || "—";
  const sev = document.getElementById("d-sev");
  sev.className = `pill ${cam.severity || "info"}`;
  sev.textContent = cam.severity || "info";

  const dl = document.getElementById("d-deeplink");
  dl.value = `${location.origin}/#camera=${cameraId}`;

  // Prefer cached incident (Vercel has no server-side incident store).
  if (cam.last_incident_id && INCIDENT_CACHE.has(cam.last_incident_id)) {
    renderIncident(INCIDENT_CACHE.get(cam.last_incident_id));
    return;
  }
  if (cam.last_incident_id) {
    try {
      const r = await fetch(`/incidents/${cam.last_incident_id}`);
      if (r.ok) renderIncident(await r.json());
      else renderNoIncident();
    } catch {
      renderNoIncident();
    }
  } else {
    renderNoIncident();
  }
}

function renderNoIncident() {
  document.getElementById("d-action").textContent = "—";
  document.getElementById("d-clip").innerHTML = `<div class="clip-empty">no incident yet</div>`;
  document.getElementById("d-summary").textContent = "—";
  document.getElementById("d-findings").innerHTML = "";
  document.getElementById("d-trace").innerHTML = "";
}

function renderIncident(inc) {
  document.getElementById("d-action").textContent = inc.recommended_action || "—";
  const clip = document.getElementById("d-clip");
  const clipUri = inc.clip_uri || "";
  if (clipUri && /\.(mp4|webm)$/i.test(clipUri)) {
    clip.innerHTML = `<video controls autoplay muted loop src="${clipUri}"></video>`;
  } else {
    clip.innerHTML = `<div class="clip-placeholder">
      ${inc.notes?.includes("veo_refusal") ? "Veo content-policy refusal — fallback clip" : "Synthetic Veo clip (stub mode — no video bytes)"}
      <br/><br/>scenario: ${inc.scenario_id || "—"}<br/>hash: ${inc.clip_hash || "—"}
    </div>`;
  }
  document.getElementById("d-summary").textContent = inc.scene_summary || "—";

  const findings = document.getElementById("d-findings");
  findings.innerHTML = (inc.findings || []).map(f => `
    <li class="${f.fired ? "fired" : "silent"}">
      <span>${f.name}${f.fired ? "" : " (silent)"}</span>
      <span class="conf">${f.fired ? `conf ${f.confidence.toFixed(2)}` : ""}</span>
    </li>`).join("");

  const trace = document.getElementById("d-trace");
  trace.innerHTML = (inc.trace || []).map(t => {
    const isSkillFired = t.event === "skill_evaluated" && t.detail?.fired;
    const detail = t.detail ? ` — ${formatDetail(t.detail)}` : "";
    return `<li class="${isSkillFired ? "skill-fired" : ""}">
      <span class="t-time">${(t.t_ms / 1000).toFixed(2)}s</span>
      ${t.event}${detail}
    </li>`;
  }).join("");
}

function formatDetail(d) {
  if (!d) return "";
  const parts = Object.entries(d).map(([k, v]) => {
    if (typeof v === "number") return `${k}=${v}`;
    if (typeof v === "boolean") return `${k}=${v}`;
    if (typeof v === "string") return `${k}=${v.length > 40 ? v.slice(0, 40) + "…" : v}`;
    return `${k}=${JSON.stringify(v)}`;
  });
  return parts.join(", ");
}

document.getElementById("close-detail").addEventListener("click", () => {
  document.getElementById("detail-panel").classList.add("hidden");
});
document.getElementById("copy-link").addEventListener("click", () => {
  const v = document.getElementById("d-deeplink").value;
  navigator.clipboard?.writeText(v);
});
document.querySelectorAll(".actions .btn").forEach(b => {
  b.addEventListener("click", () => {
    // Record locally for now; broker can pick up later via /actions endpoint.
    console.log("operator action:", b.dataset.action);
  });
});

// ---------- Tick loop (polls /tick, replaces SSE on Vercel) ----------

const INCIDENT_CACHE = new Map(); // incident_id -> full incident json

async function bootstrap() {
  const status = document.getElementById("conn-status");
  const text = document.getElementById("conn-text");
  try {
    const r = await fetch("/cameras", { cache: "no-store" });
    if (!r.ok) throw new Error(`/cameras ${r.status}`);
    const cams = await r.json();
    for (const cam of cams) {
      STATE.cameras.set(cam.camera_id, cam);
      placePin(cam);
    }
    recomputeCounters();
    status.className = "conn-dot online";
    text.textContent = "live";
    const m = location.hash.match(/camera=([\w-]+)/);
    if (m) openDetail(m[1]);
  } catch (e) {
    status.className = "conn-dot offline";
    text.textContent = "broker offline";
    console.error(e);
  }
}

async function tickOnce() {
  const status = document.getElementById("conn-status");
  const text = document.getElementById("conn-text");
  // Round-robin through the cameras so every pin is visited.
  const ids = [...STATE.cameras.keys()];
  if (!ids.length) return;
  const cid = ids[STATE.tickCursor % ids.length];
  STATE.tickCursor = (STATE.tickCursor + 1) % ids.length;

  try {
    const r = await fetch(`/tick?camera=${encodeURIComponent(cid)}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`/tick ${r.status}`);
    const incident = await r.json();
    INCIDENT_CACHE.set(incident.incident_id, incident);
    const cam = STATE.cameras.get(incident.camera_id);
    if (cam) {
      cam.pin_color = incident.pin_color;
      cam.severity = incident.severity;
      cam.last_incident_id = incident.incident_id;
    }
    updatePin(incident.camera_id, incident.pin_color);
    recomputeCounters();
    status.className = "conn-dot online";
    text.textContent = incident._meta?.mode === "gemini"
      ? `live · gemini ${incident._meta.latency_ms}ms`
      : "live · stub";

    const panel = document.getElementById("detail-panel");
    if (!panel.classList.contains("hidden")
        && document.getElementById("d-cam").textContent === incident.camera_id) {
      renderIncident(incident);
      document.getElementById("d-sev").className = `pill ${incident.severity}`;
      document.getElementById("d-sev").textContent = incident.severity;
    }
  } catch (e) {
    status.className = "conn-dot offline";
    text.textContent = "reconnecting…";
    console.warn(e);
  }
}

function startTickLoop() {
  STATE.tickCursor = 0;
  const interval = (cfg.tickIntervalMs && Number(cfg.tickIntervalMs)) || 4000;
  setInterval(tickOnce, interval);
}

// ---------- Boot ----------

(async () => {
  const ok = await loadMaps3D().catch(err => { console.warn(err); return false; });
  if (!ok) loadFallbackGlobe();
  await bootstrap();
  startTickLoop();
})();
