import * as THREE from "three";

/* ------------------------------------------------------------------ *
 *  Procedural PBR texture library (albedo + tangent normal + roughness)
 *  All textures are tileable and baked once at startup on canvases.
 * ------------------------------------------------------------------ */

function hash(x: number, y: number, s: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, px: number, py: number, s: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px;
  const y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
  const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Tileable fractal noise, u/v in [0,1), integer base frequencies. */
export function fbm(u: number, v: number, fx: number, oct = 4, s = 0, fy = fx) {
  let a = 0, amp = 0.5, tot = 0;
  let cx = fx, cy = fy;
  for (let o = 0; o < oct; o++) {
    a += amp * vnoise(u * cx, v * cy, cx, cy, s + o * 17);
    tot += amp;
    amp *= 0.5;
    cx *= 2;
    cy *= 2;
  }
  return a / tot;
}

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Px { h: number; r: number; g: number; b: number; rough: number }
export interface TexSet { map: THREE.CanvasTexture; normalMap: THREE.CanvasTexture; roughnessMap: THREE.CanvasTexture }

function finish(c: HTMLCanvasElement, srgb: boolean) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function toCanvas(size: number, data: Uint8ClampedArray) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const id = new ImageData(new Uint8ClampedArray(data), size, size);
  ctx.putImageData(id, 0, 0);
  return c;
}

function bake(size: number, gen: (u: number, v: number, o: Px) => void, normalStrength: number): TexSet {
  const n = size * size;
  const H = new Float32Array(n);
  const col = new Uint8ClampedArray(n * 4);
  const rgh = new Uint8ClampedArray(n * 4);
  const px: Px = { h: 0, r: 0, g: 0, b: 0, rough: 0.8 };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      gen((x + 0.5) / size, (y + 0.5) / size, px);
      H[i] = px.h;
      col[i * 4] = px.r * 255;
      col[i * 4 + 1] = px.g * 255;
      col[i * 4 + 2] = px.b * 255;
      col[i * 4 + 3] = 255;
      const r = px.rough * 255;
      rgh[i * 4] = r; rgh[i * 4 + 1] = r; rgh[i * 4 + 2] = r; rgh[i * 4 + 3] = 255;
    }
  }
  const nor = new Uint8ClampedArray(n * 4);
  const m = size - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = (x - 1) & m, xr = (x + 1) & m, yu = (y - 1) & m, yd = (y + 1) & m;
      const dx = (H[y * size + xr] - H[y * size + xl]) * normalStrength;
      const dy = (H[yd * size + x] - H[yu * size + x]) * normalStrength;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      nor[i] = (nx * 0.5 + 0.5) * 255;
      nor[i + 1] = (ny * 0.5 + 0.5) * 255;
      nor[i + 2] = (nz * 0.5 + 0.5) * 255;
      nor[i + 3] = 255;
    }
  }
  return {
    map: finish(toCanvas(size, col), true),
    normalMap: finish(toCanvas(size, nor), false),
    roughnessMap: finish(toCanvas(size, rgh), false),
  };
}

const sat = (x: number) => Math.min(1, Math.max(0, x));
const sstep = (a: number, b: number, x: number) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function brickPx(u: number, v: number, rows: number, cols: number, seed: number, o: Px, tint = 1) {
  const row = Math.floor(v * rows);
  const off = (row % 2) * 0.5;
  const cu = u * cols + off;
  const bi = Math.floor(cu);
  const fu = cu - bi, fv = v * rows - row;
  const dEdge = Math.min(fu, 1 - fu, fv * 0.55, (1 - fv) * 0.55);
  const mortar = 1 - sstep(0.03, 0.075, dEdge);
  const rnd = hash(((bi % cols) + cols) % cols, row, seed);
  const grain = fbm(u, v, 64, 3, seed + 9);
  const pits = fbm(u, v, 24, 3, seed + 3);
  const br = 0.45 + rnd * 0.2;
  let r = (0.55 + rnd * 0.22) * tint, g = (0.25 + rnd * 0.1) * tint, b = (0.18 + rnd * 0.07) * tint;
  const sootAmt = 0.75 + grain * 0.5;
  r *= sootAmt * (0.8 + pits * 0.4); g *= sootAmt * (0.8 + pits * 0.4); b *= sootAmt * (0.8 + pits * 0.4);
  const mr = 0.52 + grain * 0.15;
  o.r = r + (mr - r) * mortar;
  o.g = g + (mr * 0.95 - g) * mortar;
  o.b = b + (mr * 0.88 - b) * mortar;
  o.h = (1 - mortar) * (0.7 + pits * 0.3) + grain * 0.1;
  o.rough = 0.9 - br * 0.05;
}

