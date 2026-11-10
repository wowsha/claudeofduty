import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as T from "./textures";
import type { AudioEngine } from "./audio";

/* ----------------------- tiny helpers ----------------------- */
class Spring {
  x = 0; v = 0;
  constructor(public k = 200, public c = 18) {}
  step(dt: number, target = 0) {
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = -this.k * (this.x - target) - this.c * this.v;
      this.v += a * h; this.x += this.v * h;
    }
  }
}

function kf(u: number, keys: number[][]): number[] {
  if (u <= keys[0][0]) return keys[0].slice(1);
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i];
      let t = (u - a[0]) / (b[0] - a[0]);
      t = t * t * (3 - 2 * t);
      return a.slice(1).map((v, j) => v + (b[j + 1] - v) * t);
    }
  }
  return keys[keys.length - 1].slice(1);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sstep = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

const rbox = (w: number, h: number, d: number, r = 0.004) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.0001, h / 2 - 0.0001, d / 2 - 0.0001));

interface Shell { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number; tink: boolean }

export interface VMState {
  speed01: number; sprint: boolean; ads: number; lookX: number; lookY: number;
  grounded: boolean; crouch: boolean; t: number; camQuat: THREE.Quaternion; sunDir: THREE.Vector3;
  strafe: number; landKick: number;
}

export class Viewmodel {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
  root = new THREE.Group();
  gun = new THREE.Group();
  private mag = new THREE.Group();
  private bolt = new THREE.Group();
  private lHand = new THREE.Group();
  private rHand = new THREE.Group();
  private lArm: THREE.Mesh; private rArm: THREE.Mesh;
  private muzzle = new THREE.Object3D();
  private port = new THREE.Object3D();
  private flash = new THREE.Group();
  private flashMats: THREE.MeshBasicMaterial[] = [];
  private flashLight = new THREE.PointLight(0xffa050, 0, 2.5, 2);
  private sun = new THREE.DirectionalLight(0xfff0dd, 3.2);
  private hemi = new THREE.HemisphereLight(0xaac4ff, 0x6a5440, 0.9);
  private flashT = 0;
  private shells: Shell[] = [];
  private fallingMag?: { mesh: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3; life: number };
  private magProto!: THREE.Group;

  // springs
  private recZ = new Spring(260, 22); private recY = new Spring(260, 22);
  private recRX = new Spring(220, 17); private recRY = new Spring(220, 17); private recRZ = new Spring(220, 17);
  private swayX = new Spring(60, 10); private swayY = new Spring(60, 10);
  private landS = new Spring(120, 12);
  private boltK = 0;
  private bobPhase = 0;
  private bobAmt = 0;
  private sprintK = 0;
  private equipK = 0;

  // reload
  reloading = false;
  reloadU = 0;
  reloadDur = 2.45;
  private reloadFlags = { out: false, drop: false, in: false, bolt: false, fwd: false, commit: false };
  onReloadCommit?: () => void;
  onReloadDone?: () => void;
  private audio: AudioEngine;

  private L0 = new THREE.Vector3(0.0, -0.075, -0.37);
  private R0 = new THREE.Vector3(0, -0.16, 0.115);
  private sightLocal = new THREE.Vector3(0, 0.098, -0.075);
  hipPos = new THREE.Vector3(0.115, -0.118, -0.47);

