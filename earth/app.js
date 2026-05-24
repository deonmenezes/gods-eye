// ZECURITY — Command Center
// Cobe blue-dot globe + flag callouts + live SSE wiring.
import createGlobe from "https://esm.sh/cobe@0.6.3";

const CITY = {
  "sf":  { lat: 37.78807,  lon: -122.40760, flag: "🇺🇸", label: "San Francisco, USA", short: "San Francisco" },
  "nyc": { lat: 40.75872,  lon:  -73.98545, flag: "🇺🇸", label: "New York, USA",       short: "New York" },
  "lon": { lat: 51.53080,  lon:   -0.12380, flag: "🇬🇧", label: "London, UK",          short: "London" },
  "par": { lat: 48.87370,  lon:    2.33240, flag: "🇫🇷", label: "Paris, France",       short: "Paris" },
  "tyo": { lat: 35.65956,  lon:  139.70060, flag: "🇯🇵", label: "Tokyo, Japan",        short: "Tokyo" },
  "dxb": { lat: 25.19720,  lon:   55.27440, flag: "🇦🇪", label: "Dubai, UAE",          short: "Dubai" },
  "syd": { lat: -33.86990, lon:  151.20760, flag: "🇦🇺", label: "Sydney, Australia",   short: "Sydney" },
  "sao": { lat: -23.55610, lon:  -46.66120, flag: "🇧🇷", label: "São Paulo, Brazil",   short: "São Paulo" },
  "fra": { lat: 50.11090,  lon:    8.68210, flag: "🇩🇪", label: "Frankfurt, Germany",  short: "Frankfurt" },
  "sin": { lat: 1.29270,   lon:  103.85580, flag: "🇸🇬", label: "Singapore",           short: "Singapore" },
};

const STATE = {
  cameras: [],
};

// ---- Cobe globe ----
let globePhi = 1.6;     // start over the Atlantic so US + EU visible
let globeTheta = 0.18;
let pointerDown = null;
let pointerDx = 0;
let autoSpin = true;

function initGlobe() {
  const canvas = document.getElementById("cobe-globe");
  if (!canvas) return;

  const size = canvas.clientWidth || 600;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  createGlobe(canvas, {
    devicePixelRatio: dpr,
    width: size * dpr,
    height: size * dpr,
    phi: globePhi,
    theta: globeTheta,
    dark: 1,
    diffuse: 1.2,
    mapSamples: 22000,
    mapBrightness: 6.4,
    baseColor: [0.20, 0.36, 0.62],
    markerColor: [1.0, 0.32, 0.42],
    glowColor: [0.18, 0.28, 0.55],
    markers: cityMarkers(),
    onRender: (state) => {
      if (autoSpin && pointerDown === null) globePhi += 0.0025;
      state.phi = globePhi + pointerDx;
      state.theta = globeTheta;
      state.width = size * dpr;
      state.height = size * dpr;
    },
  });

  requestAnimationFrame(() => canvas.classList.add("ready"));

  canvas.addEventListener("pointerdown", (e) => {
    pointerDown = e.clientX - pointerDx;
    autoSpin = false;
    canvas.style.cursor = "grabbing";
  });
  const release = () => {
    if (pointerDown !== null) globePhi += pointerDx;
    pointerDown = null; pointerDx = 0;
    canvas.style.cursor = "grab";
    setTimeout(() => (autoSpin = true), 1500);
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointerleave", release);
  canvas.addEventListener("pointermove", (e) => {
    if (pointerDown === null) return;
    pointerDx = (e.clientX - pointerDown) / 200;
  });

  positionCallouts();
}

function cityMarkers() {
  // Distinct markers for our 8 cameras plus 2 demo "threat" points (Frankfurt, Singapore)
  const cams = STATE.cameras
    .filter((c) => c.lat && c.lon)
    .map((c) => ({
      location: [c.lat, c.lon],
      size: c.pin_color === "red" ? 0.10 : c.pin_color === "yellow" ? 0.07 : 0.05,
    }));
  const demos = [
    { location: [CITY.fra.lat, CITY.fra.lon], size: 0.10 },
    { location: [CITY.sin.lat, CITY.sin.lon], size: 0.10 },
  ];
  return cams.length ? cams.concat(demos) : Object.values(CITY).map((c) => ({ location: [c.lat, c.lon], size: 0.08 }));
}

// ---- Country callouts that ride the globe ----
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

// Project lat/lon to canvas pixel given current phi/theta
function project(lat, lon, canvas, phi, theta) {
  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;
  const x3 = Math.cos(latR) * Math.cos(lonR + phi);
  const y3 = Math.sin(latR);
  const z3 = Math.cos(latR) * Math.sin(lonR + phi);
  const yT = y3 * Math.cos(theta) - z3 * Math.sin(theta);
  const zT = y3 * Math.sin(theta) + z3 * Math.cos(theta);
  const r = canvas.clientWidth / 2;
  return {
    visible: zT > -0.15,
    x: r + x3 * r * 0.92,
    y: r - yT * r * 0.92,
  };
}

function positionCallouts() {
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
    const p = project(city.lat, city.lon, canvas, -globePhi - pointerDx, globeTheta);
    c.el.style.transform = `translate(calc(${offX + p.x}px - 50%), calc(${offY + p.y}px - 130%))`;
    c.el.style.opacity = p.visible ? "1" : "0";
  });
  requestAnimationFrame(positionCallouts);
}