export function makeConcrete(seed = 1, tone: [number, number, number] = [1.02, 1, 0.96]): TexSet {
  return bake(512, (u, v, o) => {
    const f = fbm(u, v, 4, 5, seed);
    const pits = fbm(u, v, 56, 2, seed + 2);
    const stain = fbm(u, v, 3, 4, seed + 3);
    const crk = Math.abs(fbm(u, v, 5, 4, seed + 4) - 0.5);
    const streak = fbm(u, v, 6, 3, seed + 5, 1) ;
    let base = 0.42 + (f - 0.5) * 0.3;
    base -= sstep(0.55, 0.85, stain) * 0.22;
    base -= sstep(0.55, 0.9, streak) * 0.1;
    const pit = sstep(0.7, 0.85, pits);
    base -= pit * 0.12;
    const crack = 1 - sstep(0.0, 0.009, crk);
    base -= crack * 0.1;
    o.r = base * tone[0]; o.g = base * tone[1]; o.b = base * tone[2];
    o.h = f * 0.5 + (1 - pit) * 0.25 + pits * 0.1 - crack * 0.7;
    o.rough = 0.82 + f * 0.14 - crack * 0.05;
  }, 5);
}

export function makePlaster(seed: number, base: [number, number, number]): TexSet {
  return bake(512, (u, v, o) => {
    const f = fbm(u, v, 4, 5, seed);
    const fine = fbm(u, v, 80, 2, seed + 8);
    const dmg = fbm(u, v, 3, 4, seed + 11);
    const grime = fbm(u, v, 2, 4, seed + 12, 6);
    const exposed = sstep(0.69, 0.71, dmg) * 0.95;
    let r = base[0] * (0.88 + f * 0.2) * (0.94 + fine * 0.12);
    let g = base[1] * (0.88 + f * 0.2) * (0.94 + fine * 0.12);
    let b = base[2] * (0.88 + f * 0.2) * (0.94 + fine * 0.12);
    const gr = 1 - sstep(0.4, 0.8, grime) * 0.35;
    r *= gr; g *= gr; b *= gr;
    o.h = 0.5 + f * 0.2 + fine * 0.08;
    o.rough = 0.88 + f * 0.1;
    o.r = r; o.g = g; o.b = b;
    if (exposed > 0) {
      const p: Px = { h: 0, r: 0, g: 0, b: 0, rough: 0 };
      brickPx(u, v, 12, 5, seed, p, 0.62);
      const edge = sstep(0.67, 0.69, dmg) * (1 - sstep(0.71, 0.73, dmg));
      const k = exposed;
      o.r = o.r + (p.r - o.r) * k - edge * 0.1;
      o.g = o.g + (p.g - o.g) * k - edge * 0.1;
      o.b = o.b + (p.b - o.b) * k - edge * 0.1;
      o.h = o.h + (p.h * 0.9 - 0.4 - o.h) * k;
      o.rough = o.rough + (p.rough - o.rough) * k;
    }
  }, 5);
}

export function makeBrick(seed = 5): TexSet {
  return bake(512, (u, v, o) => brickPx(u, v, 14, 6, seed, o), 6);
}

