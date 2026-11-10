import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { Sky } from "three/addons/objects/Sky.js";
import * as T from "./textures";

export type Tag = "concrete" | "metal" | "wood" | "brick" | "dirt" | "fabric" | "glass";
export interface Collider { min: THREE.Vector3; max: THREE.Vector3; tag: Tag }
export interface FireSpot { pos: THREE.Vector3; light: THREE.PointLight; seed: number; base: number }

const R = T.mulberry(20240611);
const rr = (a: number, b: number) => a + (b - a) * R();
const pick = <A,>(a: A[]) => a[Math.floor(R() * a.length)];

export const SUN_DIR = new THREE.Vector3(-0.62, 0.3, 0.72).normalize();

function std(set: T.TexSet, o: THREE.MeshStandardMaterialParameters = {}) {
  return new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, roughness: 1, metalness: 0, ...o });
}

function boxGeo(sx: number, sy: number, sz: number, tile: number, ou: number, ov: number) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * dims[f][0] / tile + ou, uv.getY(k) * dims[f][1] / tile + ov);
  }
  return g;
}

class Merger {
  buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  noCast = new Set<THREE.Material>();
  add(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    let l = this.buckets.get(mat);
    if (!l) { l = []; this.buckets.set(mat, l); }
    l.push(g);
  }
  flush(parent: THREE.Object3D) {
    for (const [mat, list] of this.buckets) {
      const merged = mergeGeometries(list, false)!;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = !this.noCast.has(mat);
      mesh.receiveShadow = true;
      parent.add(mesh);
      list.forEach((g) => g.dispose());
    }
    this.buckets.clear();
  }
}

interface BoxOpts { c?: boolean; tag?: Tag; tile?: number; ry?: number; rx?: number; rz?: number }

export class World {
  group = new THREE.Group();
  colliders: Collider[] = [];
  fires: FireSpot[] = [];
  spawns: THREE.Vector3[] = [];
  lamps: THREE.PointLight[] = [];
  merger = new Merger();
  mats: Record<string, THREE.MeshStandardMaterial> = {};
  playerSpawn = new THREE.Vector3(0, 0, 27);
  extent = 54;

  constructor() {
    this.build();
  }

