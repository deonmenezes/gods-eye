// GODS EYE — All Cameras
// 125 synthetic cameras paginated 15/page over real local Veo clips.

const CLIPS = [
  "scn-shoplifting", "scn-crowd-surge", "scn-car-break-in", "scn-casing-behavior",
  "scn-loitering", "scn-normal-pedestrian", "scn-jaywalking", "scn-normal-parking",
  "scn-bag-snatch", "scn-fight",
];

const LOCATIONS = [
  { name: "Lobby Entrance",   loc: "New York, USA" },
  { name: "Parking Garage",   loc: "New York, USA" },
  { name: "Back Alley",       loc: "New York, USA" },
  { name: "Server Room",      loc: "New York, USA" },
  { name: "Office Floor 1",   loc: "New York, USA" },
  { name: "Emergency Exit",   loc: "New York, USA" },
  { name: "Loading Dock",     loc: "New York, USA" },
  { name: "Rooftop",          loc: "New York, USA" },
  { name: "Conference Room",  loc: "New York, USA" },
  { name: "Elevator Lobby",   loc: "New York, USA" },
  { name: "Hallway A",        loc: "New York, USA" },
  { name: "Retail Floor",     loc: "New York, USA" },
  { name: "Break Room",       loc: "New York, USA" },
  { name: "Main Entrance",    loc: "New York, USA" },
  { name: "Restricted Area",  loc: "New York, USA" },
];

const STATUS_RING = ["live","live","live","suspicious","live","live","live","live","live","live","alert","live","live","live","live"];

const PAGE_SIZE = 15;
const TOTAL = 125;

// Build all cameras up front (light objects)
const CAMERAS = Array.from({ length: TOTAL }, (_, i) => {
  const slot = i % 15;
  const meta = LOCATIONS[slot];
  const idx = String(i + 1).padStart(2, "0");
  // 10 of the first 15 should be live, 1 suspicious (slot 2), 1 alert (slot 10) — to match reference
  const status = i < 15 ? STATUS_RING[slot] : (Math.random() < 0.04 ? "alert" : Math.random() < 0.06 ? "suspicious" : "live");
  return {
    id: idx,
    name: `${idx} ${meta.name}`,
    loc: meta.loc,
    clip: CLIPS[i % CLIPS.length],
    status,
  };
});

const wall = document.getElementById("ftg-wall");
const searchEl = document.getElementById("ftg-search-input");
const colSelect = document.getElementById("ftg-cols");

let currentFilter = "all";
let currentSearch = "";
let currentPage = 1;

// ---- Apply filter + search + paginate ----
function visible(cam) {
  if (currentFilter === "all") return true;
  if (currentFilter === "live") return cam.status === "live";
  if (currentFilter === "nominal") return cam.status === "live";
  return cam.status === currentFilter;
}
function matches(cam) {
  if (!currentSearch) return true;
  const q = currentSearch.toLowerCase();
  return (cam.name + " " + cam.loc + " " + cam.clip).toLowerCase().includes(q);
}

function render() {
  const filtered = CAMERAS.filter((c) => visible(c) && matches(c));
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > pages) currentPage = pages;
  const from = (currentPage - 1) * PAGE_SIZE;
  const slice = filtered.slice(from, from + PAGE_SIZE);

  // Render tiles
  wall.innerHTML = "";
  slice.forEach((cam, i) => {
    const el = buildTile(cam, i);
    wall.appendChild(el);
  });

  // Update pagination text
  document.getElementById("pag-from").textContent = total === 0 ? 0 : (from + 1);
  document.getElementById("pag-to").textContent = Math.min(from + PAGE_SIZE, total);
  document.getElementById("pag-total").textContent = total;
}

function buildTile(cam, idx) {
  const el = document.createElement("article");
  el.className = `cam ${cam.status !== "live" ? cam.status : ""}`;
  el.dataset.status = cam.status;

  const pillLabel = cam.status === "alert" ? "ALERT"
                  : cam.status === "suspicious" ? "SUSPICIOUS"
                  : cam.status === "nominal" ? "NOMINAL"
                  : "LIVE";
  const pillClass = cam.status;

  el.innerHTML = `
    <div class="cam-thumb">
      <canvas class="cam-fallback" width="320" height="180"></canvas>
      <video muted loop playsinline preload="metadata" src="/clips/${cam.clip}.mp4"></video>
      <div class="cam-vignette"></div>
      <div class="cam-scan"></div>
      <span class="cam-pill ${pillClass}"><span class="dot dot-${
        pillClass === "alert" ? "red" :
        pillClass === "suspicious" ? "yellow" :
        pillClass === "nominal" ? "green" : "green"
      }"></span>${pillLabel}</span>
      <span class="cam-time" data-tile-time>--:--:-- --</span>
    </div>
    <div class="cam-meta">
      <div class="cam-meta-left">
        <h3 class="cam-name">${cam.name}</h3>
        <div class="cam-loc">${cam.loc}</div>
      </div>
      <div class="cam-meta-right">
        <span class="cam-status ${cam.status === "live" || cam.status === "nominal" ? "live" : cam.status}">
          <span class="dot dot-${cam.status === "alert" ? "red" : cam.status === "suspicious" ? "yellow" : "green"}"></span>${cam.status === "alert" ? "ALERT" : cam.status === "suspicious" ? "SUSP." : "LIVE"}
        </span>
        <button class="cam-menu" aria-label="More" onclick="event.stopPropagation()">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>
        </button>
      </div>
    </div>
  `;

  // Wire video + procedural fallback
  const video = el.querySelector("video");
  const canvas = el.querySelector(".cam-fallback");
  paintFallback(canvas, cam, idx);
  video.addEventListener("loadeddata", () => {
    el.classList.add("has-video");
    try { video.currentTime = Math.random() * Math.max(1, (video.duration || 4) - 0.5); } catch {}
    video.play().catch(() => {});
  });
  video.addEventListener("error", () => paintFallback(canvas, cam, idx));
  setTimeout(() => video.load(), idx * 60);

  el.addEventListener("click", () => { window.location.href = "/dashboard"; });

  return el;
}

