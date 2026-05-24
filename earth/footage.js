// ZECURITY — All Footage live wall
// 12 tiles, each looping a local Veo clip (or a procedural placeholder
// if the clip is missing). Pure client-side; no broker dependency.

const CLIPS = [
  "scn-shoplifting",
  "scn-crowd-surge",
  "scn-car-break-in",
  "scn-casing-behavior",
  "scn-loitering",
  "scn-normal-pedestrian",
  "scn-jaywalking",
  "scn-normal-parking",
  "scn-bag-snatch",
  "scn-fight",
];

const FEEDS = [
  { num: "01", code: "SF-001", loc: "Union Square",         city: "San Francisco", clip: "scn-shoplifting",       status: "suspicious" },
  { num: "02", code: "NYC-001", loc: "Times Square",        city: "New York",      clip: "scn-crowd-surge",       status: "active" },
  { num: "03", code: "LON-001", loc: "King's Cross",        city: "London",        clip: "scn-car-break-in",      status: "active" },
  { num: "04", code: "PAR-001", loc: "Galeries Lafayette",  city: "Paris",         clip: "scn-casing-behavior",   status: "suspicious" },
  { num: "05", code: "TYO-001", loc: "Shibuya",             city: "Tokyo",         clip: "scn-loitering",         status: "nominal" },
  { num: "06", code: "DXB-001", loc: "Burj Khalifa",        city: "Dubai",         clip: "scn-normal-pedestrian", status: "nominal" },
  { num: "07", code: "SYD-001", loc: "Pitt Street Mall",    city: "Sydney",        clip: "scn-jaywalking",        status: "nominal" },
  { num: "08", code: "SAO-001", loc: "Av Paulista",         city: "São Paulo",     clip: "scn-normal-parking",    status: "nominal" },
  { num: "09", code: "SF-002",  loc: "Union Sq · Angle B",  city: "San Francisco", clip: "scn-bag-snatch",        status: "active" },
  { num: "10", code: "NYC-002", loc: "42nd St · Subway",    city: "New York",      clip: "scn-fight",             status: "nominal" },
  { num: "11", code: "LON-002", loc: "King's X · Platform", city: "London",        clip: "scn-loitering",         status: "nominal" },
  { num: "12", code: "TYO-002", loc: "Shibuya · ATM",       city: "Tokyo",         clip: "scn-normal-pedestrian", status: "nominal" },
];

const STATUS_LABEL = {
  nominal: "Nominal",
  suspicious: "Suspicious",
  active: "Active",
};

// ---- Build tiles ----
const wall = document.getElementById("ftg-wall");
const tiles = FEEDS.map((feed, i) => {
  const tile = document.createElement("article");
  tile.className = `ftg-tile ${feed.status === "active" ? "active-feed" : ""}`;
  tile.dataset.status = feed.status;
  tile.dataset.search = `${feed.loc} ${feed.city} ${feed.clip} ${feed.code}`.toLowerCase();

  tile.innerHTML = `
    <canvas class="ftg-fallback" width="320" height="180"></canvas>
    <video muted loop playsinline preload="metadata"
           poster=""
           src="/clips/${feed.clip}.mp4"></video>
    <div class="ftg-vignette"></div>
    <div class="ftg-scanlines"></div>
    <div class="ftg-chrome">
      <div class="ftg-chrome-top">
        <div class="ftg-rec"><span class="ftg-rec-dot"></span>REC</div>
        <div class="ftg-cam-id">${feed.code}</div>
        <div class="ftg-time" data-time>00:00:00</div>
      </div>
      <div class="ftg-chrome-bot">
        <div>
          <div class="ftg-loc">${feed.loc}</div>
          <div style="opacity:0.75;font-size:9.5px;letter-spacing:0.14em;text-transform:uppercase;">${feed.city}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="ftg-signal"><i></i><i></i><i></i><i></i></span>
          <span class="ftg-status ${feed.status}">
            <span class="ftg-status-dot"></span>${STATUS_LABEL[feed.status]}
          </span>
        </div>
      </div>
    </div>
  `;

  // Stagger video play to spread CPU
  const video = tile.querySelector("video");
  const canvas = tile.querySelector(".ftg-fallback");
  let videoOk = false;

  video.addEventListener("loadeddata", () => {
    videoOk = true;
    canvas.style.display = "none";
    // Start at a random offset so the wall doesn't feel synchronized
    try { video.currentTime = Math.random() * Math.max(1, (video.duration || 4) - 0.5); } catch {}
    video.play().catch(() => {});
  });
  video.addEventListener("error", () => paintFallback(canvas, feed, i));

  setTimeout(() => video.load(), i * 80);

  // Always paint the fallback once so something is on screen immediately
  paintFallback(canvas, feed, i);

  return { el: tile, feed };
});

tiles.forEach((t) => wall.appendChild(t.el));