  addCollider(m: THREE.Matrix4, sx: number, sy: number, sz: number, tag: Tag) {
    const mn = new THREE.Vector3(Infinity, Infinity, Infinity), mx = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? sx / 2 : -sx / 2, i & 2 ? sy / 2 : -sy / 2, i & 4 ? sz / 2 : -sz / 2).applyMatrix4(m);
      mn.min(v); mx.max(v);
    }
    this.colliders.push({ min: mn, max: mx, tag });
  }

  /* ------------------------------ materials ------------------------------ */
  private makeMaterials() {
    const m = this.mats;
    m.asphalt = std(T.makeAsphalt(), { normalScale: new THREE.Vector2(0.45, 0.45) });
    m.concrete = std(T.makeConcrete(1));
    m.concreteDark = std(T.makeConcrete(7, [0.78, 0.78, 0.8]));
    m.paving = std(T.makeConcrete(13, [1.05, 1.0, 0.9]));
    m.brick = std(T.makeBrick(5));
    m.plaster1 = std(T.makePlaster(1, [0.86, 0.76, 0.6]));
    m.plaster2 = std(T.makePlaster(2, [0.78, 0.72, 0.62]));
    m.plaster3 = std(T.makePlaster(3, [0.62, 0.68, 0.7]));
    m.plaster4 = std(T.makePlaster(4, [0.82, 0.62, 0.45]));
    m.wood = std(T.makeWood(40));
    m.dirt = std(T.makeDirt());
    m.burlap = std(T.makeBurlap());
    m.hesco = std(T.makeBurlap([0.58, 0.5, 0.36]));
    m.containerRed = std(T.makePaintedMetal([0.42, 0.13, 0.1], 31, 8), { metalness: 0.35 });
    m.containerBlue = std(T.makePaintedMetal([0.1, 0.2, 0.36], 32, 8), { metalness: 0.35 });
    m.containerGreen = std(T.makePaintedMetal([0.15, 0.28, 0.18], 33, 8), { metalness: 0.35 });
    m.containerTan = std(T.makePaintedMetal([0.5, 0.42, 0.27], 34, 8), { metalness: 0.35 });
    m.shutter = std(T.makePaintedMetal([0.35, 0.36, 0.34], 35, 20, 0.35), { metalness: 0.5 });
    m.barrelRed = std(T.makePaintedMetal([0.5, 0.09, 0.07], 36, 0, 0.5), { metalness: 0.45 });
    m.barrelBlue = std(T.makePaintedMetal([0.1, 0.22, 0.45], 37, 0, 0.5), { metalness: 0.45 });
    m.barrelGreen = std(T.makePaintedMetal([0.18, 0.3, 0.17], 38, 0, 0.5), { metalness: 0.45 });
    m.barrelRust = std(T.makePaintedMetal([0.3, 0.2, 0.12], 39, 0, 0.95), { metalness: 0.5 });
    m.carA = std(T.makePaintedMetal([0.55, 0.52, 0.45], 51, 0, 0.18), { metalness: 0.55 });
    m.carB = std(T.makePaintedMetal([0.12, 0.17, 0.3], 52, 0, 0.18), { metalness: 0.55 });
    m.carBurnt = std(T.makePaintedMetal([0.07, 0.065, 0.06], 53, 0, 0.3), { metalness: 0.5 });
    m.carC = std(T.makePaintedMetal([0.4, 0.07, 0.06], 54, 0, 0.18), { metalness: 0.55 });
    m.darkMetal = std(T.makePaintedMetal([0.07, 0.075, 0.08], 55, 0, 0.3), { metalness: 0.8 });
    m.greenMetal = std(T.makePaintedMetal([0.12, 0.22, 0.14], 56, 0, 0.5), { metalness: 0.4 });
    m.rustMetal = std(T.makePaintedMetal([0.32, 0.2, 0.12], 57, 0, 1), { metalness: 0.6 });
    m.shutterWood = std(T.makePaintedMetal([0.18, 0.3, 0.26], 58, 0, 0.6), { metalness: 0.05 });
    m.shutterWood2 = std(T.makePaintedMetal([0.36, 0.22, 0.15], 59, 0, 0.6), { metalness: 0.05 });
    m.rubber = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.88, metalness: 0 });
    m.glass = new THREE.MeshStandardMaterial({ color: 0x0a1218, roughness: 0.05, metalness: 0.95 });
    m.glassDark = new THREE.MeshStandardMaterial({ color: 0x020202, roughness: 0.6, metalness: 0 });
    m.glassLit = new THREE.MeshStandardMaterial({ color: 0x201810, roughness: 0.4, metalness: 0, emissive: 0xffa550, emissiveIntensity: 1.6 });
    m.lampGlow = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffc27a, emissiveIntensity: 7 });
    m.paint = new THREE.MeshStandardMaterial({ color: 0xcfcdc4, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.paintYellow = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.stripeA = std({ map: T.makeStripes("#8b2a22", "#d8cdb4"), normalMap: T.makeFabric(1).normalMap, roughnessMap: T.makeFabric(1).roughnessMap }, { roughness: 1 });
    m.stripeB = std({ map: T.makeStripes("#26455f", "#cfc6ac"), normalMap: T.makeFabric(1).normalMap, roughnessMap: T.makeFabric(1).roughnessMap }, { roughness: 1 });
    this.merger.noCast.add(m.paint);
    this.merger.noCast.add(m.paintYellow);
  }

  /* ------------------------------ build ------------------------------ */
  private build() {
    this.makeMaterials();
    const M = this.mats;
    const g = this.group;

    // ground
    const gb = new Builder(this);
    const groundMat = M.asphalt;
    const ground = new THREE.Mesh(boxGeo(700, 1, 700, 9, 0, 0), groundMat);
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    g.add(ground);
    void gb;

    // streets: four buildings sides
    const sides: { pos: [number, number]; rot: number; spans: [number, number][]; depth: number; len: number }[] = [
      { pos: [0, -36], rot: 0, spans: [[-52, -13], [-6, 12], [19, 52]], depth: 16, len: 104 },
      { pos: [0, 36], rot: Math.PI, spans: [[-52, -13], [-6, 12], [19, 52]], depth: 16, len: 104 },
      { pos: [36, 0], rot: -Math.PI / 2, spans: [[-36, -14], [-7, 9], [16, 36]], depth: 14, len: 72 },
      { pos: [-36, 0], rot: Math.PI / 2, spans: [[-36, -14], [-7, 9], [16, 36]], depth: 14, len: 72 },
    ];
    sides.forEach((s, si) => {
      const frame = new THREE.Matrix4().compose(new THREE.Vector3(s.pos[0], 0, s.pos[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot), new THREE.Vector3(1, 1, 1));
      const b = new Builder(this, frame);
      // sidewalk
      b.box(0, 0, 3.2, s.len, 0.16, 6.4, M.paving, { c: true, tile: 1.6 });
      // curb face
      b.box(0, 0, 6.5, s.len, 0.16, 0.2, M.concrete, { tile: 1 });
      s.spans.forEach((sp, bi) => {
        const w = sp[1] - sp[0];
        const cx = (sp[0] + sp[1]) / 2;
        const bb = new Builder(this, new THREE.Matrix4().multiplyMatrices(frame, new THREE.Matrix4().makeTranslation(cx, 0, 0)));
        const floors = 3 + Math.floor(R() * 3);
        const style = [M.plaster1, M.plaster2, M.plaster3, M.plaster4, M.brick][(si * 3 + bi + Math.floor(R() * 2)) % 5];
        this.building(bb, w, floors, s.depth, style, si * 10 + bi);
      });
      // alleys: caps + spawn points
      for (let i = 0; i < s.spans.length - 1; i++) {
        const x0 = s.spans[i][1], x1 = s.spans[i + 1][0];
        const cx = (x0 + x1) / 2;
        b.box(cx, 0, -s.depth - 0.4, x1 - x0 + 0.2, 9, 0.8, M.concreteDark, { c: true, tile: 3 });
        const p = new THREE.Vector3(cx, 0, -9).applyMatrix4(frame);
        this.spawns.push(p);
        // alley clutter
        b.box(cx - 2, 0, -12, 1.4, 1.1, 1.0, M.greenMetal, { c: true, tag: "metal", tile: 1.2 });
      }
    });

    this.plaza();
    this.skyline();

    this.merger.flush(g);
  }

  /* ------------------------------ buildings ------------------------------ */
  private building(b: Builder, w: number, floors: number, depth: number, wall: THREE.Material, seed: number) {
    const M = this.mats;
    const FH = 3.5;
    const H = floors * FH + 1.0;
    // body
    b.box(0, 0, -depth / 2, w, H, depth, wall, { c: true, tile: 6, tag: wall === M.brick ? "brick" : "concrete" });
    // plinth
    b.box(0, 0, 0.1, w + 0.2, 0.9, 0.2, M.concreteDark, { tile: 2 });
    // cornice + parapet
    b.box(0, H - 1.2, 0.3, w + 0.5, 0.35, 0.6, M.concrete, { tile: 2 });
    b.box(0, H - 0.85, 0.1, w + 0.1, 0.85 + 0.9, 0.3, wall, { tile: 6 });
    // floor bands
    for (let f = 1; f < floors; f++) b.box(0, f * FH - 0.1, 0.06, w + 0.1, 0.2, 0.14, M.concrete, { tile: 2 });

    // bays
    const bayW = 3.8;
    const nb = Math.max(2, Math.floor((w - 1.5) / bayW));
    const startX = -((nb - 1) * bayW) / 2;
    for (let f = 0; f < floors; f++) {
      for (let i = 0; i < nb; i++) {
        const x = startX + i * bayW;
        const y = f * FH;
        if (f === 0) {
          const kind = R();
          if (kind < 0.5) this.storefront(b, x, bayW, seed + i);
          else if (kind < 0.62) this.door(b, x);
          else this.window(b, x, y + 1.2, true);
        } else {
          const lit = R() < 0.12;
          this.window(b, x, y + 0.9, false, lit);
          if (f >= 1 && R() < 0.22) this.balcony(b, x, y);
          if (R() < 0.1) b.box(x + 1.4, y + 0.8, 0.25, 0.7, 0.55, 0.45, this.mats.darkMetal, { tag: "metal", tile: 0.7 });
        }
      }
    }
    // pipes
    for (const sx of [-1, 1]) {
      if (R() < 0.7) b.cyl(sx * (w / 2 - 0.35), 0, 0.14, 0.07, H - 0.8, M.rustMetal, { seg: 8 });
    }
    // sign
    const names = ["HOTEL", "FARMACIA", "CAFE", "BANK", "MARKET", "BAR", "ELECTRO", "BAKERY", "KIOSK"];
    if (R() < 0.8) {
      const nm = pick(names);
      const bg = pick(["#7a1e1a", "#1b3d56", "#e0d9c0", "#1e4a2a", "#222"]);
      const fg = bg === "#e0d9c0" ? "#1a1a1a" : "#efe6cf";
      const tex = T.makeSign(nm, bg, fg);
      const sm = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: R() < 0.4 ? 1.1 : 0.12, roughness: 0.6, metalness: 0.1 });
      const sw = 3.8, sh = 0.95;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, 0.18), sm);
      const sx = rr(-w / 2 + 3, w / 2 - 3);
      b.place(mesh, sx, 3.15, 0.3);
      mesh.castShadow = true;
    }
    // rooftop clutter
    b.cyl(rr(-w / 3, w / 3), H, -depth / 2, 1.3, 2.4, M.rustMetal, { seg: 14 });
    for (let i = 0; i < 3; i++) b.box(rr(-w / 2 + 2, w / 2 - 2), H, -rr(3, depth - 3), rr(1, 2.4), rr(0.8, 1.6), rr(1, 2), M.darkMetal, { tile: 1.5, tag: "metal" });
  }

  private window(b: Builder, x: number, y: number, ground: boolean, lit = false) {
    const M = this.mats;
    const w = 1.25, h = ground ? 1.4 : 1.75;
    const open = R() < 0.18;
    const glassMat = lit ? M.glassLit : R() < 0.25 ? M.glassDark : M.glass;
    const frameMat = M.concreteDark;
    b.box(x, y, 0.02, w, h, 0.05, glassMat, { tile: 1 });
    // frame
    b.box(x, y - 0.06, 0.07, w + 0.2, 0.1, 0.12, frameMat, { tile: 1 });
    b.box(x, y + h - 0.04, 0.07, w + 0.2, 0.1, 0.12, frameMat, { tile: 1 });
    b.box(x - w / 2 - 0.04, y, 0.07, 0.1, h, 0.12, frameMat, { tile: 1 });
    b.box(x + w / 2 + 0.04, y, 0.07, 0.1, h, 0.12, frameMat, { tile: 1 });
    b.box(x, y, 0.07, 0.05, h, 0.06, frameMat, { tile: 1 });
    b.box(x, y + h * 0.62, 0.07, w, 0.05, 0.06, frameMat, { tile: 1 });
    // sill + lintel
    b.box(x, y - 0.17, 0.14, w + 0.55, 0.11, 0.36, M.concrete, { tile: 1 });
    b.box(x, y + h + 0.06, 0.07, w + 0.45, 0.17, 0.16, M.concrete, { tile: 1 });
    // shutters
    if (R() < 0.7) {
      const sm = R() < 0.5 ? M.shutterWood : M.shutterWood2;
      if (open) {
        b.box(x - w / 2 - 0.33, y - 0.04, 0.15, 0.62, h + 0.1, 0.05, sm, { tile: 1 });
        b.box(x + w / 2 + 0.33, y - 0.04, 0.15, 0.62, h + 0.1, 0.05, sm, { tile: 1 });
      } else if (R() < 0.5) {
        b.box(x - w / 4 - 0.02, y - 0.04, 0.15, w / 2 + 0.05, h + 0.1, 0.05, sm, { tile: 1 });
        b.box(x + w / 4 + 0.02, y - 0.04, 0.15, w / 2 + 0.05, h + 0.1, 0.05, sm, { tile: 1 });
      } else {
        b.box(x - w / 2 - 0.4, y - 0.04, 0.2, 0.62, h + 0.1, 0.05, sm, { tile: 1, ry: -0.9 });
        b.box(x + w / 2 + 0.33, y - 0.04, 0.15, 0.62, h + 0.1, 0.05, sm, { tile: 1 });
      }
    }
  }

  private storefront(b: Builder, x: number, bayW: number, seed: number) {
    const M = this.mats;
    const frameMat = M.darkMetal;
    const w = bayW - 1.0;
    b.box(x, 0.45, 0.02, w, 2.1, 0.05, R() < 0.3 ? M.glassDark : M.glass, { tile: 1 });
    b.box(x, 0.4, 0.07, w + 0.2, 0.12, 0.12, frameMat, { tile: 1 });
    b.box(x, 2.5, 0.07, w + 0.2, 0.12, 0.12, frameMat, { tile: 1 });
    b.box(x - w / 2 - 0.05, 0.4, 0.07, 0.12, 2.2, 0.12, frameMat, { tile: 1 });
    b.box(x + w / 2 + 0.05, 0.4, 0.07, 0.12, 2.2, 0.12, frameMat, { tile: 1 });
    b.box(x, 0.4, 0.07, 0.07, 2.2, 0.08, frameMat, { tile: 1 });
    // rolling shutter, partially down
    const drop = rr(0.2, 0.95);
    if (R() < 0.65) {
      b.box(x, 2.55 - (2.2 * drop), 0.15, w + 0.3, 2.2 * drop + 0.05, 0.1, M.shutter, { tile: 1.2 });
      b.box(x, 2.55, 0.17, w + 0.5, 0.35, 0.3, M.shutter, { tile: 1.2 });
    }
    // awning
    if (R() < 0.55) {
      b.box(x, 2.85, 1.0, bayW - 0.3, 0.05, 2.0, R() < 0.5 ? M.stripeA : M.stripeB, { tile: 1.6, rx: 0.2 });
    }
    void seed;
  }

  private door(b: Builder, x: number) {
    const M = this.mats;
    b.box(x, 0, 0.02, 1.3, 2.45, 0.1, M.glassDark, { tile: 1 });
    b.box(x, 0, 0.1, 1.6, 0.18, 0.2, M.concrete, { tile: 1 });
    b.box(x - 0.78, 0, 0.1, 0.16, 2.6, 0.2, M.concrete, { tile: 1 });
    b.box(x + 0.78, 0, 0.1, 0.16, 2.6, 0.2, M.concrete, { tile: 1 });
    b.box(x, 2.5, 0.1, 1.8, 0.18, 0.24, M.concrete, { tile: 1 });
    b.box(x, 0.05, 0.1, 1.1, 2.3, 0.06, M.shutterWood2, { tile: 1 });
  }

  private balcony(b: Builder, x: number, y: number) {
    const M = this.mats;
    b.box(x, y - 0.08, 0.75, 2.3, 0.16, 1.5, M.concrete, { tile: 1.5 });
    b.box(x, y + 0.08, 1.45, 2.3, 0.06, 0.06, M.darkMetal, { tile: 1 });
    b.box(x, y + 1.0, 1.45, 2.3, 0.06, 0.06, M.darkMetal, { tile: 1 });
    for (let i = 0; i < 8; i++) b.box(x - 1.08 + i * 0.31, y + 0.1, 1.45, 0.035, 0.92, 0.035, M.darkMetal, { tile: 1 });
    b.box(x - 1.12, y + 0.1, 0.8, 0.06, 0.92, 0.06, M.darkMetal, { tile: 1 });
    b.box(x + 1.12, y + 0.1, 0.8, 0.06, 0.92, 0.06, M.darkMetal, { tile: 1 });
  }

  /* ------------------------------ plaza ------------------------------ */
  private plaza() {
    const M = this.mats;
    const b = new Builder(this);

    // road markings
    for (let i = 0; i < 9; i++) {
      for (const s of [-1, 1]) {
        b.box(s * (10 + i * 3.2), 0.0, 0, 1.8, 0.012, 0.18, M.paint, { tile: 1 });
        b.box(0, 0.0, s * (10 + i * 3.2), 0.18, 0.012, 1.8, M.paint, { tile: 1 });
      }
    }
    for (let i = 0; i < 9; i++) {
      for (const s of [-1, 1]) {
        b.box(-6 + i * 1.5, 0, s * 31.5, 0.7, 0.012, 3.2, M.paint, { tile: 1 });
        b.box(s * 31.5, 0, -6 + i * 1.5, 3.2, 0.012, 0.7, M.paint, { tile: 1 });
      }
    }
    b.box(0, 0, 0, 22.5, 0.012, 0.15, M.paintYellow, { tile: 1, ry: 0 });

    // fountain / monument
    const rimMat = M.concrete;
    b.box(0, 0, -4.6, 10, 0.75, 0.8, rimMat, { c: true, tile: 1.5 });
    b.box(0, 0, 4.6, 10, 0.75, 0.8, rimMat, { c: true, tile: 1.5 });
    b.box(-4.6, 0, 0, 0.8, 0.75, 8.4, rimMat, { c: true, tile: 1.5 });
    b.box(4.6, 0, 0, 0.8, 0.75, 8.4, rimMat, { c: true, tile: 1.5 });
    b.box(0, 0.0, 0, 8.4, 0.2, 8.4, M.dirt, { tile: 2 });
    b.box(0, 0.2, 0, 2.6, 0.6, 2.6, M.concreteDark, { c: true, tile: 1.5 });
    b.box(0, 0.8, 0, 1.7, 3.6, 1.7, M.concrete, { c: true, tile: 1.7 });
    b.box(0, 4.4, 0, 2.3, 0.35, 2.3, M.concreteDark, { c: true, tile: 1.7 });
    b.box(0.2, 4.75, 0.1, 1.1, 1.2, 1.0, M.concrete, { tile: 1.5, ry: 0.4, rz: 0.25 });
    for (let i = 0; i < 9; i++) this.rubble(rr(-3, 3), rr(-3, 3), rr(0.2, 0.5));

    // jersey barriers
    const jb = (x: number, z: number, ry: number) => this.jersey(b, x, z, ry);
    for (let i = 0; i < 4; i++) jb(-23 + i * 3.1, 14, Math.PI / 2);
    for (let i = 0; i < 4; i++) jb(9 + i * 3.1, -17, Math.PI / 2);
    for (let i = 0; i < 3; i++) jb(-21, -6 + i * 3.1, 0);
    for (let i = 0; i < 3; i++) jb(21, 4 + i * 3.1, 0);
    jb(-16, 27, 0.0); jb(16, -28, 0);

    // crates
    this.crateStack(b, -25, 9, 3);
    this.crateStack(b, 23, -9, 2);
    this.crateStack(b, -11, -25, 3);
    this.crateStack(b, 27, 19, 2);
    this.crateStack(b, -28, -14, 2);
    this.crateStack(b, 8, 25, 2);

    // sandbags
    this.sandbags(b, 12, 15, 5, 0);
    this.sandbags(b, 9.7, 17.6, 4, Math.PI / 2);
    this.sandbags(b, -14, -10, 6, 0);
    this.sandbags(b, 26, -2, 5, Math.PI / 2);
    this.sandbags(b, -5, 20, 4, 0);

    // hesco
    this.hesco(b, -3, -31, 10, 0);
    this.hesco(b, 4, 30, 8, 0);
    this.hesco(b, 31, 10, 8, Math.PI / 2);

    // containers
    this.container(b, 29, -25, M.containerRed, 0, 1);
    this.container(b, 29, -29.3, M.containerBlue, 0, 1);
    this.container(b, 29, -27, M.containerGreen, 0, 2, 0.0);
    this.container(b, -29, 26, M.containerTan, Math.PI / 2, 1);
    this.container(b, -29, 31.4, M.containerRed, Math.PI / 2, 1);
    this.container(b, -30, -26, M.containerBlue, 0, 1);

    // wrecks
    this.car(b, -8, 12, 0, M.carBurnt, true);
    this.car(b, 14, -22, Math.PI / 2, M.carA);
    this.car(b, -18, -2, Math.PI / 2 + 0.0, M.carB);
    this.car(b, 6, 23, 0, M.carC);
    this.car(b, 24, 5, Math.PI / 2, M.carBurnt, true);
    this.car(b, -26, 20, 0, M.carA);

    // barrels
    const bc = (x: number, z: number, fire = false, mat?: THREE.MeshStandardMaterial) => this.barrel(b, x, z, mat ?? pick([M.barrelRed, M.barrelBlue, M.barrelGreen, M.barrelRust]), fire);
    bc(-6, -12, true); bc(-7, -13, false); bc(-5.6, -13.2);
    bc(18, 6, true, M.barrelRust); bc(19, 7);
    bc(-22, 18); bc(-23, 17.5); bc(-22.5, 19.2, true);
    bc(24, -16); bc(25, -15.5); bc(-13, 4); bc(2, -9);

    // street lamps
    const lamp = (x: number, z: number, ry: number, light: boolean) => this.lamp(b, x, z, ry, light);
    lamp(-20, 30, 0, true); lamp(20, 30, 0, false); lamp(-20, -30, Math.PI, false); lamp(20, -30, Math.PI, true);
    lamp(-32, 0, Math.PI / 2, false); lamp(32, 8, -Math.PI / 2, false);
    // planters
    for (let i = 0; i < 4; i++) { b.box(-12 + i * 8, 0, 31.2, 1.4, 0.6, 0.8, M.concreteDark, { c: true, tile: 1 }); }

    // dumpster
    b.box(-4, 0, -33.5, 1.9, 1.2, 1.0, M.greenMetal, { c: true, tag: "metal", tile: 1.2 });
    b.box(-4, 1.2, -33.5, 2.0, 0.08, 1.1, M.darkMetal, { tag: "metal", tile: 1.2, rx: -0.05 });
    b.box(14, 0, 33.3, 1.9, 1.2, 1.0, M.greenMetal, { c: true, tag: "metal", tile: 1.2 });

    // stalls
    this.stall(b, -12, 26);

    // scattered rubble / debris
    for (let i = 0; i < 30; i++) {
      const x = rr(-32, 32), z = rr(-32, 32);
      if (Math.hypot(x, z) < 7) continue;
      this.rubble(x, z, rr(0.12, 0.45));
    }
    for (let i = 0; i < 6; i++) this.rubbleHeap(rr(-30, 30), rr(-30, 30));

    // tires
    for (let i = 0; i < 3; i++) this.tire(b, -16 + i * 0.1, -22 + i * 0.01, i);
    this.tire(b, 20, 20, 0); this.tire(b, 20.1, 20, 1);

    // puddles + stains
    this.decals();

    // sun-lit dust sheet? (none) – lights
    this.fires.forEach(() => void 0);
  }

  private decals() {
    const M = this.mats;
    void M;
    const blob = T.makeBlob();
    const water = new THREE.MeshStandardMaterial({ color: 0x1b2429, roughness: 0.03, metalness: 0, alphaMap: blob, transparent: true, opacity: 0.92, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const spots: [number, number, number][] = [[-10, 6, 3.2], [12, -6, 2.6], [-2, 14, 2], [18, 16, 3.5], [-18, -16, 3], [4, -24, 2.4], [-26, 4, 2.2]];
    for (const [x, z, r] of spots) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 1.5), water);
      m.rotation.x = -Math.PI / 2; m.rotation.z = rr(0, 3);
      m.position.set(x, 0.02, z);
      m.receiveShadow = true;
      this.group.add(m);
    }
    const stainMat = new THREE.MeshStandardMaterial({ map: T.makeStain(5), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const spots2: [number, number, number][] = [[-6, -12, 4], [18, 6, 3.5], [-8, 12, 5], [24, 5, 4.5], [14, -22, 5]];
    for (const [x, z, r] of spots2) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), stainMat);
      m.rotation.x = -Math.PI / 2; m.rotation.z = rr(0, 6);
      m.position.set(x, 0.015, z);
      m.receiveShadow = true;
      this.group.add(m);
    }
    // soft contact-shadow blobs are added by props via blobShadow()
  }

  private blob(x: number, z: number, sx: number, sz: number, ry: number, op = 0.5, y = 0.017) {
    if (!this.blobMat) {
      this.blobMat = new THREE.MeshBasicMaterial({ map: T.makeBlob(), transparent: true, depthWrite: false, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true });
      this.blobGeo = new THREE.PlaneGeometry(1, 1);
    }
    const m = new THREE.Mesh(this.blobGeo!, this.blobMat);
    m.rotation.set(-Math.PI / 2, 0, ry);
    m.scale.set(sx, sz, 1);
    m.position.set(x, y, z);
    m.userData.noAO = true;
    m.renderOrder = 1;
    void op;
    this.group.add(m);
  }
  private blobMat?: THREE.MeshBasicMaterial;
  private blobGeo?: THREE.PlaneGeometry;

  /* ------------------------------ props ------------------------------ */
  private jersey(b: Builder, x: number, z: number, ry: number) {
    if (!this.jerseyGeo) {
      const s = new THREE.Shape();
      s.moveTo(-0.3, 0); s.lineTo(0.3, 0); s.lineTo(0.255, 0.25); s.lineTo(0.12, 0.8); s.lineTo(-0.12, 0.8); s.lineTo(-0.255, 0.25); s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 3, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 1, steps: 1 });
      g.translate(0, 0, -1.5);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
      this.jerseyGeo = g;
    }
    b.geo(this.jerseyGeo, this.mats.concrete, x, 0, z, { ry, c: true, size: [0.62, 0.84, 3.1], tag: "concrete", cy: 0.42 });
    this.blob(x, z, ry ? 3.6 : 1.4, ry ? 1.4 : 3.6, 0, 0.5);
  }
  private jerseyGeo?: THREE.ExtrudeGeometry;

  private crateStack(b: Builder, x: number, z: number, n: number) {
    const M = this.mats;
    const place = (cx: number, cz: number, y: number, s: number, ry: number) => {
      b.box(cx, y, cz, s, s, s, M.wood, { c: true, tag: "wood", tile: 1.2, ry });
      const t = 0.09, o = s / 2 - t / 2 + 0.005;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(cx + sx * o * Math.cos(ry) + sz * o * Math.sin(ry), y, cz - sx * o * Math.sin(ry) + sz * o * Math.cos(ry), t, s + 0.02, t, M.wood, { tile: 0.8, ry });
      for (const yy of [y, y + s - t]) for (const sg of [-1, 1]) {
        const ox = sg * o * Math.cos(ry), oz = -sg * o * Math.sin(ry);
        b.box(cx + ox, yy, cz + oz, t * 0.9, t, s + 0.02, M.wood, { tile: 0.8, ry });
        b.box(cx + sg * o * Math.sin(ry), yy, cz + sg * o * Math.cos(ry), s + 0.02, t, t * 0.9, M.wood, { tile: 0.8, ry });
      }
    };
    place(x, z, 0, 1.2, 0);
    place(x + 1.3, z + 0.1, 0, 1.2, 0);
    if (n >= 2) place(x + 0.2, z + 0.05, 1.2, 1.1, 0);
    if (n >= 3) place(x - 1.25, z - 0.2, 0, 1.0, 0);
    this.blob(x + 0.7, z + 0.05, 4.2, 2.8, 0, 0.6);
  }

  private sandbags(_b: Builder, x: number, z: number, len: number, ry: number) {
    const M = this.mats;
    if (!this.bagGeo) this.bagGeo = new RoundedBoxGeometry(0.55, 0.24, 0.34, 3, 0.1);
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      const n = Math.round(len / 0.55) - (r % 2);
      for (let i = 0; i < n; i++) {
        const t = (i - (n - 1) / 2) * 0.53;
        const lx = t, lz = rr(-0.03, 0.03);
        const c = Math.cos(ry), s = Math.sin(ry);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(x + lx * c + lz * s, 0.12 + r * 0.205, z - lx * s + lz * c),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(-0.04, 0.04), ry + rr(-0.08, 0.08), rr(-0.05, 0.05))),
          new THREE.Vector3(rr(0.94, 1.08), rr(0.9, 1.1), rr(0.95, 1.12)),
        );
        this.merger.add(this.bagGeo, M.burlap, m);
      }
    }
    const sx = Math.abs(Math.cos(ry)) > 0.5 ? len : 0.7, sz = Math.abs(Math.cos(ry)) > 0.5 ? 0.7 : len;
    this.colliders.push({ min: new THREE.Vector3(x - sx / 2, 0, z - sz / 2), max: new THREE.Vector3(x + sx / 2, 0.85, z + sz / 2), tag: "fabric" });
    this.blob(x, z, sx + 1.6, sz + 1.6, 0, 0.5);
  }
  private bagGeo?: RoundedBoxGeometry;

  private hesco(b: Builder, x: number, z: number, len: number, ry: number) {
    const M = this.mats;
    const n = Math.round(len / 1.1);
    const c = Math.cos(ry), s = Math.sin(ry);
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * 1.1;
      b.box(x + t * c, 0, z - t * s, 1.08, 1.3, 1.08, M.hesco, { tile: 1.1, ry, tag: "fabric" });
      b.box(x + t * c, 1.3, z - t * s, 1.1, 0.05, 1.1, M.dirt, { tile: 1, ry });
    }
    const sx = Math.abs(c) > 0.5 ? len : 1.1, sz = Math.abs(c) > 0.5 ? 1.1 : len;
    this.colliders.push({ min: new THREE.Vector3(x - sx / 2, 0, z - sz / 2), max: new THREE.Vector3(x + sx / 2, 1.3, z + sz / 2), tag: "fabric" });
    this.blob(x, z, sx + 1.4, sz + 1.4, 0, 0.5);
  }

  private container(b: Builder, x: number, z: number, mat: THREE.MeshStandardMaterial, ry: number, tiers: number, yBase = 0) {
    const L = 6.05, W = 2.44, Hh = 2.6;
    const y0 = tiers === 2 ? Hh * 2 - 0.0 - Hh : yBase;
    void y0;
    const yy = tiers === 2 ? Hh : yBase;
    b.box(x, yy, z, L, Hh, W, mat, { c: true, tag: "metal", tile: 2.6, ry });
    const c = Math.cos(ry), s = Math.sin(ry);
    const P = (lx: number, lz: number) => [x + lx * c + lz * s, z - lx * s + lz * c] as const;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const [px, pz] = P(sx * (L / 2 - 0.08), sz * (W / 2 - 0.08));
      b.box(px, yy, pz, 0.17, Hh, 0.17, M_DARK(this), { tile: 0.5, ry });
    }
    for (const sz of [-1, 1]) {
      const [px, pz] = P(0, sz * (W / 2 - 0.07));
      b.box(px, yy + Hh - 0.1, pz, L, 0.14, 0.15, M_DARK(this), { tile: 0.5, ry });
      b.box(px, yy, pz, L, 0.14, 0.15, M_DARK(this), { tile: 0.5, ry });
    }
    // door bars on end
    for (let i = 0; i < 4; i++) { const [px, pz] = P(L / 2 + 0.05, -0.8 + i * 0.5); b.box(px, yy + 0.2, pz, 0.05, Hh - 0.4, 0.05, M_DARK(this), { tile: 0.5, ry }); }
    if (tiers === 1 || yBase === 0) this.blob(x, z, (Math.abs(c) > 0.5 ? L : W) + 2.4, (Math.abs(c) > 0.5 ? W : L) + 2.4, 0, 0.7);
  }

  private car(b: Builder, x: number, z: number, ry: number, mat: THREE.MeshStandardMaterial, burnt = false) {
    const M = this.mats;
    if (!this.carGeo) {
      const s = new THREE.Shape();
      const pts: [number, number][] = [[-2.15, 0.28], [-2.22, 0.55], [-2.2, 0.85], [-1.7, 0.98], [-1.15, 1.02], [-0.75, 1.5], [0.45, 1.5], [0.98, 1.03], [1.85, 0.92], [2.15, 0.78], [2.2, 0.52], [2.12, 0.28]];
      s.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 1.62, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1, bevelSegments: 3, curveSegments: 4 });
      g.translate(0, 0, -0.81);
      this.carGeo = g;
      const gs = new THREE.Shape();
      const gp: [number, number][] = [[-1.12, 1.04], [-0.76, 1.46], [0.44, 1.46], [0.93, 1.05]];
      gs.moveTo(gp[0][0], gp[0][1]);
      for (let i = 1; i < gp.length; i++) gs.lineTo(gp[i][0], gp[i][1]);
      gs.closePath();
      const gg = new THREE.ExtrudeGeometry(gs, { depth: 1.7, bevelEnabled: false });
      gg.translate(0, 0, -0.85);
      this.carGlass = gg;
      this.wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 18);
      this.wheelGeo.rotateX(Math.PI / 2);
      this.hubGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.26, 10);
      this.hubGeo.rotateX(Math.PI / 2);
    }
    b.geo(this.carGeo, mat, x, 0.12, z, { ry, c: true, size: [4.5, 1.6, 2.0], tag: "metal", cy: 0.8 });
    b.geo(this.carGlass!, burnt ? M.glassDark : M.glass, x, 0.12, z, { ry });
    const c = Math.cos(ry), s = Math.sin(ry);
    for (const lx of [-1.38, 1.38]) for (const lz of [-0.88, 0.88]) {
      const px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
      b.geo(this.wheelGeo!, M.rubber, px, 0.34, pz, { ry });
      b.geo(this.hubGeo!, M.darkMetal, px, 0.34, pz, { ry });
    }
    // bumpers / lights
    b.box(x + 2.25 * c, 0.3, z - 2.25 * s, 0.14, 0.26, 1.7, M.darkMetal, { ry, tile: 1 });
    b.box(x - 2.28 * c, 0.3, z + 2.28 * s, 0.14, 0.26, 1.7, M.darkMetal, { ry, tile: 1 });
    this.blob(x, z, (Math.abs(c) > 0.5 ? 6.4 : 3.8), (Math.abs(c) > 0.5 ? 3.8 : 6.4), 0, 0.7);
  }
  private carGeo?: THREE.ExtrudeGeometry;
  private carGlass?: THREE.ExtrudeGeometry;
  private wheelGeo?: THREE.CylinderGeometry;
  private hubGeo?: THREE.CylinderGeometry;

  private barrel(b: Builder, x: number, z: number, mat: THREE.MeshStandardMaterial, fire: boolean) {
    const M = this.mats;
    b.cyl(x, 0, z, 0.3, 0.92, mat, { seg: 18, c: true, tag: "metal" });
    for (const y of [0.22, 0.62]) b.cyl(x, y, z, 0.312, 0.05, mat, { seg: 18 });
    b.cyl(x, 0.92, z, 0.28, 0.025, M.darkMetal, { seg: 18 });
    this.blob(x, z, 1.5, 1.5, 0, 0.5);
    if (fire) {
      const light = new THREE.PointLight(0xff7a2a, 60, 28, 2);
      light.position.set(x, 1.5, z);
      this.group.add(light);
      this.fires.push({ pos: new THREE.Vector3(x, 1.0, z), light, seed: R() * 100, base: 60 });
      b.cyl(x, 0.9, z, 0.24, 0.03, M.carBurnt, { seg: 12 });
    }
  }

  private lamp(b: Builder, x: number, z: number, ry: number, light: boolean) {
    const M = this.mats;
    b.cyl(x, 0, z, 0.2, 0.25, M.darkMetal, { seg: 10 });
    b.cyl(x, 0.25, z, 0.07, 6.4, M.darkMetal, { seg: 8, c: true, tag: "metal" });
    const c = Math.cos(ry), s = Math.sin(ry);
    const ax = x + 0.9 * s, az = z + 0.9 * c;
    b.box(ax, 6.55, az, 0.14, 0.1, 1.9, M.darkMetal, { ry, tile: 1 });
    b.box(x + 1.7 * s, 6.42, z + 1.7 * c, 0.4, 0.14, 0.85, M.darkMetal, { ry, tile: 1 });
    b.box(x + 1.7 * s, 6.34, z + 1.7 * c, 0.34, 0.03, 0.75, M.lampGlow, { ry, tile: 1 });
    if (light) {
      const l = new THREE.PointLight(0xffc27a, 45, 30, 2);
      l.position.set(x + 1.7 * s, 6.0, z + 1.7 * c);
      this.group.add(l);
      this.lamps.push(l);
    }
  }

  private stall(b: Builder, x: number, z: number) {
    const M = this.mats;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(x + sx * 1.6, 0, z + sz * 1.0, 0.1, 2.5, 0.1, M.darkMetal, { tile: 1 });
    b.box(x, 2.45, z, 3.8, 0.05, 2.5, M.stripeA, { tile: 1.6, rx: 0.12 });
    b.box(x, 0, z + 0.5, 3.0, 0.9, 0.9, M.wood, { c: true, tag: "wood", tile: 1.2 });
  }

  private tire(b: Builder, x: number, z: number, i: number) {
    if (!this.tireGeo) { this.tireGeo = new THREE.TorusGeometry(0.28, 0.12, 8, 16); this.tireGeo.rotateX(Math.PI / 2); }
    b.geo(this.tireGeo, this.mats.rubber, x, 0.12 + i * 0.24, z, { ry: i });
  }
  private tireGeo?: THREE.TorusGeometry;
  private rubGeo?: THREE.IcosahedronGeometry;

  private rubble(x: number, z: number, s: number) {
    if (!this.rubGeo) this.rubGeo = new THREE.IcosahedronGeometry(1, 0);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, s * 0.3, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rr(0, 6), rr(0, 6), rr(0, 6))),
      new THREE.Vector3(s * rr(0.8, 1.5), s * rr(0.5, 0.9), s * rr(0.8, 1.4)),
    );
    this.merger.add(this.rubGeo, R() < 0.35 ? this.mats.brick : this.mats.concrete, m);
  }

  private rubbleHeap(x: number, z: number) {
    if (Math.abs(x) < 6 && Math.abs(z) < 6) return;
    for (let i = 0; i < 12; i++) this.rubble(x + rr(-1.1, 1.1), z + rr(-1.1, 1.1), rr(0.2, 0.55));
    this.colliders.push({ min: new THREE.Vector3(x - 1.0, 0, z - 1.0), max: new THREE.Vector3(x + 1.0, 0.32, z + 1.0), tag: "concrete" });
    this.blob(x, z, 4, 4, 0, 0.5);
  }

  /* ------------------------------ skyline ------------------------------ */
  private skyline() {
    const b = new Builder(this);
    const mats = [this.mats.concreteDark, this.mats.concrete, this.mats.plaster2, this.mats.plaster3];
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + rr(-0.05, 0.05);
      const d = rr(95, 170);
      const w = rr(14, 30), dd = rr(14, 30), h = rr(22, 75);
      const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
      b.box(cx, 0, cz, w, h, dd, pick(mats), { tile: 12 });
      if (R() < 0.4) b.box(cx + rr(-4, 4), h, cz, rr(5, 9), rr(6, 14), rr(5, 9), pick(mats), { tile: 12 });
      // window grid on the face looking at the plaza
      const alongX = Math.abs(cx) > Math.abs(cz);
      const sx = -Math.sign(cx), sz = -Math.sign(cz);
      const faceW = alongX ? dd : w;
      const cols = Math.floor(faceW / 3.4), rows = Math.floor((h - 3) / 3.8);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (R() < 0.12) continue;
        const off = (c - (cols - 1) / 2) * 3.4, y = 2.6 + r * 3.8;
        const mat = R() < 0.07 ? this.mats.glassLit : R() < 0.2 ? this.mats.glassDark : this.mats.glass;
        if (alongX) b.box(cx + sx * (w / 2 + 0.03), y, cz + off, 0.08, 1.9, 1.5, mat, { tile: 1 });
        else b.box(cx + off, y, cz + sz * (dd / 2 + 0.03), 1.5, 1.9, 0.08, mat, { tile: 1 });
      }
      if (alongX) for (let r = 1; r < rows; r++) b.box(cx + sx * (w / 2 + 0.05), 2.0 + r * 3.8 - 0.3, cz, 0.12, 0.3, faceW, this.mats.concrete, { tile: 2 });
    }
  }

  update(t: number) {
    for (const f of this.fires) {
      const k = 0.75 + 0.25 * Math.sin(t * 17 + f.seed) * Math.sin(t * 7.3 + f.seed * 2) + 0.12 * Math.sin(t * 31 + f.seed * 5);
      f.light.intensity = f.base * k;
    }
  }
}

