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
console.log(`[sentinel build] wrote ${OUT}`);