  constructor(env: THREE.Texture, audio: AudioEngine) {
    this.audio = audio;
    this.scene.environment = env;
    this.scene.environmentIntensity = 1.0;
    this.scene.add(this.sun, this.hemi, this.flashLight);
    this.camera.position.set(0, 0, 0);
    this.scene.add(this.camera);
    this.scene.add(this.root);
    this.root.add(this.gun);
    this.buildGun();
    this.buildHands();
    this.buildFlash();
    this.lArm = this.makeArm(); this.rArm = this.makeArm();
    this.scene.add(this.lArm, this.rArm);
    this.root.position.copy(this.hipPos);
    // shells
    const sg = new THREE.CylinderGeometry(0.0055, 0.0065, 0.022, 8);
    const sm = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.28 });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(sg, sm); m.visible = false; this.scene.add(m);
      this.shells.push({ mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, tink: false });
    }
  }

  setAspect(a: number) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  /** hip->ads blend uses sight alignment */
  private adsPos(): THREE.Vector3 {
    return new THREE.Vector3(-this.sightLocal.x, -this.sightLocal.y, -0.4 - this.sightLocal.z);
  }

  /* ------------------------------ geometry ------------------------------ */
  private buildGun() {
    const metalSet = T.makeGunMetal(90, 0.15);
    const alumSet = T.makeGunMetal(92, 0.19);
    const polySet = T.makePolymer(95, 0.11);
    const mkMetal = (set: T.TexSet, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap, roughness: 1, metalness: 0.92, ...o });
    const steel = mkMetal(metalSet, { color: 0xffffff });
    const alum = mkMetal(alumSet, { metalness: 0.85 });
    const poly = new THREE.MeshStandardMaterial({ map: polySet.map, normalMap: polySet.normalMap, roughnessMap: polySet.roughnessMap, roughness: 1, metalness: 0.0, normalScale: new THREE.Vector2(1.5, 1.5) });
    const dark = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.5, metalness: 0.6 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.3 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fc8ff, roughness: 0.02, metalness: 0.0, transparent: true, opacity: 0.1, envMapIntensity: 2.5, depthWrite: false });
    const tex = (() => {
      const c = document.createElement("canvas"); c.width = c.height = 128;
      const g = c.getContext("2d")!;
      g.clearRect(0, 0, 128, 128);
      g.strokeStyle = "rgba(255,40,30,1)"; g.lineWidth = 4;
      g.shadowColor = "rgba(255,60,40,1)"; g.shadowBlur = 8;
      g.beginPath(); g.arc(64, 64, 34, 0, 7); g.stroke();
      g.fillStyle = "rgba(255,60,40,1)"; g.beginPath(); g.arc(64, 64, 3.4, 0, 7); g.fill();
      for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) { g.fillRect(64 + Math.cos(a) * 34 - 1.5 + (a === 0 ? 0 : 0), 64 + Math.sin(a) * 34 - 1.5, 3, 3); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const reticle = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(2.5, 2.5, 2.5), toneMapped: true });

    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
      parent.add(m);
      return m;
    };
    const cyl = (r: number, len: number, seg = 20) => { const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateX(Math.PI / 2); return g; };
    const G = this.gun;

    // upper receiver + lower receiver
    add(G, rbox(0.058, 0.062, 0.27, 0.008), alum, 0, 0.0, -0.045);
    add(G, rbox(0.054, 0.082, 0.17, 0.007), alum, 0, -0.065, 0.02);
    // magwell
    add(G, rbox(0.05, 0.05, 0.075, 0.005), alum, 0, -0.11, -0.045);
    // ejection port cover + dust cover
    add(G, rbox(0.004, 0.026, 0.07, 0.001), dark, 0.0305, 0.008, -0.01);
    add(G, rbox(0.006, 0.024, 0.056, 0.002), steel, -0.031, 0.01, -0.01);
    // forward assist & receiver detail
    add(G, rbox(0.016, 0.02, 0.026, 0.004), alum, 0.036, -0.005, 0.06);
    // handguard (free float, M-LOK slots)
    add(G, rbox(0.066, 0.068, 0.34, 0.012), poly, 0, 0.002, -0.37);
    for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) {
      add(G, rbox(0.003, 0.014, 0.03, 0.001), dark, sx * 0.0335, 0.0, -0.245 - i * 0.052);
      add(G, rbox(0.014, 0.003, 0.03, 0.001), dark, sx * 0.0, -0.0345 + 0, -0.245 - i * 0.052 + 0.0).position.x = 0;
    }
    // top rail with teeth
    add(G, rbox(0.028, 0.012, 0.64, 0.002), steel, 0, 0.037, -0.2);
    const toothG = rbox(0.03, 0.006, 0.006, 0.001);
    for (let i = 0; i < 44; i++) add(G, toothG, steel, 0, 0.0445, 0.1 - i * 0.0145);
    // barrel + gas block + muzzle
    add(G, cyl(0.0105, 0.25), steel, 0, 0.002, -0.62);
    add(G, cyl(0.016, 0.034), steel, 0, 0.002, -0.54);
    add(G, rbox(0.022, 0.03, 0.03, 0.004), steel, 0, 0.026, -0.55);
    add(G, cyl(0.0175, 0.075, 24), steel, 0, 0.002, -0.76);
    for (let i = 0; i < 4; i++) add(G, cyl(0.0182, 0.006, 24), dark, 0, 0.002, -0.74 - i * 0.012);
    add(G, cyl(0.009, 0.02, 12), dark, 0, 0.002, -0.80);
    // front sight post
    add(G, rbox(0.006, 0.04, 0.008, 0.001), steel, 0, 0.06, -0.56);
    // grip, trigger guard
    add(G, rbox(0.044, 0.11, 0.05, 0.012), poly, 0, -0.145, 0.11, -0.38, 0, 0);
    add(G, rbox(0.012, 0.012, 0.09, 0.003), alum, 0, -0.1, 0.045);
    add(G, rbox(0.008, 0.024, 0.006, 0.002), dark, 0, -0.095, 0.03, 0.2, 0, 0);
    // stock
    add(G, cyl(0.022, 0.2, 14), alum, 0, -0.012, 0.25);
    add(G, rbox(0.048, 0.1, 0.17, 0.014), poly, 0, -0.03, 0.31, 0.09, 0, 0);
    add(G, rbox(0.05, 0.11, 0.025, 0.008), dark, 0, -0.035, 0.405, 0.09, 0, 0);
    // charging handle
    add(G, rbox(0.04, 0.012, 0.03, 0.003), alum, 0, 0.046, 0.115);
    add(G, rbox(0.012, 0.012, 0.04, 0.002), dark, -0.017, 0.045, 0.125);
    // angled foregrip
    add(G, rbox(0.032, 0.09, 0.045, 0.012), poly, 0, -0.07, -0.30, -0.2, 0, 0);
    add(G, rbox(0.04, 0.012, 0.07, 0.003), alum, 0, -0.033, -0.285);

    // bolt carrier visible through port
    this.bolt.position.set(0.0275, 0.008, -0.02);
    add(this.bolt, rbox(0.006, 0.014, 0.034, 0.002), steel, 0, 0, 0);
    G.add(this.bolt);

    // optic – open holographic style
    const so = this.sightLocal;
    add(G, rbox(0.052, 0.012, 0.09, 0.003), dark, 0, 0.0555, so.z + 0.01);
    add(G, rbox(0.048, 0.008, 0.07, 0.003), alum, 0, 0.049, so.z + 0.01);
    // frame
    for (const sx of [-1, 1]) add(G, rbox(0.006, 0.062, 0.06, 0.002), dark, sx * 0.0255, 0.0865, so.z);
    add(G, rbox(0.054, 0.007, 0.06, 0.002), dark, 0, 0.1185, so.z);
    void glassMat;
    const ret = add(G, new THREE.PlaneGeometry(0.046, 0.046), reticle, 0, so.y, so.z - 0.001);
    ret.renderOrder = 10;
    // rear small details: rear sight / laser
    add(G, rbox(0.022, 0.026, 0.06, 0.004), dark, 0.0435, -0.0, -0.38);
    add(G, cyl(0.007, 0.012, 10), brass, 0.0435, 0.0, -0.415);

    // muzzle / port anchors
    this.muzzle.position.set(0, 0.002, -0.84); G.add(this.muzzle);
    this.port.position.set(0.04, 0.012, -0.02); G.add(this.port);

    // magazine (separate group)
    const mg = this.mag;
    add(mg, rbox(0.04, 0.17, 0.08, 0.004), poly, 0, -0.085, 0, 0.0, 0, 0).rotation.x = 0.12;
    add(mg, rbox(0.043, 0.014, 0.088, 0.003), dark, 0, -0.178, 0.01);
    add(mg, rbox(0.032, 0.022, 0.07, 0.003), steel, 0, -0.003, 0);
    for (let i = 0; i < 4; i++) add(mg, rbox(0.044, 0.003, 0.082, 0.001), dark, 0, -0.04 - i * 0.03, 0.006 * i * 0.3);
    mg.position.set(0, -0.125, -0.045);
    G.add(mg);
    this.magProto = mg;
  }

  private buildHands() {
    const gloveSet = T.makeFabric(0.08);
    const glove = new THREE.MeshStandardMaterial({ map: gloveSet.map, normalMap: gloveSet.normalMap, roughnessMap: gloveSet.roughnessMap, roughness: 1, color: 0x2a2a2c, normalScale: new THREE.Vector2(1.6, 1.6) });
    const knuckle = new THREE.MeshStandardMaterial({ color: 0x151516, roughness: 0.55, metalness: 0.1 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.8 });
    void skin;
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
    };
    const cap = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 4, 10);

    // LEFT hand: under handguard (support grip)
    const L = this.lHand;
    add(L, rbox(0.078, 0.042, 0.1, 0.014), glove, 0, 0, 0);
    add(L, rbox(0.074, 0.016, 0.03, 0.006), knuckle, 0, 0.018, -0.045);
    for (let i = 0; i < 4; i++) {
      const f = add(L, cap(0.0095, 0.04), glove, -0.027 + i * 0.0185, 0.028, -0.062, Math.PI / 2 - 0.2, 0, 0);
      f.scale.set(1, 1, 1);
      add(L, rbox(0.016, 0.012, 0.016, 0.005), knuckle, -0.027 + i * 0.0185, 0.036, -0.088);
    }
    // thumb on left side
    add(L, cap(0.011, 0.05), glove, -0.043, 0.012, -0.04, Math.PI / 2 + 0.1, 0, 0.2);
    // wrist/cuff
    add(L, cap(0.034, 0.05), glove, -0.012, -0.012, 0.075, Math.PI / 2, 0, 0);
    this.root.add(L);
    L.position.copy(this.L0);

    // RIGHT hand on grip
    const Rh = this.rHand;
    add(Rh, rbox(0.052, 0.07, 0.06, 0.016), glove, 0.004, 0.0, 0.012);
    for (let i = 0; i < 3; i++) {
      add(Rh, cap(0.0095, 0.034), glove, -0.028, -0.012 - i * 0.0185 + 0.014, -0.012, 0, 0, Math.PI / 2 + 0.12);
      add(Rh, rbox(0.014, 0.016, 0.014, 0.005), knuckle, -0.04, -0.012 - i * 0.0185 + 0.014, -0.014);
    }
    // trigger finger
    add(Rh, cap(0.0085, 0.05), glove, -0.012, 0.038, -0.036, Math.PI / 2 - 0.1, 0, 0);
    add(Rh, cap(0.012, 0.045), glove, 0.03, 0.025, -0.01, Math.PI / 2 + 0.7, 0, 0);
    add(Rh, cap(0.033, 0.05), glove, 0.008, -0.03, 0.065, Math.PI / 2 - 0.5, 0, 0);
    this.gun.add(Rh);
    Rh.position.copy(this.R0);
    Rh.rotation.x = -0.38;
  }

  private armMat?: THREE.MeshStandardMaterial;
  private makeArm() {
    if (!this.armMat) {
      const s = T.makeFabric(0.35);
      this.armMat = new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normalMap, roughnessMap: s.roughnessMap, color: 0x4b5238, roughness: 1, normalScale: new THREE.Vector2(1.5, 1.5) });
    }
    const g = new THREE.CylinderGeometry(0.037, 0.047, 1, 14, 1, false);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, -0.5); // origin at wrist, extends toward +z... we orient via lookAt
    const m = new THREE.Mesh(g, this.armMat);
    return m;
  }

  private buildFlash() {
    const map = T.makeFlash();
    const mk = () => { const m = new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(6, 4.2, 2.2), side: THREE.DoubleSide, depthTest: false }); this.flashMats.push(m); return m; };
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), mk());
    front.position.z = -0.02;
    const sideA = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.16), mk());
    sideA.position.z = -0.1; sideA.rotation.y = Math.PI / 2;
    const sideB = sideA.clone(); sideB.rotation.z = Math.PI / 2;
    this.flash.add(front, sideA, sideB);
    this.flash.visible = false;
    this.muzzle.add(this.flash);
  }

  /* ------------------------------ actions ------------------------------ */
  fire(ads: number) {
    const a = 1 - ads * 0.55;
    this.recZ.v += (1.0 + Math.random() * 0.5) * a;
    this.recY.v += (0.12 + Math.random() * 0.1) * a;
    this.recRX.v += (0.75 + Math.random() * 0.35) * a;
    this.recRY.v += (Math.random() - 0.5) * 0.45 * a;
    this.recRZ.v += (Math.random() - 0.5) * 0.6 * a;
    this.boltK = 1;
    this.flashT = 0.05;
    this.flash.visible = true;
    const s = (1.3 + Math.random() * 0.7) * (1 - ads * 0.5);
    this.flash.scale.setScalar(s);
    this.flash.rotation.z = Math.random() * 6.28;
    this.flashLight.intensity = 22;
    this.ejectShell();
  }

  private ejectShell() {
    const s = this.shells.find((x) => x.life <= 0) ?? this.shells[0];
    this.gun.updateMatrixWorld(true);
    this.port.getWorldPosition(s.mesh.position);
    s.vel.set(1.6 + Math.random() * 0.9, 1.4 + Math.random() * 0.8, 0.5 + Math.random() * 0.6);
    s.vel.applyQuaternion(this.gun.getWorldQuaternion(new THREE.Quaternion()));
    s.spin.set(Math.random() * 30, Math.random() * 30, Math.random() * 30);
    s.life = 1.0; s.tink = false;
    s.mesh.visible = true;
  }

  startReload(speed = 1) {
    if (this.reloading) return;
    this.reloading = true; this.reloadU = 0; this.reloadDur = 2.45 / speed;
    this.reloadFlags = { out: false, drop: false, in: false, bolt: false, fwd: false, commit: false };
  }
  cancelReload() { this.reloading = false; this.reloadU = 0; this.mag.visible = true; this.mag.position.set(0, -0.125, -0.045); }

  muzzleWorld(mainCam: THREE.PerspectiveCamera, out: THREE.Vector3, dist = 1.1) {
    this.gun.updateMatrixWorld(true);
    const p = this.muzzle.getWorldPosition(new THREE.Vector3());
    p.project(this.camera);
    out.set(p.x, p.y, 0.5).unproject(mainCam);
    const dir = out.sub(mainCam.position).normalize();
    out.copy(mainCam.position).addScaledVector(dir, dist);
    return out;
  }

  /* ------------------------------ update ------------------------------ */
  update(dt: number, s: VMState) {
    // sway from look
    const sw = 0.0045;
    this.swayX.step(dt, THREE.MathUtils.clamp(-s.lookX * sw, -0.07, 0.07));
    this.swayY.step(dt, THREE.MathUtils.clamp(-s.lookY * sw, -0.07, 0.07));
    this.recZ.step(dt); this.recY.step(dt); this.recRX.step(dt); this.recRY.step(dt); this.recRZ.step(dt);
    this.landS.step(dt);
    if (s.landKick > 0) this.landS.v -= s.landKick * 1.2;

    // equip raise
    this.equipK = Math.min(1, this.equipK + dt * 2.2);

    // bob
    const moving = s.speed01 > 0.05 && s.grounded;
    this.bobAmt = lerp(this.bobAmt, moving ? s.speed01 : 0, 1 - Math.exp(-dt * 8));
    this.bobPhase += dt * (6 + s.speed01 * 5.5) * (moving ? 1 : 0.3);
    const bx = Math.sin(this.bobPhase) * 0.0085 * this.bobAmt * (1 - s.ads * 0.85);
    const by = Math.abs(Math.cos(this.bobPhase)) * -0.011 * this.bobAmt * (1 - s.ads * 0.85);
    const breathe = Math.sin(s.t * 1.4) * 0.0012 * (1 + s.ads);
    const breatheX = Math.sin(s.t * 0.9) * 0.0008;

    this.sprintK = lerp(this.sprintK, s.sprint && !this.reloading ? 1 : 0, 1 - Math.exp(-dt * 9));
    const sp = this.sprintK;
    const ads = s.ads;
    const hip = this.hipPos, adsP = this.adsPos();

    // base position blend hip -> ads
    const pos = new THREE.Vector3().lerpVectors(hip, adsP, sstep(ads));
    pos.x += bx + this.swayX.x * 0.5 + breatheX + s.strafe * -0.006;
    pos.y += by + breathe + this.swayY.x * 0.4 + this.landS.x * 0.35 + (s.crouch ? 0.004 : 0) - (1 - this.equipK) * 0.25;
    pos.z += this.recZ.x * 0.026;
    pos.y += this.recY.x * 0.006;

    let rx = this.recRX.x * 0.045 + this.swayY.x * 0.6 + this.landS.x * 0.12;
    let ry = this.recRY.x * 0.03 + this.swayX.x * 0.9 + bx * 1.4;
    let rz = this.recRZ.x * 0.03 + s.strafe * 0.02 + this.swayX.x * 0.5 + bx * 1.0;

    // sprint pose
    pos.x += sp * 0.03; pos.y += sp * -0.085 + Math.sin(this.bobPhase * 1) * 0.006 * sp * this.bobAmt; pos.z += sp * 0.02;
    rx += sp * -0.2 + Math.cos(this.bobPhase * 2) * 0.016 * sp;
    ry += sp * 0.62;
    rz += sp * 0.22 + Math.sin(this.bobPhase) * 0.04 * sp;

    // reload animation
    let lOff: number[] = [0, 0, 0];
    let magKey = { y: 0, z: 0, vis: true };
    if (this.reloading) {
      this.reloadU += dt / this.reloadDur;
      const u = Math.min(1, this.reloadU);
      const p6 = kf(u, [
        [0, 0, 0, 0, 0, 0, 0],
        [0.12, -0.03, 0.02, 0.0, -0.05, 0.25, 0.3],
        [0.5, -0.03, 0.02, 0.0, -0.05, 0.25, 0.3],
        [0.68, -0.025, -0.02, 0.03, -0.06, 0.2, 0.32],
        [0.78, -0.01, -0.005, 0.03, 0.0, 0.12, 0.18],
        [0.9, 0, 0, 0.0, 0, 0.0, 0],
        [1, 0, 0, 0, 0, 0, 0],
      ]);
      pos.x += p6[0]; pos.y += p6[1]; pos.z += p6[2]; rx += p6[3]; ry += p6[4]; rz += p6[5];
      lOff = kf(u, [
        [0, 0, 0, 0],
        [0.12, -0.0, 0.02, 0.08],
        [0.2, -0.02, -0.055, 0.325],
        [0.3, -0.02, -0.26, 0.31],
        [0.37, -0.1, -0.42, 0.2],
        [0.47, -0.1, -0.42, 0.2],
        [0.58, -0.02, -0.2, 0.32],
        [0.66, -0.02, -0.055, 0.325],
        [0.72, -0.02, -0.04, 0.335],
        [0.78, 0.0, 0.11, 0.43],
        [0.84, 0.0, 0.11, 0.53],
        [0.88, 0.0, 0.11, 0.43],
        [0.96, 0, 0, 0],
        [1, 0, 0, 0],
      ]);
      const mk = kf(u, [
        [0, 0, 0], [0.2, 0, 0], [0.3, -0.2, 0.0],
        [0.47, -0.35, 0], [0.58, -0.2, 0], [0.66, -0.05, 0], [0.72, 0, 0], [1, 0, 0],
      ]);
      magKey = { y: mk[0], z: mk[1], vis: u < 0.3 || u > 0.46 };
      const f = this.reloadFlags;
      if (u > 0.18 && !f.out) { f.out = true; this.audio.magOut(); }
      if (u > 0.3 && !f.drop) { f.drop = true; this.dropMag(); }
      if (u > 0.66 && !f.in) { f.in = true; this.audio.magIn(); }
      if (u > 0.71 && !f.commit) { f.commit = true; this.onReloadCommit?.(); }
      if (u > 0.80 && !f.bolt) { f.bolt = true; this.audio.boltBack(); }
      if (u > 0.86 && !f.fwd) { f.fwd = true; this.audio.boltFwd(); }
      if (u >= 1) { this.reloading = false; this.onReloadDone?.(); }
    }
    this.mag.visible = magKey.vis;
    this.mag.position.set(0, -0.125 + magKey.y, -0.045 + magKey.z);

    this.root.position.copy(pos);
    this.root.rotation.set(rx, ry, rz);

    // bolt carrier
    this.boltK = Math.max(0, this.boltK - dt * 22);
    this.bolt.position.z = -0.02 + this.boltK * 0.04 + (this.reloading && this.reloadU > 0.8 && this.reloadU < 0.88 ? 0.045 : 0);

    // hands & arms
    this.lHand.position.set(this.L0.x + lOff[0], this.L0.y + lOff[1], this.L0.z + lOff[2]);
    this.root.updateMatrixWorld(true);
    this.updateArm(this.lArm, this.lHand, new THREE.Vector3(-0.2 - sp * 0.04, -0.34, 0.12), new THREE.Vector3(-0.012, -0.012, 0.1));
    this.updateArm(this.rArm, this.rHand, new THREE.Vector3(0.2 + sp * 0.03, -0.4, 0.33), new THREE.Vector3(0.008, -0.03, 0.09));

    // muzzle flash
    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = Math.max(0, this.flashT / 0.05);
      this.flashMats.forEach((m) => (m.opacity = k));
      if (this.flashT <= 0) this.flash.visible = false;
    }
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 400);
    this.muzzle.getWorldPosition(this.flashLight.position);

    // lights follow the sun relative to camera
    const inv = s.camQuat.clone().invert();
    this.sun.position.copy(s.sunDir).applyQuaternion(inv).multiplyScalar(5);
    this.sun.target.position.set(0, 0, 0);
    this.scene.add(this.sun.target);
    this.scene.environmentRotation.setFromQuaternion(inv);

    // shells + falling mag (camera-space physics)
    const gdir = new THREE.Vector3(0, -9.8, 0).applyQuaternion(inv);
    for (const sh of this.shells) {
      if (sh.life <= 0) continue;
      sh.life -= dt;
      sh.vel.addScaledVector(gdir, dt);
      sh.mesh.position.addScaledVector(sh.vel, dt);
      sh.mesh.rotation.x += sh.spin.x * dt; sh.mesh.rotation.y += sh.spin.y * dt; sh.mesh.rotation.z += sh.spin.z * dt;
      if (!sh.tink && sh.life < 0.62) { sh.tink = true; this.audio.shell(); }
      if (sh.life <= 0) sh.mesh.visible = false;
    }
    if (this.fallingMag) {
      const fm = this.fallingMag;
      fm.life -= dt;
      fm.vel.addScaledVector(gdir, dt);
      fm.mesh.position.addScaledVector(fm.vel, dt);
      fm.mesh.rotation.x += fm.spin.x * dt; fm.mesh.rotation.z += fm.spin.z * dt;
      if (fm.life <= 0) { this.scene.remove(fm.mesh); this.fallingMag = undefined; }
    }
  }

  private dropMag() {
    this.gun.updateMatrixWorld(true);
    const clone = this.magProto.clone(true);
    this.scene.add(clone);
    clone.position.setFromMatrixPosition(this.mag.matrixWorld);
    clone.quaternion.setFromRotationMatrix(this.mag.matrixWorld);
    clone.scale.set(1, 1, 1);
    this.fallingMag = { mesh: clone, vel: new THREE.Vector3(-0.3, -0.5, 0.3), spin: new THREE.Vector3(3, 0, -2), life: 0.9 };
  }

  private updateArm(arm: THREE.Mesh, hand: THREE.Object3D, elbowRoot: THREE.Vector3, wristLocal: THREE.Vector3) {
    const wrist = hand.localToWorld(wristLocal.clone());
    const elbow = elbowRoot.clone();
    arm.position.copy(wrist);
    const len = wrist.distanceTo(elbow);
    arm.lookAt(elbow);
    // cylinder geometry extends toward -z from origin; lookAt aims +z at elbow so flip
    arm.rotateY(Math.PI);
    arm.scale.set(1, 1, len);
    arm.updateMatrix();
  }
}
