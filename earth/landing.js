// ZECURITY landing — dark globe hero
import createGlobe from "https://esm.sh/cobe@0.6.3";

const CAMERAS = [
  { id: "01", label: "UNION SQ · SAN FRANCISCO", location: [37.78807, -122.40760] },
  { id: "02", label: "TIMES SQ · NEW YORK",      location: [40.75872,  -73.98545] },
  { id: "03", label: "KING'S CROSS · LONDON",     location: [51.53080,   -0.12380] },
  { id: "04", label: "LAFAYETTE · PARIS",         location: [48.87370,    2.33240] },
  { id: "05", label: "SHIBUYA · TOKYO",           location: [35.65956,  139.70060] },
  { id: "06", label: "BURJ KHALIFA · DUBAI",      location: [25.19720,   55.27440] },
  { id: "07", label: "PITT ST MALL · SYDNEY",     location: [-33.86990, 151.20760] },
  { id: "08", label: "AV PAULISTA · SÃO PAULO",   location: [-23.55610,  -46.66120] },
];

function initGlobe() {
  const canvas = document.getElementById("cobe-globe");
  if (!canvas) return;

  let phi = 0;
  let theta = 0.18;
  let pointerInteracting = null;
  let pointerInteractionMovement = 0;
  let autoRotate = true;

  // Use rendered (CSS) size for sharpness; cap DPR for perf.
  const size = Math.max(canvas.clientWidth, 320);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const globe = createGlobe(canvas, {
    devicePixelRatio: dpr,
    width: size * dpr,
    height: size * dpr,
    phi: 0,
    theta: theta,
    dark: 1,
    diffuse: 1.4,
    mapSamples: 18000,
    mapBrightness: 5.5,
    baseColor: [0.32, 0.36, 0.46],
    markerColor: [255 / 255, 122 / 255, 216 / 255], // pink markers
    glowColor: [0.6, 0.55, 0.95],
    markers: CAMERAS.map((c) => ({ location: c.location, size: 0.06 })),
    onRender: (state) => {
      if (autoRotate) phi += 0.0035;
      state.phi = phi + pointerInteractionMovement;
      state.theta = theta;
      state.width = size * dpr;
      state.height = size * dpr;
    },
  });

  requestAnimationFrame(() => canvas.classList.add("ready"));

  // Drag to rotate
  canvas.addEventListener("pointerdown", (e) => {
    pointerInteracting = e.clientX - pointerInteractionMovement;
    canvas.style.cursor = "grabbing";
    autoRotate = false;
  });
  canvas.addEventListener("pointerup", () => {
    pointerInteracting = null;
    canvas.style.cursor = "grab";
    setTimeout(() => { autoRotate = true; }, 1200);
  });
  canvas.addEventListener("pointerout", () => {
    pointerInteracting = null;
    canvas.style.cursor = "grab";
    setTimeout(() => { autoRotate = true; }, 1200);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pointerInteracting !== null) {
      pointerInteractionMovement = (e.clientX - pointerInteracting) / 200;
    }
  });

  // Cycle the readout city below the globe
  const readout = document.getElementById("readout-city");
  if (readout) {
    let idx = 0;
    setInterval(() => {
      idx = (idx + 1) % CAMERAS.length;
      readout.textContent = CAMERAS[idx].label;
    }, 2400);
  }

  return globe;
}

// Smooth scroll for in-page anchors
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href").slice(1);
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

// Subtle scroll-reveal on cards
function initReveal() {
  const targets = document.querySelectorAll(".card, .agent-card, .cam-tile");
  if (!("IntersectionObserver" in window)) {
    targets.forEach((el) => (el.style.opacity = "1"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.style.transition = "opacity 0.6s ease, transform 0.6s ease";
          entry.target.style.opacity = "1";
          entry.target.style.transform = "translateY(0)";
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  targets.forEach((el) => {
    el.style.opacity = "0";
    el.style.transform = "translateY(14px)";
    io.observe(el);
  });
}

initGlobe();
initSmoothScroll();
initReveal();
