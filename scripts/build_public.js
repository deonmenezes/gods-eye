#!/usr/bin/env node
// Vercel build step: stage the static front-end into ./public.
// Copies earth/* and ensures index.html exists at the root.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "earth");
const OUT = path.join(ROOT, "public");

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

function copyTree(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyTree(path.join(src, entry), path.join(dst, entry));
    }
  } else {
    fs.copyFileSync(src, dst);
  }
}

copyTree(SRC, OUT);

// Also copy clips/ if present — pre-baked Veo MP4s served as static assets.
const CLIPS_SRC = path.join(ROOT, "clips");
if (fs.existsSync(CLIPS_SRC)) {
  const CLIPS_DST = path.join(OUT, "clips");
  fs.mkdirSync(CLIPS_DST, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(CLIPS_SRC)) {
    if (entry.endsWith(".mp4")) {
      fs.copyFileSync(path.join(CLIPS_SRC, entry), path.join(CLIPS_DST, entry));
      count++;
    }
  }
  console.log(`[sentinel build] copied ${count} Veo clip(s)`);
}

console.log(`[sentinel build] wrote ${OUT}`);
