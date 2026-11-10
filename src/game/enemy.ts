import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as T from "./textures";

/* ------------------------------ model factory ------------------------------ */
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

class PartList {
  list: THREE.BufferGeometry[] = [];
  add(geo: THREE.BufferGeometry, color: number | null, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    tmpM.compose(new THREE.Vector3(x, y, z), tmpQ.setFromEuler(tmpE.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(tmpM);
    const c = new THREE.Color(color ?? 0xffffff);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(k)) g.deleteAttribute(k);
    this.list.push(g);
  }
  build(mat: THREE.Material) {
    const g = mergeGeometries(this.list, false)!;
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
}

const cap = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 4, 10);
function roundBox(w: number, h: number, d: number, r: number) { return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)); }

interface Palette { vest: number; cloth: number; pants: number; helmet: number; skin: number; gear: number }
const PALETTES: Palette[] = [
  { vest: 0x3a3d30, cloth: 0x4a4f3a, pants: 0x3d4033, helmet: 0x2c2f26, skin: 0x111113, gear: 0x1b1b1b },
  { vest: 0x6b5d45, cloth: 0x5a5340, pants: 0x4a4536, helmet: 0x544a38, skin: 0x1a1a1c, gear: 0x2a2620 },
  { vest: 0x1d1f22, cloth: 0x2b2e33, pants: 0x23262a, helmet: 0x17181a, skin: 0x0c0c0d, gear: 0x0f0f10 },
  { vest: 0x4a4e52, cloth: 0x5c6160, pants: 0x3d4146, helmet: 0x34383b, skin: 0x161618, gear: 0x1a1d1f },
];

let sharedMat: THREE.MeshStandardMaterial | null = null;
let rifleMat: THREE.MeshStandardMaterial | null = null;
let flashMat: THREE.MeshBasicMaterial | null = null;
const variants: THREE.Group[] = [];

function getMaterials() {
  if (!sharedMat) {
    const f = T.makeFabric(1);
    for (const t of [f.map, f.normalMap, f.roughnessMap]) t.repeat.set(0.25, 0.25);
    sharedMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: f.map, normalMap: f.normalMap, roughnessMap: f.roughnessMap, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1.4, 1.4) });
    rifleMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.42, metalness: 0.85 });
    flashMat = new THREE.MeshBasicMaterial({ map: T.makeFlash(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(3, 2.2, 1.2), side: THREE.DoubleSide });
  }
  return { mat: sharedMat!, rifle: rifleMat!, flash: flashMat! };
}