export function makeAsphalt(): TexSet {
  return bake(512, (u, v, o) => {
    const agg = fbm(u, v, 128, 2, 21);
    const mid = fbm(u, v, 12, 4, 22);
    const crk = Math.abs(fbm(u, v, 4, 5, 23) - 0.5);
    const crack = 1 - sstep(0.0, 0.012, crk);
    const patch = sstep(0.55, 0.6, fbm(u, v, 3, 3, 24));
    const oil = sstep(0.62, 0.8, fbm(u, v, 5, 4, 25));
    let b = 0.23 + mid * 0.08 + (agg - 0.5) * 0.08 + patch * 0.03;
    b -= oil * 0.06;
    b -= crack * 0.1;
    const speck = hash(Math.floor(u * 512), Math.floor(v * 512), 7) > 0.985 ? 0.18 : 0;
    o.r = b * 1.03 + speck * 0.5; o.g = b + speck * 0.5; o.b = b * 0.95 + speck * 0.5;
    o.h = agg * 0.5 + mid * 0.3 - crack * 0.8 + speck;
    o.rough = 0.95 - oil * 0.18 + (agg - 0.5) * 0.05;
  }, 1.6);
}

export function makePaintedMetal(base: [number, number, number], seed: number, ribs = 0, rustAmt = 0.55): TexSet {
  return bake(512, (u, v, o) => {
    const f = fbm(u, v, 4, 4, seed);
    const fine = fbm(u, v, 96, 2, seed + 3);
    const rustMask = sstep(0.5 - rustAmt * 0.25, 0.72, fbm(u, v, 5, 5, seed + 5)) * rustAmt;
    const rustFine = fbm(u, v, 40, 3, seed + 6);
    const scratch = sstep(0.8, 0.9, fbm(u, v, 3, 3, seed + 7, 140)) * 0.25;
    const rib = ribs ? Math.sin(u * Math.PI * 2 * ribs) : 0;
    const ribShade = ribs ? 0.9 + 0.1 * rib : 1;
    const drip = sstep(0.45, 0.85, fbm(u, v, 14, 3, seed + 8, 2));
    let r = base[0] * (0.85 + f * 0.25) * ribShade;
    let g = base[1] * (0.85 + f * 0.25) * ribShade;
    let b = base[2] * (0.85 + f * 0.25) * ribShade;
    const rm = sat(rustMask * (0.6 + rustFine * 0.8) + drip * 0.1 * rustAmt);
    r += (0.27 + rustFine * 0.1 - r) * rm;
    g += (0.15 + rustFine * 0.06 - g) * rm;
    b += (0.09 + rustFine * 0.03 - b) * rm;
    r += scratch * 0.25; g += scratch * 0.25; b += scratch * 0.25;
    o.r = r; o.g = g; o.b = b;
    o.h = f * 0.15 + fine * 0.08 + rib * 0.9 + rm * rustFine * 0.4 - scratch * 0.3;
    o.rough = 0.45 + rm * 0.45 + fine * 0.15 + scratch * 0.2;
  }, 4);
}

export function makeWood(seed = 40): TexSet {
  return bake(512, (u, v, o) => {
    const planks = 4;
    const pi = Math.floor(u * planks);
    const pu = u * planks - pi;
    const rnd = hash(pi, 3, seed);
    const grain = fbm(u, v, planks * 2, 5, seed + pi, 2);
    const rings = Math.sin((grain * 14 + rnd * 6) * Math.PI);
    const gap = 1 - sstep(0.0, 0.04, Math.min(pu, 1 - pu));
    const dirt = fbm(u, v, 6, 4, seed + 77);
    const tone = 0.7 + rnd * 0.35 + rings * 0.05;
    o.r = 0.5 * tone * (0.85 + dirt * 0.25) * (1 - gap * 0.7);
    o.g = 0.34 * tone * (0.85 + dirt * 0.25) * (1 - gap * 0.7);
    o.b = 0.19 * tone * (0.85 + dirt * 0.25) * (1 - gap * 0.7);
    o.h = rings * 0.12 + grain * 0.3 - gap * 0.8;
    o.rough = 0.78 + grain * 0.15;
  }, 4);
}