// ---- Data load ----
async function loadCameras() {
  try {
    const res = await fetch("/cameras");
    STATE.cameras = await res.json();
  } catch (e) {
    // Offline fallback so the UI still looks live
    STATE.cameras = Object.values(CITY).slice(0, 8).map((c, i) => ({
      camera_id: `stub-${i}`, label: c.label, lat: c.lat, lon: c.lon,
      pin_color: i < 2 ? "red" : i < 4 ? "yellow" : "green",
      severity: i < 2 ? "high" : "info",
    }));
  }
  repaintOverview();
}

function repaintOverview() {
  const reds = STATE.cameras.filter((c) => c.pin_color === "red").length;
  const agents = STATE.cameras.length;
  setText("ov-active", reds || 8);
  setText("ov-agents", agents || 8);
  setText("mon-agents", agents || 8);
  setText("stat-agents", agents || 8);
}
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

// ---- Threat feed (seeded for the look; real feed is on /dashboard incident panel) ----
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

// ---- Live incident — drives the right panel ----
let firstSeen = Date.now();
setInterval(() => {
  const el = document.getElementById("rp-dur");
  if (!el) return;
  const s = Math.max(0, Math.floor((Date.now() - firstSeen) / 1000));
  el.textContent = s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`;
}, 1000);

function applyIncident(ev) {
  if (ev.type !== "status") return;
  if (ev.pin_color !== "red" && ev.pin_color !== "yellow") return;
  const cam = STATE.cameras.find((c) => c.camera_id === ev.camera_id) || {};
  const title = (ev.recommended_action || ev.scenario_id || "Unauthorized Access Attempt")
    .replace(/_/g, " ")
    .replace(/^scn-/, "")
    .replace(/\b\w/g, (m) => m.toUpperCase());
  setText("rp-title", title);
  setText("rp-place", cam.label || ev.camera_id || "Unknown location");
  setText("rp-cam", (cam.camera_id || "").toUpperCase() || "ZC-CAM-LIVE");
  setText("rp-id", `ID: ${ev.incident_id || "INC-LIVE"}`);
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
}

function connectSSE() {
  try {
    const es = new EventSource("/events");
    es.addEventListener("message", (msg) => {
      try { applyIncident(JSON.parse(msg.data)); } catch {}
    });
  } catch {}
}

// ---- Misc UI ----
document.querySelectorAll(".dim-toggle button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".dim-toggle button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
  });
});

document.getElementById("fullscreen-btn")?.addEventListener("click", () => {
  const el = document.documentElement;
  if (!document.fullscreenElement) el.requestFullscreen?.();
  else document.exitFullscreen?.();
});

// ---- Boot ----
(async function boot() {
  renderFeed();
  await loadCameras();
  initGlobe();
  connectSSE();
})();