function buildVariant(pi: number): THREE.Group {
  const P = PALETTES[pi % PALETTES.length];
  const { mat, rifle, flash } = getMaterials();
  const root = new THREE.Group(); // body root at feet
  const hips = new THREE.Group(); hips.position.y = 0.93; hips.name = "hips"; root.add(hips);

  // pelvis
  const pel = new PartList();
  pel.add(roundBox(0.36, 0.2, 0.22, 0.05), P.pants, 0, 0.0, 0);
  pel.add(roundBox(0.38, 0.06, 0.24, 0.02), P.gear, 0, 0.1, 0); // belt
  pel.add(roundBox(0.08, 0.14, 0.06, 0.015), P.gear, 0.2, 0.0, 0.04); // holster
  hips.add(pel.build(mat));

  // torso
  const torso = new THREE.Group(); torso.position.y = 0.1; torso.name = "torso"; hips.add(torso);
  const tp = new PartList();
  tp.add(roundBox(0.38, 0.46, 0.22, 0.06), P.cloth, 0, 0.26, 0);
  tp.add(roundBox(0.4, 0.38, 0.27, 0.05), P.vest, 0, 0.3, 0.005);
  for (let i = -1; i <= 1; i++) tp.add(roundBox(0.095, 0.13, 0.06, 0.02), P.gear, i * 0.115, 0.16, 0.16);
  tp.add(roundBox(0.14, 0.1, 0.05, 0.015), P.gear, 0, 0.35, 0.17);
  tp.add(roundBox(0.3, 0.36, 0.13, 0.04), P.vest, 0, 0.3, -0.17); // pack
  tp.add(roundBox(0.12, 0.2, 0.09, 0.02), P.gear, 0.14, 0.17, -0.2);
  tp.add(cap(0.05, 0.04), P.cloth, 0, 0.55, 0);
  // head (balaclava) + helmet + goggles
  tp.add(new THREE.SphereGeometry(0.098, 14, 12), P.skin, 0, 0.67, 0.0, 0, 0, 0, 0.95, 1.1, 1.0);
  const helm = new THREE.SphereGeometry(0.128, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.56);
  tp.add(helm, P.helmet, 0, 0.7, -0.005, 0, 0, 0, 1.0, 0.95, 1.08);
  tp.add(roundBox(0.3, 0.012, 0.3, 0.005), P.helmet, 0, 0.705, 0.0); // brim
  tp.add(roundBox(0.17, 0.05, 0.05, 0.012), 0x0d1520, 0, 0.675, 0.085);
  tp.add(roundBox(0.05, 0.05, 0.05, 0.01), P.gear, 0, 0.775, 0.1); // NVG mount
  tp.add(roundBox(0.34, 0.16, 0.2, 0.06), P.vest, 0, 0.5, -0.02, 0, 0, 0); // shoulder/collar
  torso.add(tp.build(mat));

  // arms
  const mkArm = (side: 1 | -1) => {
    const sh = new THREE.Group(); sh.position.set(side * 0.235, 0.46, 0.0);
    const up = new PartList();
    up.add(cap(0.052, 0.17), P.cloth, 0, -0.14, 0);
    up.add(roundBox(0.1, 0.08, 0.1, 0.03), P.vest, 0, 0.0, 0);
    sh.add(up.build(mat));
    const el = new THREE.Group(); el.position.y = -0.28; sh.add(el);
    const lo = new PartList();
    lo.add(cap(0.043, 0.17), P.cloth, 0, -0.13, 0);
    lo.add(roundBox(0.075, 0.095, 0.05, 0.02), P.gear, 0, -0.27, 0.0); // glove
    lo.add(roundBox(0.1, 0.05, 0.1, 0.02), P.gear, 0, -0.04, 0); // elbow pad
    el.add(lo.build(mat));
    torso.add(sh);
    return { sh, el };
  };
  const rArm = mkArm(1), lArm = mkArm(-1);
  rArm.sh.rotation.set(-0.95, 0.25, -0.12); rArm.el.rotation.set(-1.25, 0.1, 0);
  lArm.sh.rotation.set(-1.35, -0.45, 0.05); lArm.el.rotation.set(-0.35, 0.0, 0);

  // rifle on torso
  const rg = new THREE.Group(); rg.position.set(0.06, 0.32, 0.27); rg.name = "rifle";
  const rp = new PartList();
  rp.add(roundBox(0.06, 0.09, 0.34, 0.01), null, 0, 0, 0);
  rp.add(roundBox(0.05, 0.06, 0.34, 0.01), null, 0, 0.005, 0.36);
  rp.add(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 8).rotateX(Math.PI / 2), null, 0, 0.01, 0.66);
  rp.add(roundBox(0.045, 0.16, 0.07, 0.01), null, 0, -0.1, 0.0, 0.15, 0, 0);
  rp.add(roundBox(0.04, 0.1, 0.05, 0.01), null, 0, -0.07, -0.08, -0.4, 0, 0);
  rp.add(roundBox(0.05, 0.1, 0.2, 0.02), null, 0, -0.01, -0.26);
  rp.add(roundBox(0.04, 0.045, 0.09, 0.01), null, 0, 0.07, 0.0);
  const rm = rp.build(rifle); rg.add(rm);
  const mz = new THREE.Object3D(); mz.position.set(0, 0.01, 0.84); mz.name = "muzzle"; rg.add(mz);
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), flash); fl.name = "flash"; fl.visible = false; fl.position.z = 0.1;
  const fl2 = fl.clone(); fl2.rotation.y = Math.PI / 2; fl.add(fl2);
  mz.add(fl);
  torso.add(rg);
  rg.rotation.x = -0.03;

  // legs
  const mkLeg = (side: 1 | -1) => {
    const th = new THREE.Group(); th.position.set(side * 0.1, -0.02, 0);
    const tl = new PartList();
    tl.add(cap(0.082, 0.28), P.pants, 0, -0.23, 0);
    tl.add(roundBox(0.12, 0.14, 0.04, 0.02), P.gear, side * 0.0, -0.15, 0.08);
    th.add(tl.build(mat));
    const kn = new THREE.Group(); kn.position.y = -0.45; th.add(kn);
    const sl = new PartList();
    sl.add(cap(0.062, 0.28), P.pants, 0, -0.2, 0);
    sl.add(roundBox(0.1, 0.1, 0.06, 0.03), P.gear, 0, 0.0, 0.05);
    sl.add(roundBox(0.12, 0.1, 0.28, 0.035), P.gear, 0, -0.42, 0.05);
    kn.add(sl.build(mat));
    hips.add(th);
    return { th, kn };
  };
  const rl = mkLeg(1), ll = mkLeg(-1);
  rl.th.name = "thR"; rl.kn.name = "knR"; ll.th.name = "thL"; ll.kn.name = "knL";
  root.userData = { hips, torso, rArm, lArm, rl, ll, rifle: rg, muzzle: mz, flash: fl };
  return root;
}