// ---- Procedural CCTV-noise placeholder ----
function paintFallback(canvas, cam, seed) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  const hue = cam.status === "alert" ? 350 : cam.status === "suspicious" ? 42 : 215;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, `hsl(${hue}, 20%, 8%)`);
  grad.addColorStop(1, `hsl(${hue + 10}, 22%, 4%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let p = 0; p < d.length; p += 4) {
    const n = (Math.random() - 0.5) * 28;
    d[p] = Math.max(0, Math.min(255, d[p] + n));
    d[p+1] = Math.max(0, Math.min(255, d[p+1] + n));
    d[p+2] = Math.max(0, Math.min(255, d[p+2] + n));
  }
  ctx.putImageData(img, 0, 0);

  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, h * 0.66, w, h * 0.34);

  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.font = "bold 36px Sora, sans-serif";
  ctx.fillText(cam.id, 16, h - 14);
}

// ---- Clock for tile timestamps ----
function pad(n) { return String(n).padStart(2, "0"); }
function tickClock() {
  const d = new Date();
  const stamp = `${pad(((d.getHours() + 11) % 12 + 1))}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${d.getHours() >= 12 ? "PM" : "AM"}`;
  document.querySelectorAll("[data-tile-time]").forEach((el) => (el.textContent = stamp));
}
tickClock();
setInterval(tickClock, 1000);

// ---- Filter chips ----
document.querySelectorAll(".ftg-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".ftg-chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    currentPage = 1;
    render();
  });
});

// ---- Search ----
let searchT;
searchEl?.addEventListener("input", () => {
  clearTimeout(searchT);
  searchT = setTimeout(() => {
    currentSearch = searchEl.value.trim();
    currentPage = 1;
    render();
  }, 150);
});

// ⌘K shortcut to focus search
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    searchEl?.focus();
    searchEl?.select();
  }
});

// ---- Column count ----
colSelect?.addEventListener("change", () => {
  wall.dataset.cols = colSelect.value;
});

// ---- View toggle (grid only for now; list mode collapses tiles) ----
document.querySelectorAll(".view-btn").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".view-btn").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    wall.classList.toggle("as-list", b.dataset.view === "list");
  });
});

// ---- Pagination ----
const pagCtrl = document.getElementById("ftg-pag-ctrl");
pagCtrl?.addEventListener("click", (e) => {
  const tgt = e.target.closest("button");
  if (!tgt) return;
  const page = tgt.dataset.page;
  if (page === "prev") currentPage = Math.max(1, currentPage - 1);
  else if (page === "next") currentPage = Math.min(9, currentPage + 1);
  else if (page) currentPage = parseInt(page, 10);

  pagCtrl.querySelectorAll(".pg-num").forEach((b) => b.classList.toggle("active", parseInt(b.dataset.page, 10) === currentPage));
  pagCtrl.querySelectorAll(".pg-btn[data-page='prev']").forEach((b) => (b.disabled = currentPage === 1));
  pagCtrl.querySelectorAll(".pg-btn[data-page='next']").forEach((b) => (b.disabled = currentPage === 9));

  render();
  wall.scrollTop = 0;
});

// ---- AI summary toast ----
document.getElementById("ai-summary-btn")?.addEventListener("click", () => {
  const t = document.createElement("div");
  t.className = "ai-toast";
  t.innerHTML = `
    <div class="ai-toast-head"><span class="ai-sparkle">✦</span> AI Summary · last 24h</div>
    <div class="ai-toast-body">
      <p><strong>118 cameras online</strong> across 4 continents. <strong>3 incidents flagged critical</strong>:
      bag snatch attempt at <em>03 Back Alley</em>, unauthorized access at <em>15 Restricted Area</em>,
      and crowd surge at <em>06 Emergency Exit</em>.</p>
      <p>7 suspicious feeds under elevated watch. System uptime 99.98%. No agent regressions detected.</p>
    </div>
    <button class="ai-toast-close" aria-label="Dismiss">×</button>
  `;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  t.querySelector(".ai-toast-close").addEventListener("click", () => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 250);
  });
  setTimeout(() => {
    if (!t.isConnected) return;
    t.classList.remove("show");
    setTimeout(() => t.remove(), 250);
  }, 9000);
});

// Initial render
render();
