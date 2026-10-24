// Draws the app's icons, so no image editor is needed: the bridge glyph as menu-bar template images
// (assets/tray*Template.png, @1x and @2x) and the app icon (assets/icon.png, build/icon.icns on macOS).
// Shapes are signed-distance functions, supersampled 4×4 per pixel.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";

const root = path.join(import.meta.dirname, "..");
const assets = path.join(root, "assets");
const buildDir = path.join(root, "build");
mkdirSync(assets, { recursive: true });
mkdirSync(buildDir, { recursive: true });

// ---- PNG ----
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- Shapes (distance < 0 is inside) ----
const segment = (px, py, ax, ay, bx, by, width) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy) - width / 2;
};
const circle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;
const roundedBox = (px, py, cx, cy, half, radius) => {
  const qx = Math.abs(px - cx) - half + radius;
  const qy = Math.abs(py - cy) - half + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
};

// The bridge glyph in an 18×18 box: an arch over a deck, two hangers, two piers.
const ARCH = { cx: 9, cy: 11.16, r: 5.66 };
function bridge(x, y, stroke = 1.7) {
  const deck = segment(x, y, 2, 12.5, 16, 12.5, stroke);
  const ring = Math.abs(circle(x, y, ARCH.cx, ARCH.cy, ARCH.r)) - stroke / 2;
  const arch = y <= 12.5 ? ring : Infinity;
  const hangers = Math.min(
    segment(x, y, 6.25, 7, 6.25, 12.5, stroke * 0.7),
    segment(x, y, 11.75, 7, 11.75, 12.5, stroke * 0.7),
  );
  const piers = Math.min(segment(x, y, 4.5, 12.5, 4.5, 16, stroke), segment(x, y, 13.5, 12.5, 13.5, 16, stroke));
  return Math.min(deck, arch, hangers, piers);
}

/** Renders `shade(x, y)` → [r, g, b, a] (0–1, unpremultiplied) at `size` px, x/y in 0..size. */
function render(size, shade) {
  const out = Buffer.alloc(size * size * 4);
  const n = 4;
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < n; sy++)
        for (let sx = 0; sx < n; sx++) {
          const [cr, cg, cb, ca] = shade(px + (sx + 0.5) / n, py + (sy + 0.5) / n);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      const i = (py * size + px) * 4;
      out[i + 3] = Math.round((a / (n * n)) * 255);
      if (a > 0) {
        out[i] = Math.round((r / a) * 255);
        out[i + 1] = Math.round((g / a) * 255);
        out[i + 2] = Math.round((b / a) * 255);
      }
    }
  return out;
}

// ---- Menu-bar template images (black + alpha; macOS tints them) ----
const DOT = { x: 15.4, y: 3.4, r: 2.3 };
const trays = {
  tray: (x, y) => (bridge(x, y) < 0 ? 1 : 0),
  trayOff: (x, y) => (bridge(x, y) < 0 ? 0.45 : 0),
  trayDot: (x, y) => {
    if (circle(x, y, DOT.x, DOT.y, DOT.r) < 0) return 1;
    // A clear gap around the dot keeps it readable against the arch.
    if (circle(x, y, DOT.x, DOT.y, DOT.r + 1.2) < 0) return 0;
    return bridge(x, y) < 0 ? 1 : 0;
  },
};
for (const [name, alpha] of Object.entries(trays))
  for (const scale of [1, 2]) {
    const size = 18 * scale;
    const image = render(size, (x, y) => [0, 0, 0, alpha(x / scale, y / scale)]);
    writeFileSync(path.join(assets, `${name}Template${scale === 2 ? "@2x" : ""}.png`), png(size, image));
  }

// ---- App icon: Seleya's aurora (#8B5CF6 → #EC4899 → #38BDF8) on Apple's 824px grid, white bridge ----
const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
const STOPS = [
  [0, hex("#8B5CF6")],
  [0.55, hex("#EC4899")],
  [1, hex("#38BDF8")],
];
function aurora(t) {
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (t <= t1) return c0.map((c, k) => c + ((c1[k] - c) * (t - t0)) / (t1 - t0));
  }
  return STOPS.at(-1)[1];
}
const smooth = (edge, d) => Math.max(0, Math.min(1, 0.5 - d / edge));

function appIcon(size) {
  const s = size / 1024;
  const body = { c: 512, half: 412, radius: 185 };
  const glyphScale = 31 * s;
  return render(size, (px, py) => {
    const x = px / s;
    const y = py / s;
    const inside = roundedBox(x, y, body.c, body.c, body.half, body.radius);
    if (inside > 0) {
      // Soft shadow below the body.
      const shadow = roundedBox(x, y - 12, body.c, body.c, body.half, body.radius);
      return [0, 0, 0, 0.28 * Math.max(0, 1 - shadow / 28) * (shadow > 0 ? 1 : 0)];
    }
    const t = Math.max(0, Math.min(1, (x + y - 200) / 1648));
    let [r, g, b] = aurora(t);
    // Highlight from the top left, like the Seleya orb's shine.
    const shine = Math.max(0, 1 - Math.hypot(x - 330, y - 260) / 520) * 0.35;
    [r, g, b] = [r, g, b].map((c) => c + (1 - c) * shine);
    const gx = (px - size / 2) / glyphScale + 9;
    const gy = (py - size / 2) / glyphScale + 10.75;
    const glyph = smooth(1 / glyphScale, bridge(gx, gy, 1.5));
    [r, g, b] = [r, g, b].map((c) => c + (1 - c) * glyph);
    return [r, g, b, smooth(1 / s, inside)];
  });
}

writeFileSync(path.join(assets, "icon.png"), png(1024, appIcon(1024)));

if (process.platform === "darwin") {
  const work = mkdtempSync(path.join(tmpdir(), "seleya-icon-"));
  const iconset = path.join(work, "icon.iconset");
  mkdirSync(iconset);
  for (const base of [16, 32, 128, 256, 512])
    for (const scale of [1, 2]) {
      const size = base * scale;
      writeFileSync(
        path.join(iconset, `icon_${base}x${base}${scale === 2 ? "@2x" : ""}.png`),
        png(size, appIcon(size)),
      );
    }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(buildDir, "icon.icns")]);
  rmSync(work, { recursive: true, force: true });
}
console.log("icons written to assets/ and build/");