function cloneVariant(i: number): THREE.Group {
  if (!variants[i % PALETTES.length]) variants[i % PALETTES.length] = buildVariant(i);
  const src = variants[i % PALETTES.length];
  // deep clone sharing geometry & materials
  const g = src.clone(true);
  const find = (n: string) => g.getObjectByName(n)!;
  const hips = find("hips"), torso = find("torso");
  const rifleG = find("rifle");
  const flash = find("flash") as THREE.Mesh;
  g.userData = {
    hips, torso, rifle: rifleG, muzzle: find("muzzle"), flash,
    thR: find("thR"), knR: find("knR"), thL: find("thL"), knL: find("knL"),
  };
  // arms: first group children of torso named by index (shoulders)
  const arms = torso.children.filter((c) => c.type === "Group" && c.name === "");
  g.userData.armR = arms[0]; g.userData.armL = arms[1];
  return g;
}

/* ------------------------------ enemy logic ------------------------------ */
export type Zone = "head" | "torso" | "legs";
export interface EnemyCtx {
  playerPos: THREE.Vector3; // feet
  playerEye: THREE.Vector3;
  playerSprint: boolean; playerCrouch: boolean;
  los(a: THREE.Vector3, b: THREE.Vector3): boolean;
  collide(p: THREE.Vector3, r: number): number; // returns push distance
  onShoot(e: Enemy, from: THREE.Vector3, hitChance: number): void;
  time: number;
  arena: number;
}

const BOXES: { zone: Zone; c: [number, number, number]; h: [number, number, number] }[] = [
  { zone: "head", c: [0, 1.66, 0.01], h: [0.13, 0.14, 0.14] },
  { zone: "torso", c: [0, 1.25, 0.02], h: [0.29, 0.31, 0.2] },
  { zone: "legs", c: [0, 0.5, 0.0], h: [0.21, 0.52, 0.15] },
];

export class Enemy {
  group: THREE.Group;
  health = 100;
  dead = false;
  deathT = 0;
  fallDir = -1;
  yaw = 0;
  phase = Math.random() * 6;
  private goal = new THREE.Vector3();
  private hasGoal = false;
  private goalT = 0;
  private holdT = 0;
  private shootCd = 1 + Math.random();
  private burst = 0;
  private reaction = 0.4 + Math.random() * 0.5;
  private seen = 0;
  private losT = 0;
  private los = false;
  private flinch = 0;
  private stuckT = 0;
  private lastPos = new THREE.Vector3();
  private speed = 0;
  private flashT = 0;
  private ud: Record<string, THREE.Object3D>;
  private fireKick = 0;
  private maxSpeed = 3.2 + Math.random() * 0.8;
  strafeDir = Math.random() < 0.5 ? 1 : -1;
  radius = 0.36;
  id: number;
  static counter = 0;

  constructor(pos: THREE.Vector3, variant: number) {
    this.group = cloneVariant(variant);
    this.ud = this.group.userData as Record<string, THREE.Object3D>;
    this.group.position.copy(pos);
    this.group.rotation.order = "YXZ";
    this.id = Enemy.counter++;
    this.lastPos.copy(pos);
  }

  get pos() { return this.group.position; }

  muzzleWorld(out: THREE.Vector3) { this.group.updateMatrixWorld(true); return this.ud.muzzle.getWorldPosition(out); }

