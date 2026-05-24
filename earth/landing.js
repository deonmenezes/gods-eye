// ZECURITY landing — minimal interactivity
(function () {
  // Smooth scroll for in-page anchors
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href").slice(1);
      const el = document.getElementById(id);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // Tiny tilt on cam tiles (mouse only)
  const tiles = document.querySelectorAll(".cam-tile");
  tiles.forEach((tile) => {
    tile.addEventListener("mousemove", (e) => {
      const r = tile.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      tile.style.transform = `translate(-2px,-2px) rotate(${(x * 1.5).toFixed(2)}deg)`;
    });
    tile.addEventListener("mouseleave", () => {
      tile.style.transform = "";
    });
  });
})();