// ---- Procedural CCTV-noise placeholder ----
function paintFallback(canvas, feed, seed) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;

  // Base wash hue per status
  const baseHue =
    feed.status === "active" ? 350 :
    feed.status === "suspicious" ? 42 : 215;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, `hsl(${baseHue}, 22%, 10%)`);
  grad.addColorStop(1, `hsl(${baseHue + 10}, 24%, 4%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Subtle noise
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let p = 0; p < d.length; p += 4) {
    const n = (Math.random() - 0.5) * 36;
    d[p] = Math.max(0, Math.min(255, d[p] + n));
    d[p+1] = Math.max(0, Math.min(255, d[p+1] + n));
    d[p+2] = Math.max(0, Math.min(255, d[p+2] + n));
  }
  ctx.putImageData(img, 0, 0);

  // Faux silhouette ground / horizon
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, h * 0.66, w, h * 0.34);

  // "Camera" label fade
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.font = "bold 40px Space Grotesk, sans-serif";
  ctx.fillText(feed.num, 18, h - 18);

  // Drifting horizontal scan line
  const sy = (Date.now() / 12 + seed * 20) % h;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.fillRect(0, sy, w, 1);
}

// Animate procedural canvases at low rate (for the ones still visible because video failed to load)
setInterval(() => {
  tiles.forEach((t, i) => {
    const v = t.el.querySelector("video");
    const c = t.el.querySelector(".ftg-fallback");
    if (!c || c.style.display === "none") return;
    if (v && !v.paused && !v.ended && v.readyState >= 2) {
      c.style.display = "none"; return;
    }
    paintFallback(c, t.feed, i);
  });
}, 250);

// ---- Topbar clock ----
const clockEl = document.getElementById("ftg-clock");
const timeEls = document.querySelectorAll("[data-time]");
function pad(n) { return String(n).padStart(2, "0"); }
function tickClock() {
  const d = new Date();
  const stamp = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
  if (clockEl) clockEl.textContent = stamp;
  const local = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  timeEls.forEach((el) => (el.textContent = local));
}
tickClock();
setInterval(tickClock, 1000);

// ---- Throughput jitter (placeholder) ----
const thru = document.getElementById("ftg-thru");
setInterval(() => {
  if (!thru) return;
  const fps = (24 + Math.random() * 2).toFixed(1);
  const mbps = (38 + Math.random() * 8).toFixed(1);
  thru.textContent = `${fps} fps · ${mbps} mbps`;
}, 1000);

// ---- Filter chips ----
document.querySelectorAll(".ftg-filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".ftg-filter").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const f = btn.dataset.filter;
    let visible = 0;
    tiles.forEach((t) => {
      const show = f === "all" || t.feed.status === f;
      t.el.classList.toggle("hidden", !show);
      if (show) visible++;
    });
    document.getElementById("ftg-count").textContent = `${visible} / 12 feeds online`;
  });
});

// ---- Search ----
const searchEl = document.getElementById("ftg-search");
if (searchEl) {
  searchEl.addEventListener("input", () => {
    const q = searchEl.value.trim().toLowerCase();
    let visible = 0;
    tiles.forEach((t) => {
      const show = !q || t.feed.search.includes(q) || t.feed.code.toLowerCase().includes(q);
      t.el.classList.toggle("hidden", !show);
      if (show) visible++;
    });
    document.getElementById("ftg-count").textContent = `${visible} / 12 feeds online`;
  });
}

// ---- Mute / pause / fullscreen ----
const muteBtn = document.getElementById("ftg-mute");
let muted = true;
muteBtn?.addEventListener("click", () => {
  muted = !muted;
  document.querySelectorAll(".ftg-tile video").forEach((v) => (v.muted = muted));
  muteBtn.textContent = muted ? "🔇 mute" : "🔊 sound";
  muteBtn.classList.toggle("active", !muted);
});

const pauseBtn = document.getElementById("ftg-pause");
let paused = false;
pauseBtn?.addEventListener("click", () => {
  paused = !paused;
  document.querySelectorAll(".ftg-tile video").forEach((v) => paused ? v.pause() : v.play().catch(()=>{}));
  pauseBtn.textContent = paused ? "▶ play all" : "⏸ pause all";
  pauseBtn.classList.toggle("active", paused);
});

document.getElementById("ftg-fullscreen")?.addEventListener("click", () => {
  const el = document.documentElement;
  if (!document.fullscreenElement) el.requestFullscreen?.();
  else document.exitFullscreen?.();
});

// ---- Last-incident readout (live, via broker SSE) ----
const lastEl = document.getElementById("ftg-last");
try {
  const es = new EventSource("/events");
  es.addEventListener("message", (msg) => {
    try {
      const data = JSON.parse(msg.data);
      if (data.type === "status" && data.recommended_action) {
        const t = new Date().toLocaleTimeString();
        lastEl.textContent = `${t} · ${data.camera_id} · ${data.severity}`;
      }
    } catch {}
  });
} catch {}

// ---- Tile click → jump to dashboard incident ----
tiles.forEach((t) => {
  t.el.addEventListener("click", () => {
    window.location.href = `/dashboard`;
  });
});