function M_DARK(w: World) { return w.mats.darkMetal; }

/* ------------------------------ builder helper ------------------------------ */
class Builder {
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  constructor(private w: World, private frame = new THREE.Matrix4()) {}

  private mat(x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
    const local = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), this.q.setFromEuler(this.e.set(rx, ry, rz, "YXZ")), new THREE.Vector3(1, 1, 1));
    return new THREE.Matrix4().multiplyMatrices(this.frame, local);
  }

  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material, o: BoxOpts = {}) {
    const g = boxGeo(sx, sy, sz, o.tile ?? 2, R() * 4, R() * 4);
    const m = this.mat(x, y + sy / 2, z, o.ry, o.rx, o.rz);
    this.w.merger.add(g, mat, m);
    g.dispose();
    if (o.c) this.w.addCollider(m, sx, sy, sz, o.tag ?? "concrete");
  }

  cyl(x: number, y: number, z: number, r: number, h: number, mat: THREE.Material, o: { seg?: number; c?: boolean; tag?: Tag } = {}) {
    const g = new THREE.CylinderGeometry(r, r, h, o.seg ?? 12);
    const m = this.mat(x, y + h / 2, z);
    this.w.merger.add(g, mat, m);
    g.dispose();
    if (o.c) this.w.addCollider(m, r * 2, h, r * 2, o.tag ?? "metal");
  }

  geo(g: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, o: { ry?: number; c?: boolean; size?: [number, number, number]; tag?: Tag; cy?: number } = {}) {
    const m = this.mat(x, y, z, o.ry ?? 0);
    this.w.merger.add(g, mat, m);
    if (o.c && o.size) {
      const m2 = this.mat(x, y + (o.cy ?? 0), z, o.ry ?? 0);
      this.w.addCollider(m2, o.size[0] > o.size[2] && false ? 0 : o.size[0], o.size[1], o.size[2], o.tag ?? "concrete");
    }
  }

  /** unmerged mesh placed in frame */
  place(mesh: THREE.Object3D, x: number, y: number, z: number) {
    const m = this.mat(x, y, z);
    mesh.applyMatrix4(m);
    this.w.group.add(mesh);
  }
}

/* ------------------------------ sky + environment ------------------------------ */
export function buildSky(renderer: THREE.WebGLRenderer) {
  const sky = new Sky();
  sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  u.turbidity.value = 4;
  u.rayleigh.value = 1.3;
  u.mieCoefficient.value = 0.003;
  u.mieDirectionalG.value = 0.7;
  u.sunPosition.value.copy(SUN_DIR);

  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(4000);
  Object.keys(u).forEach((k) => { envSky.material.uniforms[k].value = u[k].value; });
  envScene.add(envSky);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(envScene, 0, 0.1, 5000);
  pm.dispose();
  envSky.geometry.dispose();
  return { sky, env: env.texture };
}