export function makeDirt(): TexSet {
  return bake(512, (u, v, o) => {
    const f = fbm(u, v, 6, 5, 61);
    const peb = fbm(u, v, 40, 2, 62);
    const stones = sstep(0.68, 0.74, peb);
    const dark = fbm(u, v, 3, 4, 63);
    const b = 0.3 + f * 0.2 + stones * 0.12 - dark * 0.08;
    o.r = b * 1.18; o.g = b * 1.0; o.b = b * 0.78;
    o.h = f * 0.6 + stones * 0.5 + peb * 0.1;
    o.rough = 0.95;
  }, 7);
}

export function makeFabric(base = 1): TexSet {
  return bake(256, (u, v, o) => {
    const wx = Math.sin(u * 128 * Math.PI * 2 / 2);
    const wy = Math.sin(v * 128 * Math.PI * 2 / 2);
    const weave = wx * wy * 0.5 + 0.5;
    const f = fbm(u, v, 8, 4, 71);
    const fine = fbm(u, v, 96, 1, 72);
    const b = base * (0.78 + f * 0.3 + weave * 0.12);
    o.r = b; o.g = b; o.b = b;
    o.h = weave * 0.5 + f * 0.2 + fine * 0.1;
    o.rough = 0.92;
  }, 3);
}

export function makeBurlap(tint: [number, number, number] = [0.62, 0.52, 0.34]): TexSet {
  return bake(256, (u, v, o) => {
    const wx = Math.sin(u * 64 * Math.PI * 2);
    const wy = Math.sin(v * 64 * Math.PI * 2);
    const weave = (wx * wy) * 0.5 + 0.5;
    const f = fbm(u, v, 5, 4, 81);
    const stain = fbm(u, v, 3, 4, 82);
    const b = 0.65 + weave * 0.25 + f * 0.25 - sstep(0.5, 0.8, stain) * 0.3;
    o.r = tint[0] * b; o.g = tint[1] * b; o.b = tint[2] * b;
    o.h = weave * 0.6 + f * 0.4;
    o.rough = 0.95;
  }, 5);
}

export function makeGunMetal(seed = 90, base = 0.07): TexSet {
  return bake(512, (u, v, o) => {
    const streak = fbm(u, v, 2, 3, seed, 220);
    const f = fbm(u, v, 6, 4, seed + 1);
    const wear = sstep(0.62, 0.8, fbm(u, v, 9, 4, seed + 2));
    const speck = fbm(u, v, 128, 1, seed + 3);
    const b = base + streak * 0.03 + wear * 0.045 + speck * 0.015;
    o.r = b; o.g = b * 1.02; o.b = b * 1.05;
    o.h = streak * 0.2 + speck * 0.1;
    o.rough = 0.32 + streak * 0.15 + f * 0.1 + wear * 0.15;
  }, 2);
}

export function makePolymer(seed = 95, base = 0.06): TexSet {
  return bake(256, (u, v, o) => {
    const g = fbm(u, v, 64, 2, seed);
    const f = fbm(u, v, 5, 3, seed + 1);
    const b = base + g * 0.02 + f * 0.012;
    o.r = b; o.g = b; o.b = b * 1.04;
    o.h = g;
    o.rough = 0.6 + g * 0.2;
  }, 4);
}

/* ---------------------------- single-channel / sprite textures --------------------------- */

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