  /** Ray vs hit boxes in local yaw frame. returns [t, zone] */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxT: number): { t: number; zone: Zone } | null {
    if (this.dead) return null;
    const c = Math.cos(-this.yaw), s = Math.sin(-this.yaw);
    const ox = o.x - this.pos.x, oy = o.y - this.pos.y, oz = o.z - this.pos.z;
    const lo = [ox * c + oz * s, oy, -ox * s + oz * c];
    const ld = [d.x * c + d.z * s, d.y, -d.x * s + d.z * c];
    let best: { t: number; zone: Zone } | null = null;
    for (const b of BOXES) {
      let t0 = 0, t1 = maxT, ok = true;
      for (let a = 0; a < 3; a++) {
        const mn = b.c[a] - b.h[a], mx = b.c[a] + b.h[a];
        if (Math.abs(ld[a]) < 1e-8) { if (lo[a] < mn || lo[a] > mx) { ok = false; break; } }
        else {
          let ta = (mn - lo[a]) / ld[a], tb = (mx - lo[a]) / ld[a];
          if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
          t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
          if (t0 > t1) { ok = false; break; }
        }
      }
      if (ok && (!best || t0 < best.t)) best = { t: t0, zone: b.zone };
    }
    return best;
  }

  damage(amount: number, dirX: number, dirZ: number) {
    this.health -= amount;
    this.flinch = 1;
    this.seen = Math.max(this.seen, 1);
    if (this.health <= 0 && !this.dead) {
      this.dead = true; this.deathT = 0;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      this.fallDir = fx * dirX + fz * dirZ > 0 ? -1 : 1; // shot from front -> fall backwards
      return true;
    }
    return false;
  }

  update(dt: number, ctx: EnemyCtx) {
    const g = this.group;
    const hips = this.ud.hips, torso = this.ud.torso;
    if (this.dead) {
      this.deathT += dt;
      const t = Math.min(1, this.deathT / 0.75);
      const e = 1 - Math.pow(1 - t, 2.2);
      g.rotation.x = this.fallDir * e * (Math.PI / 2 - 0.05);
      g.position.y = 0.12 * e - Math.max(0, this.deathT - 9) * 0.3;
      this.ud.thR.rotation.x = -0.5 * e; this.ud.thL.rotation.x = 0.3 * e;
      this.ud.thR.rotation.z = -0.25 * e; this.ud.thL.rotation.z = 0.3 * e;
      this.ud.knR.rotation.x = 0.7 * e; this.ud.knL.rotation.x = 0.4 * e;
      const a = this.ud.armR as THREE.Group, b = this.ud.armL as THREE.Group;
      a.rotation.z = -0.7 * e; b.rotation.z = 0.8 * e; a.rotation.x = -0.2 * e; b.rotation.x = -0.1 * e;
      return;
    }

    const toP = new THREE.Vector3().subVectors(ctx.playerPos, g.position); toP.y = 0;
    const dist = toP.length();

    // line-of-sight (throttled)
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.2 + Math.random() * 0.1;
      const eye = new THREE.Vector3(g.position.x, 1.6, g.position.z);
      this.los = dist < 85 && ctx.los(eye, ctx.playerEye);
    }
    if (this.los) this.seen += dt; else this.seen = Math.max(0, this.seen - dt * 0.5);

    // goal selection
    this.goalT -= dt;
    if (!this.hasGoal || this.goalT <= 0) {
      if (this.holdT > 0) { this.holdT -= dt; this.hasGoal = false; this.goalT = 0; }
      if (this.holdT <= 0) {
        const a = Math.atan2(g.position.x - ctx.playerPos.x, g.position.z - ctx.playerPos.z) + (Math.random() - 0.5) * 2.2;
        const r = 10 + Math.random() * 20;
        this.goal.set(ctx.playerPos.x + Math.sin(a) * r, 0, ctx.playerPos.z + Math.cos(a) * r);
        const lim = ctx.arena - 3;
        this.goal.x = THREE.MathUtils.clamp(this.goal.x, -lim, lim);
        this.goal.z = THREE.MathUtils.clamp(this.goal.z, -lim, lim);
        this.hasGoal = true; this.goalT = 4 + Math.random() * 4;
        this.holdT = 0;
      }
    }

    // movement
    const moveV = new THREE.Vector3();
    let wantSpeed = 0;
    if (this.hasGoal) {
      moveV.subVectors(this.goal, g.position); moveV.y = 0;
      const gd = moveV.length();
      if (gd < 1.2) { this.hasGoal = false; this.holdT = 1.5 + Math.random() * 2.5; this.goalT = this.holdT; }
      else {
        moveV.divideScalar(gd);
        wantSpeed = this.maxSpeed * (dist < 7 ? 0.5 : 1);
        if (this.strafeDir !== 0 && this.los && dist < 25) { // sidestep while engaging
          moveV.x += -moveV.z * 0.5 * this.strafeDir; moveV.z += moveV.x * 0.0; moveV.normalize();
        }
      }
    }
    this.speed = THREE.MathUtils.lerp(this.speed, wantSpeed * (this.flinch > 0.6 ? 0.3 : 1), 1 - Math.exp(-dt * 6));
    g.position.x += moveV.x * this.speed * dt;
    g.position.z += moveV.z * this.speed * dt;
    const pushed = ctx.collide(g.position, this.radius);
    // separation from stuck
    const moved = g.position.distanceTo(this.lastPos);
    this.lastPos.copy(g.position);
    if (wantSpeed > 0 && moved < wantSpeed * dt * 0.25) { this.stuckT += dt; } else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 0.5 || pushed > 0.4) { this.stuckT = 0; this.hasGoal = false; this.holdT = 0; this.goalT = 0; this.strafeDir *= -1;
      const a = Math.random() * 6.28; this.goal.set(g.position.x + Math.sin(a) * 8, 0, g.position.z + Math.cos(a) * 8); this.hasGoal = true; this.goalT = 2; }

    // facing
    let tgtYaw = this.yaw;
    const engaging = this.los && this.seen > 0.2;
    if (engaging) tgtYaw = Math.atan2(toP.x, toP.z);
    else if (this.speed > 0.3) tgtYaw = Math.atan2(moveV.x, moveV.z);
    let dy = tgtYaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += THREE.MathUtils.clamp(dy, -7 * dt, 7 * dt);
    g.rotation.y = this.yaw;

    // shooting
    this.shootCd -= dt;
    if (engaging && this.seen > this.reaction && Math.abs(dy) < 0.35 && dist < 75) {
      if (this.burst > 0 && this.shootCd <= 0) {
        this.burst--;
        this.shootCd = 0.1 + Math.random() * 0.03;
        if (this.burst === 0) this.shootCd = 0.7 + Math.random() * 1.3;
        const moving = this.speed > 1;
        let hc = 0.62 - dist * 0.011 - (moving ? 0.14 : 0);
        if (ctx.playerSprint) hc *= 0.8;
        if (ctx.playerCrouch) hc *= 0.88;
        hc = THREE.MathUtils.clamp(hc, 0.07, 0.7);
        const from = this.muzzleWorld(new THREE.Vector3());
        ctx.onShoot(this, from, hc);
        this.flashT = 0.05; this.fireKick = 1;
      } else if (this.burst <= 0 && this.shootCd <= 0) {
        this.burst = 3 + Math.floor(Math.random() * 5);
        this.shootCd = 0.05;
      }
    } else if (!engaging) this.burst = 0;

    // flash
    const fl = this.ud.flash as THREE.Mesh;
    if (this.flashT > 0) { this.flashT -= dt; fl.visible = this.flashT > 0; fl.rotation.z = Math.random() * 6; fl.scale.setScalar(0.7 + Math.random() * 0.6); } else fl.visible = false;
    this.fireKick = Math.max(0, this.fireKick - dt * 12);
    this.flinch = Math.max(0, this.flinch - dt * 4);

    // animation
    this.phase += dt * this.speed * 2.6;
    const sp = Math.min(1, this.speed / 3);
    const p = this.phase;
    this.ud.thR.rotation.x = Math.sin(p) * 0.85 * sp; this.ud.thL.rotation.x = -Math.sin(p) * 0.85 * sp;
    this.ud.knR.rotation.x = Math.max(0, -Math.sin(p + 0.9)) * 1.2 * sp + 0.12; this.ud.knL.rotation.x = Math.max(0, Math.sin(p + 0.9)) * 1.2 * sp + 0.12;
    this.ud.thR.rotation.z = 0; this.ud.thL.rotation.z = 0;
    hips.position.y = 0.93 - 0.03 + Math.abs(Math.cos(p)) * 0.035 * sp;
    hips.rotation.y = Math.sin(p) * 0.12 * sp;
    torso.rotation.y = -Math.sin(p) * 0.08 * sp + (engaging ? 0.12 : 0);
    torso.rotation.x = 0.06 + sp * 0.08 + this.fireKick * -0.03 + this.flinch * 0.25;
    torso.rotation.z = this.flinch * 0.1;
    const rf = this.ud.rifle; rf.position.z = 0.27 - this.fireKick * 0.03;
    const a = this.ud.armR as THREE.Group, b = this.ud.armL as THREE.Group;
    a.rotation.set(-0.95 - Math.sin(p) * 0.08 * sp, 0.25, -0.12); b.rotation.set(-1.35 + Math.sin(p) * 0.06 * sp, -0.45, 0.05);
    g.rotation.x = 0;
    g.position.y = 0;
  }
}