export function makeBulletHole() {
  return canvasTex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    const rnd = mulberry(5);
    const grd = g.createRadialGradient(64, 64, 2, 64, 64, 60);
    grd.addColorStop(0, "rgba(0,0,0,0.95)");
    grd.addColorStop(0.18, "rgba(8,8,8,0.9)");
    grd.addColorStop(0.35, "rgba(25,22,20,0.55)");
    grd.addColorStop(1, "rgba(30,26,22,0)");
    g.fillStyle = grd; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill();
    // chipped lighter debris ring
    for (let i = 0; i < 60; i++) {
      const a = rnd() * Math.PI * 2, d = 12 + rnd() * 34;
      g.fillStyle = `rgba(${190 + rnd() * 50},${180 + rnd() * 40},${160 + rnd() * 40},${0.25 + rnd() * 0.4})`;
      g.beginPath(); g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 0.8 + rnd() * 2.2, 0, 7); g.fill();
    }
    // cracks
    g.strokeStyle = "rgba(10,10,10,0.55)"; g.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2; let x = 64, y = 64;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += Math.cos(a + (rnd() - 0.5)) * (6 + rnd() * 9); y += Math.sin(a + (rnd() - 0.5)) * (6 + rnd() * 9); g.lineTo(x, y); }
      g.stroke();
    }
    g.fillStyle = "#000"; g.beginPath(); g.arc(64, 64, 4.5, 0, 7); g.fill();
  });
}

export function makePuff() {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, 128, 128);
    const rnd = mulberry(11);
    for (let i = 0; i < 26; i++) {
      const a = rnd() * 6.283, d = rnd() * 26, r = 14 + rnd() * 22;
      const x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, "rgba(255,255,255,0.28)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    // radial fade mask so edges never clip
    const m = g.createRadialGradient(64, 64, 20, 64, 64, 64);
    m.addColorStop(0, "rgba(0,0,0,0)"); m.addColorStop(1, "rgba(0,0,0,1)");
    g.fillStyle = m; g.fillRect(0, 0, 128, 128);
  }, false);
}

export function makeFlash() {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = "lighter";
    const core = g.createRadialGradient(64, 64, 0, 64, 64, 56);
    core.addColorStop(0, "rgba(255,255,240,1)");
    core.addColorStop(0.2, "rgba(255,210,120,0.9)");
    core.addColorStop(0.55, "rgba(255,120,30,0.35)");
    core.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = core; g.fillRect(0, 0, 128, 128);
    // star spikes
    g.translate(64, 64);
    const rnd = mulberry(3);
    for (let i = 0; i < 7; i++) {
      g.save();
      g.rotate((i / 7) * Math.PI * 2 + rnd() * 0.3);
      const len = 40 + rnd() * 22;
      const gr = g.createLinearGradient(0, 0, len, 0);
      gr.addColorStop(0, "rgba(255,230,160,0.9)"); gr.addColorStop(1, "rgba(255,120,20,0)");
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(0, -5); g.lineTo(len, 0); g.lineTo(0, 5); g.fill();
      g.restore();
    }
  });
}

export function makeBlob() {
  return canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(0,0,0,0.9)");
    gr.addColorStop(0.55, "rgba(0,0,0,0.4)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
}

export function makeStain(seed: number, r = 0.16, g = 0.14, b = 0.12) {
  return canvasTex(256, 256, (c) => {
    const id = c.createImageData(256, 256);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const u = x / 256, v = y / 256;
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      const n = fbm(u, v, 4, 5, seed);
      const a = sat((0.85 - d - (1 - n) * 0.55) * 2.2);
      const i = (y * 256 + x) * 4;
      id.data[i] = r * 255; id.data[i + 1] = g * 255; id.data[i + 2] = b * 255; id.data[i + 3] = a * 255 * 0.8;
    }
    c.putImageData(id, 0, 0);
  });
}

export function makeSign(text: string, bg: string, fg: string, w = 512, h = 128, wear = true) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = fg;
    g.font = `800 ${Math.floor(h * 0.52)}px Impact, "Arial Narrow", sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + 4);
    if (wear) {
      const rnd = mulberry(text.length * 13);
      for (let i = 0; i < 400; i++) {
        g.fillStyle = `rgba(20,16,12,${rnd() * 0.25})`;
        g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3);
      }
    }
  });
}

export function makeStripes(a: string, b: string) {
  const t = canvasTex(128, 128, (g) => {
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(i * 16, 0, 16, 128); }
    const rnd = mulberry(8);
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(30,25,20,${rnd() * 0.18})`; g.fillRect(rnd() * 128, rnd() * 128, 3, 3); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function makeGlassCrack() {
  return canvasTex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
  });
}
