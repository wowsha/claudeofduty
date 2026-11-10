import * as THREE from "three";
import { World, SUN_DIR, buildSky, type Collider, type Tag } from "./world";
import { Viewmodel } from "./weapon";
import { Enemy, type EnemyCtx, type Zone } from "./enemy";
import { AudioEngine } from "./audio";
import { ParticleSystem, Decals, Tracers } from "./fx";
import { Post } from "./post";
import * as T from "./textures";

/** True on phones/tablets (primary pointer is touch). Add ?touch to the URL to force touch controls. */
export const IS_TOUCH =
  typeof window !== "undefined" &&
  (new URLSearchParams(window.location.search).has("touch") || !!window.matchMedia?.("(pointer: coarse)").matches);

const TOUCH_LOOK_SENS = 1.9; // touch drags are finger-distance based, so look a bit faster than mouse

export type GameMode = "tdm" | "ffa" | "survival";
export interface MatchResult { title: string; sub: string; rows: { name: string; team: number; kills: number; you: boolean }[] }
const MATCH_TIME = 360; // seconds per team/free-for-all match
const KILL_LIMIT: Record<GameMode, number> = { tdm: 30, ffa: 20, survival: 0 };
const RESPAWN_TIME = 4; // seconds before the player is back in a team match
const PLAYER_TEAM = 0; // blue in team deathmatch; the player's own team

export interface HudState {
  status: "menu" | "playing" | "paused" | "dead" | "over";
  mode: GameMode; matchLeft: number; teamA: number; teamB: number; limit: number;
  leader: string; leaderKills: number; respawnIn: number; killedBy: string; result: MatchResult | null;
  health: number; ammo: number; reserve: number; mag: number; reloading: boolean; reloadU: number;
  kills: number; headshots: number; score: number; wave: number; alive: number; remaining: number;
  yaw: number; ads: number; sprint: boolean; spread: number; fps: number; banner: string; bannerT: number;
  lowAmmo: boolean; crouch: boolean; px: number; pz: number; quality: number; streak: number;
}

type Listener = (d: any) => void; // eslint-disable-line

const MAG = 30;
const RPM = 740;
const DMG = 28;

// reusable scratch
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

function rayBox(o: THREE.Vector3, d: THREE.Vector3, c: Collider, maxT: number, n: THREE.Vector3): number {
  let tmin = 0, tmax = maxT, ax = -1, sg = 0;
  const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z], mn = [c.min.x, c.min.y, c.min.z], mx = [c.max.x, c.max.y, c.max.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dd[a]) < 1e-9) { if (oo[a] < mn[a] || oo[a] > mx[a]) return -1; continue; }
    let t1 = (mn[a] - oo[a]) / dd[a], t2 = (mx[a] - oo[a]) / dd[a], s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; ax = a; sg = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (ax < 0) return -1;
  n.set(0, 0, 0);
  if (ax === 0) n.x = sg; else if (ax === 1) n.y = sg; else n.z = sg;
  return tmin;
}

interface Hit { t: number; kind: "world" | "ground" | "enemy"; point: THREE.Vector3; normal: THREE.Vector3; tag: Tag | "flesh" | "ground"; enemy?: Enemy; zone?: Zone }

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(80, 1, 0.05, 900);
  world!: World;
  vm!: Viewmodel;
  audio = new AudioEngine();
  post!: Post;
  sun!: THREE.DirectionalLight;
  particles!: ParticleSystem;
  glow!: ParticleSystem;
  decals!: Decals;
  tracers!: Tracers;
  enemies: Enemy[] = [];
  enemyFlash = new THREE.PointLight(0xffa860, 0, 14, 2);
  muzzleLight = new THREE.PointLight(0xffa860, 0, 12, 2);

  hud: HudState = {
    status: "menu", health: 100, ammo: MAG, reserve: MAG * 6, mag: MAG, reloading: false, reloadU: 0, kills: 0, headshots: 0, score: 0,
    wave: 0, alive: 0, remaining: 0, yaw: 0, ads: 0, sprint: false, spread: 10, fps: 60, banner: "", bannerT: 0, lowAmmo: false, crouch: false, px: 0, pz: 0, quality: 2, streak: 0,
    mode: "tdm", matchLeft: MATCH_TIME, teamA: 0, teamB: 0, limit: KILL_LIMIT.tdm, leader: "YOU", leaderKills: 0, respawnIn: 0, killedBy: "", result: null,
  };
  private listeners: Record<string, Listener[]> = {};

  // player
  pos = new THREE.Vector3(); vel = new THREE.Vector3();
  yaw = 0; pitch = 0; kickPitch = 0; kickYaw = 0; kickVP = 0; kickVY = 0; roll = 0;
  onGround = true; eye = 1.7; crouch = false; sprinting = false; stepSmooth = 0;
  health = 100; lastHurt = -10; stepDist = 0; bobPhase = 0;
  ads = 0; fov = 80; shake = 0; damageFx = 0; landKick = 0; strafe = 0;
  keys = new Set<string>(); mouseDown = false; mouseR = false; lookDX = 0; lookDY = 0;
  // touch input (written by the on-screen controls, read in updatePlayer)
  touchF = 0; touchS = 0; touchSprint = false; jumpQueued = false; fireTapPending = false;
  // game modes and match state
  mode: GameMode = "tdm";
  teamScore: [number, number] = [0, 0];
  matchLeft = MATCH_TIME; respawnT = 0;
  slots: { team: number; name: string; bot: Enemy | null; respawn: number; kills: number }[] = [];
  ammo = MAG; reserve = MAG * 6; fireT = 0; bloom = 0; burstN = 0; lastShot = -10; fireBlock = 0; trigHeld = false;
  t = 0; locked = false; auto = false; manual = false; sens = 0.0019;
  kills = 0; headshots = 0; score = 0; streak = 0;
  wave = 0; toSpawn = 0; spawnT = 0; waveWait = 0; waveActive = false;
  private fpsT = 0; private fpsN = 0;
  private lastTime = 0;
  private quality = 2;
  private mmCanvas?: HTMLCanvasElement; private mmStatic?: HTMLCanvasElement; private mmT = 0;
  private blips: { x: number; z: number; t: number }[] = [];
  private smokeAcc = 0; private moteAcc = 0;
  private flashTimer = 0;
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;

  constructor(container: HTMLElement) {
    this.container = container;
    const q = new URLSearchParams(location.search);
    this.auto = q.has("auto");
    this.manual = q.has("manual");
    this.quality = q.has("q") ? Number(q.get("q")) : IS_TOUCH ? 1 : 2; // phones default to MEDIUM
    this.hud.quality = this.quality;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.has("pr") ? Number(q.get("pr")) : IS_TOUCH ? 1.25 : 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.62;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    container.appendChild(this.canvas);

    this.setupScene();
    this.resize();
    window.addEventListener("resize", this.resize);
    this.bindInput();
    this.resetPlayer();
    this.hud.status = "menu";
    if (this.auto) { this.audio.init(); this.hud.status = "playing"; this.startWave(); }

    // debug / screenshot hooks
    (window as unknown as { __fps: unknown }).__fps = {
      game: this,
      setPose: (x: number, y: number, z: number, yawDeg: number, pitchDeg: number) => { this.pos.set(x, y, z); this.yaw = THREE.MathUtils.degToRad(yawDeg); this.pitch = THREE.MathUtils.degToRad(pitchDeg); },
      spawn: (x: number, z: number, v = 0) => this.spawnEnemy(new THREE.Vector3(x, 0, z), v),
      step: (sec: number, dt = 1 / 30) => { for (let i = 0; i < sec / dt; i++) this.tick(dt); },
      render: () => this.render(0.016),
      ads: (v: number) => { this.mouseR = v > 0; this.ads = v; },
      fire: () => { this.fireT = 0; this.tryFire(); },
      hold: (k: string, on = true) => { if (on) this.keys.add(k); else this.keys.delete(k); },
      reload: () => this.startReload(),
      pause: (b: boolean) => { this.hud.status = b ? "paused" : "playing"; },
      clearEnemies: () => { this.enemies.forEach((e) => this.scene.remove(e.group)); this.enemies = []; this.waveActive = false; this.toSpawn = 0; this.waveWait = 1e9; },
    };

    if (!this.manual) {
      this.lastTime = performance.now();
      requestAnimationFrame(this.loop);
    }
  }

  /* ------------------------------ setup ------------------------------ */
  private setupScene() {
    const sc = this.scene;
    const { sky, env } = buildSky(this.renderer);
    sc.add(sky);
    sc.environment = env;
    sc.environmentIntensity = 0.6;
    sc.fog = new THREE.FogExp2(0x9a9486, 0.0026);

    this.world = new World();
    sc.add(this.world.group);

    // sun
    const sun = (this.sun = new THREE.DirectionalLight(0xffe2bd, 3.6));
    sun.position.copy(SUN_DIR).multiplyScalar(220);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    const sh = sun.shadow;
    const ms = this.quality >= 2 ? 4096 : this.quality === 1 ? 2048 : 1024;
    sh.mapSize.set(ms, ms);
    const E = 78;
    sh.camera.left = -E; sh.camera.right = E; sh.camera.top = E; sh.camera.bottom = -E;
    sh.camera.near = 20; sh.camera.far = 520;
    sh.bias = -0.0003; sh.normalBias = 0.04; sh.radius = 2.5;
    sc.add(sun, sun.target);

    sc.add(new THREE.HemisphereLight(0x9bb8e0, 0x6b5a45, 0.35));
    sc.add(this.enemyFlash, this.muzzleLight);

    this.particles = new ParticleSystem(1400, false, 0, T.makePuff());
    this.glow = new ParticleSystem(900, true, 1, null);
    sc.add(this.particles.points, this.glow.points);
    this.decals = new Decals(sc);
    this.tracers = new Tracers(sc);

    this.vm = new Viewmodel(env, this.audio);
    this.vm.onReloadCommit = () => this.commitReload();
    this.vm.onReloadDone = () => { this.hud.reloading = false; };

    this.post = new Post(this.renderer, sc, this.camera, this.vm.scene, this.vm.camera, this.container.clientWidth || 1280, this.container.clientHeight || 720, this.quality);
    this.buildMinimap();
  }

  setQuality(q: number) {
    this.quality = q; this.hud.quality = q;
    const ms = q >= 2 ? 4096 : q === 1 ? 2048 : 1024;
    this.sun.shadow.mapSize.set(ms, ms);
    this.sun.shadow.map?.dispose(); (this.sun.shadow as { map: unknown }).map = null;
    this.post.dispose();
    this.post = new Post(this.renderer, this.scene, this.camera, this.vm.scene, this.vm.camera, this.container.clientWidth, this.container.clientHeight, q);
  }

  resize = () => {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vm.setAspect(w / h);
    this.post?.resize(w, h);
  };

  /* ------------------------------ events ------------------------------ */
  on(evt: string, cb: Listener) { (this.listeners[evt] ||= []).push(cb); return () => { this.listeners[evt] = this.listeners[evt].filter((x) => x !== cb); }; }
  private emit(evt: string, d?: unknown) { this.listeners[evt]?.forEach((cb) => cb(d)); }

  /* ------------------------------ input ------------------------------ */
  private bindInput() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "KeyR" && this.hud.status === "playing") this.startReload();
      if (e.code === "Space" && this.hud.status === "playing") e.preventDefault();
      if (e.code === "KeyC") this.crouch = !this.crouch;
      if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3") { /* weapon slots reserved */ }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    this.canvas.addEventListener("mousedown", (e) => {
      if (this.hud.status !== "playing") return;
      if (e.button === 0) { this.mouseDown = true; }
      if (e.button === 2) this.mouseR = true;
    });
    window.addEventListener("mouseup", (e) => { if (e.button === 0) this.mouseDown = false; if (e.button === 2) this.mouseR = false; });
    window.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("mousemove", (e) => {
      if (!this.locked && !this.auto) return;
      this.look(e.movementX, e.movementY, this.sens);
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked && this.hud.status === "playing" && !this.auto) { this.hud.status = "paused"; this.mouseDown = false; this.mouseR = false; this.keys.clear(); }
    });
  }

  /* ------------------------------ touch / shared controls ------------------------------ */
  /** Aim by a pixel delta (mouse movement or touch drag). */
  look(dx: number, dy: number, base: number) {
    if (this.hud.status !== "playing") return;
    const k = base * (this.fov / 80) * (1 - this.ads * 0.1);
    this.yaw -= dx * k; this.pitch -= dy * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.5);
    this.lookDX += dx; this.lookDY += dy;
  }
  touchLook(dx: number, dy: number) { this.look(dx, dy, this.sens * TOUCH_LOOK_SENS); }
  /** Analog move input, each axis in [-1, 1]. x = strafe right, y = forward. */
  setMove(x: number, y: number) { this.touchS = THREE.MathUtils.clamp(x, -1, 1); this.touchF = THREE.MathUtils.clamp(y, -1, 1); }
  setFire(on: boolean) {
    this.mouseDown = on && this.hud.status === "playing";
    // a quick tap can start and end between two frames: make sure it still gets one shot attempt
    if (on) this.fireTapPending = true;
  }
  setAds(on: boolean) { this.mouseR = on && this.hud.status === "playing"; }
  setSprint(on: boolean) { this.touchSprint = on; }
  jump() { this.jumpQueued = true; }
  toggleCrouch() { this.crouch = !this.crouch; }
  reload() { if (this.hud.status === "playing") this.startReload(); }
  pauseGame() { if (this.hud.status === "playing") { this.hud.status = "paused"; this.resetTouch(); } }
  /** Release every held control (called when touch controls go away). */
  resetTouch() {
    this.touchF = 0; this.touchS = 0; this.touchSprint = false; this.jumpQueued = false; this.fireTapPending = false;
    this.mouseDown = false; this.mouseR = false;
  }

  deploy() {
    this.audio.init();
    // in team modes a dead player respawns on their own; survival restarts from the K.I.A. screen
    if (this.hud.status === "dead" && this.mode !== "survival") return;
    if (this.hud.status === "menu" || this.hud.status === "over" || this.hud.status === "dead") this.beginMatch();
    // Pointer lock is a desktop feature; touch devices don't have it.
    if (!IS_TOUCH) void Promise.resolve(this.canvas.requestPointerLock?.()).catch(() => {});
    this.hud.status = "playing";
    this.audio.uiClick();
  }

  /** Start a fresh match in the selected mode. */
  private beginMatch() {
    this.enemies.forEach((e) => this.scene.remove(e.group));
    this.enemies = [];
    this.kills = 0; this.headshots = 0; this.score = 0; this.streak = 0; this.wave = 0; this.waveActive = false;
    this.teamScore = [0, 0]; this.matchLeft = MATCH_TIME; this.respawnT = 0;
    this.ammo = MAG; this.reserve = MAG * 6; this.health = 100;
    this.hud.result = null; this.hud.killedBy = ""; this.hud.respawnIn = 0;
    this.resetPlayer();
    if (this.mode === "survival") {
      this.slots = [];
      this.startWave();
    } else {
      this.setupSlots();
      this.banner(this.mode === "tdm" ? "TEAM DEATHMATCH" : "FREE FOR ALL", 3);
    }
  }

  setMode(m: GameMode) {
    if (this.hud.status !== "menu") return;
    this.mode = m; this.hud.mode = m; this.hud.limit = KILL_LIMIT[m];
  }

  /** Back to the title screen. */
  toMenu() {
    this.resetTouch();
    document.exitPointerLock?.();
    this.hud.status = "menu";
  }

  private resetPlayer() {
    this.pos.copy(this.world.playerSpawn); this.vel.set(0, 0, 0);
    this.yaw = 0; this.pitch = 0; this.health = 100; this.eye = 1.7; this.crouch = false;
  }

  /* ------------------------------ waves ------------------------------ */
  private startWave() {
    this.wave++;
    this.toSpawn = 5 + this.wave * 3;
    this.spawnT = 1.5;
    this.waveActive = true;
    this.reserve = Math.min(this.reserve + 60, MAG * 9);
    this.health = 100;
    this.banner(`WAVE ${this.wave}`, 3);
    this.audio.waveStart();
  }

  private banner(s: string, t = 2.5) { this.hud.banner = s; this.hud.bannerT = t; }

  private spawnEnemy(p: THREE.Vector3, variant = Math.floor(Math.random() * 4), team = 1, slot = -1) {
    const e = new Enemy(p, variant);
    e.team = team; e.slot = slot;
    e.yaw = Math.atan2(this.pos.x - p.x, this.pos.z - p.z);
    this.scene.add(e.group);
    this.enemies.push(e);
    return e;
  }

  /* ------------------------------ team modes (TDM / FFA) ------------------------------ */
  private nameOf(e: Enemy) { return e.slot >= 0 ? this.slots[e.slot].name : "HOSTILE"; }
  private feed(text: string, team: number) { this.emit("feed", { text, team }); }

  /** Bots per mode: team deathmatch = 3 allies + 4 hostiles; free-for-all = 7 loners (each on its own team). */
  private setupSlots() {
    const spec: [number, string][] = this.mode === "tdm"
      ? [[0, "ALPHA"], [0, "BRAVO"], [0, "CHARLIE"], [1, "RED-1"], [1, "RED-2"], [1, "RED-3"], [1, "RED-4"]]
      : Array.from({ length: 7 }, (_, i): [number, string] => [100 + i, `BOT-${i + 1}`]);
    // stagger the first spawns so the bots don't all appear on the same frame
    this.slots = spec.map(([team, name], i) => ({ team, name, bot: null, respawn: 0.4 + i * 0.35, kills: 0 }));
  }

  /** A spawn point far from the player and from every live bot. */
  private pickSpawn(): THREE.Vector3 {
    const pts = this.world.spawns;
    const alive = this.enemies.filter((e) => !e.dead);
    let best = pts[0], bestScore = -Infinity;
    for (let i = 0; i < 10; i++) {
      const c = pts[Math.floor(Math.random() * pts.length)];
      let minD = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
      for (const e of alive) minD = Math.min(minD, Math.hypot(e.pos.x - c.x, e.pos.z - c.z));
      const score = Math.min(minD, 45) + Math.random() * 3;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    const p = best.clone();
    p.x += (Math.random() - 0.5) * 2; p.z += (Math.random() - 0.5) * 2;
    return p;
  }

  /** Nearest hostile for a bot: the player (only if alive and on another team) or another bot on another team. */
  private targetFor(e: Enemy): { pos: THREE.Vector3; eye: THREE.Vector3; sprint: boolean; crouch: boolean; ref: Enemy | null } | null {
    let best: { pos: THREE.Vector3; eye: THREE.Vector3; sprint: boolean; crouch: boolean; ref: Enemy | null } | null = null;
    let bd = 90;
    if (this.hud.status === "playing" && e.team !== PLAYER_TEAM) {
      const d = Math.hypot(this.pos.x - e.pos.x, this.pos.z - e.pos.z);
      if (d < bd) { bd = d; best = { pos: this.pos, eye: this.camera.position, sprint: this.sprinting, crouch: this.crouch, ref: null }; }
    }
    for (const o of this.enemies) {
      if (o.dead || o === e || o.team === e.team) continue;
      const d = Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z);
      if (d < bd) { bd = d; best = { pos: o.pos, eye: new THREE.Vector3(o.pos.x, o.pos.y + 1.6, o.pos.z), sprint: false, crouch: false, ref: o }; }
    }
    return best;
  }

  private botCtx(e: Enemy): EnemyCtx {
    const t = this.targetFor(e);
    return {
      playerPos: t ? t.pos : e.pos, playerEye: t ? t.eye : e.pos,
      playerSprint: t ? t.sprint : false, playerCrouch: t ? t.crouch : false,
      targetRef: t ? t.ref : null, noTarget: !t,
      los: this.los, collide: (p, r) => this.collideEnemy(p, r), onShoot: this.enemyShoot, time: this.t, arena: 52,
    };
  }

  private spawnBot(i: number) {
    const s = this.slots[i];
    return this.spawnEnemy(this.pickSpawn(), Math.floor(Math.random() * 4), s.team, i);
  }

  /** Bot-on-bot or bot-on-player kill credit. */
  private creditBot(killer: Enemy, victim: string) {
    if (killer.slot >= 0) this.slots[killer.slot].kills++;
    if (this.mode === "tdm" && killer.team < 2) this.teamScore[killer.team]++;
    this.feed(`${this.nameOf(killer)} ▸ ${victim}`, killer.team);
  }

  private botHitBot(shooter: Enemy, victim: Enemy, dmg: number, dir: THREE.Vector3) {
    // bot-on-bot hits land harder than on the player, so team fights resolve within a match
    if (victim.damage(dmg * 1.6, dir.x, dir.z)) this.creditBot(shooter, this.nameOf(victim));
  }

  private matchUpdate(dt: number) {
    // keep every slot filled: clear finished corpses, then respawn the bot after a short delay
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      if (s.bot && s.bot.dead && s.bot.deathT > 3.5) {
        this.scene.remove(s.bot.group);
        this.enemies.splice(this.enemies.indexOf(s.bot), 1);
        s.bot = null; s.respawn = 3 + Math.random() * 2;
      }
      if (!s.bot) {
        s.respawn -= dt;
        if (s.respawn <= 0) s.bot = this.spawnBot(i);
      }
    }
    const alive = this.enemies.filter((e) => !e.dead).length;
    this.hud.alive = alive; this.hud.remaining = alive;

    if (this.hud.status === "playing" || this.hud.status === "dead") {
      this.matchLeft -= dt;
      const top = this.mode === "tdm" ? Math.max(this.teamScore[0], this.teamScore[1]) : this.kills;
      if (top >= KILL_LIMIT[this.mode] || this.matchLeft <= 0) { this.endMatch(); return; }
    }
    if (this.hud.status === "dead") {
      this.respawnT -= dt;
      this.hud.respawnIn = Math.max(0, Math.ceil(this.respawnT));
      if (this.respawnT <= 0) this.respawnPlayer();
    }
  }

  private respawnPlayer() {
    this.pos.copy(this.pickSpawn()); this.vel.set(0, 0, 0);
    this.health = 100; this.lastHurt = -10; this.ammo = MAG; this.reserve = Math.max(this.reserve, MAG * 4);
    this.yaw = Math.random() * 6.28; this.pitch = 0; this.eye = 1.7; this.crouch = false;
    this.damageFx = 0; this.shake = 0; this.roll = 0; this.streak = 0;
    this.mouseDown = false; this.mouseR = false;
    // desktop browsers only capture the mouse from a click, so resume through the paused screen there
    this.hud.status = IS_TOUCH ? "playing" : "paused";
  }

  private endMatch() {
    this.hud.status = "over";
    this.resetTouch();
    document.exitPointerLock?.();
    const rows = [
      { name: "YOU", team: PLAYER_TEAM, kills: this.kills, you: true },
      ...this.slots.map((s) => ({ name: s.name, team: s.team, kills: s.kills, you: false })),
    ].sort((a, b) => b.kills - a.kills);
    let title: string, sub: string;
    if (this.mode === "tdm") {
      const [a, b] = this.teamScore;
      title = a > b ? "VICTORY" : a < b ? "DEFEAT" : "DRAW";
      sub = `BLUE ${a}  —  ${b} RED`;
    } else {
      const rank = rows.findIndex((r) => r.you) + 1;
      title = rank === 1 ? "VICTORY" : "DEFEAT";
      sub = `YOU PLACED #${rank} OF ${rows.length} · ${this.kills} ELIMINATIONS`;
    }
    this.hud.result = { title, sub, rows };
  }

  private waveUpdate(dt: number) {
    const alive = this.enemies.filter((e) => !e.dead).length;
    this.hud.alive = alive; this.hud.remaining = this.toSpawn + alive;
    if (this.waveActive) {
      this.spawnT -= dt;
      const cap = Math.min(4 + this.wave, 10);
      if (this.toSpawn > 0 && alive < cap && this.spawnT <= 0) {
        // farthest-ish, not-in-view spawn
        const cands = [...this.world.spawns].sort((a, b) => b.distanceTo(this.pos) - a.distanceTo(this.pos)).slice(0, 6);
        const p = cands[Math.floor(Math.random() * cands.length)].clone();
        p.x += (Math.random() - 0.5) * 3; p.z += (Math.random() - 0.5) * 3;
        this.spawnEnemy(p);
        this.toSpawn--; this.spawnT = 1.2 + Math.random() * 1.5;
      }
      if (this.toSpawn === 0 && alive === 0) {
        this.waveActive = false; this.waveWait = 6;
        this.banner(`WAVE ${this.wave} CLEARED`, 4);
      }
    } else if (this.waveWait > 0) {
      this.waveWait -= dt;
      if (this.waveWait <= 0) this.startWave();
    }
    // cleanup corpses
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead && e.deathT > 12) { this.scene.remove(e.group); this.enemies.splice(i, 1); }
    }
  }

  /* ------------------------------ collision ------------------------------ */
  private collideCircle(p: THREE.Vector3, r: number, feetY: number, height: number, minTop = 0.4): number {
    let total = 0;
    for (const c of this.world.colliders) {
      if (c.max.y <= feetY + minTop) continue;
      if (feetY + height <= c.min.y) continue;
      if (p.x < c.min.x - r || p.x > c.max.x + r || p.z < c.min.z - r || p.z > c.max.z + r) continue;
      const cx = Math.max(c.min.x, Math.min(p.x, c.max.x)), cz = Math.max(c.min.z, Math.min(p.z, c.max.z));
      let dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2); const push = r - d;
        p.x += (dx / d) * push; p.z += (dz / d) * push; total += push;
      } else {
        const l = p.x - c.min.x, rr = c.max.x - p.x, u = p.z - c.min.z, dn = c.max.z - p.z;
        const m = Math.min(l, rr, u, dn);
        if (m === l) p.x = c.min.x - r; else if (m === rr) p.x = c.max.x + r; else if (m === u) p.z = c.min.z - r; else p.z = c.max.z + r;
        total += m + r; dx = 0; dz = 0;
      }
    }
    return total;
  }

  private groundAt(p: THREE.Vector3, r: number, feetY: number): number {
    let g = 0;
    for (const c of this.world.colliders) {
      if (c.max.y > feetY + 0.46 || c.max.y <= g) continue;
      if (p.x < c.min.x - r || p.x > c.max.x + r || p.z < c.min.z - r || p.z > c.max.z + r) continue;
      const cx = Math.max(c.min.x, Math.min(p.x, c.max.x)), cz = Math.max(c.min.z, Math.min(p.z, c.max.z));
      if ((p.x - cx) ** 2 + (p.z - cz) ** 2 < r * r * 0.9) g = c.max.y;
    }
    return g;
  }

  /* ------------------------------ ray casting ------------------------------ */
  castRay(o: THREE.Vector3, d: THREE.Vector3, maxT: number, withEnemies = true, skip?: Enemy, filter?: (e: Enemy) => boolean): Hit | null {
    let best: Hit | null = null;
    let bt = maxT;
    const n = _v3;
    for (const c of this.world.colliders) {
      const t = rayBox(o, d, c, bt, n);
      if (t >= 0 && t < bt) {
        bt = t;
        best = { t, kind: "world", point: o.clone().addScaledVector(d, t), normal: n.clone(), tag: c.tag };
      }
    }
    if (d.y < -1e-5) {
      const t = -o.y / d.y;
      if (t > 0 && t < bt) { bt = t; best = { t, kind: "ground", point: o.clone().addScaledVector(d, t), normal: new THREE.Vector3(0, 1, 0), tag: "ground" }; }
    }
    if (withEnemies) {
      for (const e of this.enemies) {
        if (e.dead || e === skip || (filter && !filter(e))) continue;
        const r = e.raycast(o, d, bt);
        if (r && r.t < bt) {
          bt = r.t;
          best = { t: r.t, kind: "enemy", point: o.clone().addScaledVector(d, r.t), normal: d.clone().negate(), tag: "flesh", enemy: e, zone: r.zone };
        }
      }
    }
    return best;
  }

  private los = (a: THREE.Vector3, b: THREE.Vector3) => {
    const d = _v1.subVectors(b, a); const L = d.length(); d.divideScalar(L);
    const n = _v2;
    for (const c of this.world.colliders) {
      if (c.max.y < 1.0) continue;
      const t = rayBox(a, d, c, L - 0.3, n);
      if (t >= 0) return false;
    }
    return true;
  };

  /* ------------------------------ weapon ------------------------------ */
  private startReload() {
    if (this.vm.reloading || this.ammo >= MAG + 1 || this.reserve <= 0 || this.ammo === MAG + 1) return;
    if (this.ammo === MAG + 0 && false) return;
    this.vm.startReload(1);
    this.hud.reloading = true;
  }

  private commitReload() {
    const keep = this.ammo > 0 ? 1 : 0; // round in the chamber
    const need = MAG + keep - this.ammo;
    const take = Math.min(need, this.reserve);
    this.ammo += take; this.reserve -= take;
  }

  private tryFire() {
    if (this.fireT > 0 || this.vm.reloading) return;
    if (this.ammo <= 0) {
      this.fireT = 0.25; this.audio.dryFire();
      if (this.reserve > 0) this.startReload();
      return;
    }
    this.ammo--;
    this.fireT = 60 / RPM;
    this.lastShot = this.t;
    this.fireBlock = 0.2;
    this.sprinting = false;

    // spread
    const moving = this.vel.length() > 1;
    const base = THREE.MathUtils.lerp(0.022, 0.0012, this.ads);
    const spread = base + this.bloom + (moving ? 0.01 * (1 - this.ads * 0.7) : 0) + (this.onGround ? 0 : 0.03) + (this.crouch ? -base * 0.2 : 0);
    this.bloom = Math.min(0.016, this.bloom + 0.0015);

    this.camera.updateMatrixWorld();
    const fwd = _v1.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = _v2.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const a = spread * Math.sqrt(Math.random()), ph = Math.random() * 6.283;
    const dir = fwd.clone().addScaledVector(right, Math.cos(ph) * a).addScaledVector(up, Math.sin(ph) * a).normalize();
    const origin = this.camera.position.clone();

    // recoil
    this.burstN = this.t - this.lastShot < 0.3 ? this.burstN + 1 : 0;
    const n = this.burstN;
    const k = 1 - this.ads * 0.35;
    this.pitch += (0.0058 + Math.random() * 0.0018) * k * (n < 8 ? 1.0 : 0.7);
    this.yaw += (Math.sin(n * 0.65) * 0.0016 + (Math.random() - 0.5) * 0.0018) * k;
    this.kickVP += 0.9 * k; this.kickVY += (Math.random() - 0.5) * 0.5 * k;
    this.shake = Math.min(1, this.shake + 0.35 * k);

    this.vm.fire(this.ads);
    this.audio.shot({ kind: "rifle" });
    // muzzle light
    const mw = this.vm.muzzleWorld(this.camera, new THREE.Vector3(), 0.9);
    this.muzzleLight.position.copy(mw); this.muzzleLight.intensity = 25 * (1 - this.ads * 0.5);

    // no friendly fire: shots pass through teammates
    const hit = this.castRay(origin, dir, 300, true, undefined, (e) => e.team !== PLAYER_TEAM);
    const end = hit ? hit.point : origin.clone().addScaledVector(dir, 120);
    if (n % 2 === 0 || true) this.tracers.add(this.vm.muzzleWorld(this.camera, new THREE.Vector3(), 4.5), end, { speed: 420, len: 9, width: 0.02 });
    if (hit) this.resolveHit(hit, dir);
    this.hud.ammo = this.ammo;
  }

  private resolveHit(hit: Hit, dir: THREE.Vector3) {
    if (hit.kind === "enemy" && hit.enemy) {
      const e = hit.enemy;
      const zm = hit.zone === "head" ? 2.6 : hit.zone === "legs" ? 0.75 : 1.0;
      const dmg = DMG * zm;
      const killed = e.damage(dmg, dir.x, dir.z);
      this.bloodSpray(hit.point, dir, hit.zone === "head" ? 1.6 : 1);
      this.audio.impact("flesh", hit.point, this.camera.position);
      if (killed) {
        this.kills++; this.streak++;
        const hs = hit.zone === "head";
        if (hs) this.headshots++;
        const pts = 100 + (hs ? 50 : 0) + (this.streak > 1 ? this.streak * 10 : 0);
        this.score += pts;
        this.audio.hitmarker("kill");
        this.audio.bodyFall(e.pos, this.camera.position);
        this.emit("hit", { kind: "kill" });
        this.emit("kill", { points: pts, headshot: hs, streak: this.streak, dist: Math.round(e.pos.distanceTo(this.pos)) });
        if (this.mode !== "survival") {
          if (this.mode === "tdm") this.teamScore[PLAYER_TEAM]++;
          this.feed(`YOU ▸ ${this.nameOf(e)}`, PLAYER_TEAM);
        }
      } else {
        this.score += 10;
        this.audio.hitmarker(hit.zone === "head" ? "head" : "hit");
        this.emit("hit", { kind: hit.zone === "head" ? "head" : "hit" });
      }
      return;
    }
    const tag = hit.tag as Tag | "ground";
    this.impactFx(hit.point, hit.normal, tag);
    this.audio.impact(tag, hit.point, this.camera.position);
  }

  impactFx(p: THREE.Vector3, n: THREE.Vector3, tag: Tag | "ground") {
    const dust: [number, number, number] = tag === "ground" || tag === "dirt" ? [0.42, 0.36, 0.28] : tag === "wood" ? [0.4, 0.3, 0.2] : tag === "metal" ? [0.45, 0.45, 0.47] : tag === "fabric" ? [0.45, 0.4, 0.3] : [0.6, 0.58, 0.54];
    for (let i = 0; i < 4; i++) {
      const v = n.clone().multiplyScalar(0.8 + Math.random() * 1.2).add(new THREE.Vector3((Math.random() - 0.5) * 0.9, Math.random() * 0.5 + 0.2, (Math.random() - 0.5) * 0.9));
      this.particles.spawn(p, v, { life: 0.8 + Math.random() * 0.8, size: 0.3 + Math.random() * 0.25, grow: 1.1, color: dust, alpha: 0.75, drag: 2.2, gravity: -0.2 });
    }
    // chips
    for (let i = 0; i < 7; i++) {
      const v = n.clone().multiplyScalar(2 + Math.random() * 4).add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 2.5, (Math.random() - 0.5) * 4));
      this.particles.spawn(p, v, { life: 0.5 + Math.random() * 0.4, size: 0.04, grow: 0, color: [dust[0] * 0.8, dust[1] * 0.8, dust[2] * 0.8], alpha: 0.95, gravity: 9, drag: 0.5 });
    }
    if (tag === "metal" || tag === "concrete" || tag === "brick") {
      for (let i = 0; i < (tag === "metal" ? 12 : 6); i++) {
        const v = n.clone().multiplyScalar(2.5 + Math.random() * 4).add(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 3, (Math.random() - 0.5) * 6));
        this.glow.spawn(p, v, { life: 0.25 + Math.random() * 0.3, size: 0.07, grow: -0.04, color: [4, 2.2, 0.8], alpha: 1, gravity: 8, drag: 0.3 });
      }
      this.glow.spawn(p, new THREE.Vector3(), { life: 0.07, size: 0.6, grow: 0.3, color: [3, 2, 1.1], alpha: 0.9 });
    }
    if (tag !== "ground") this.decals.add(p, n, tag === "glass" ? 0.16 : 0.26);
    else this.decals.add(p, n, 0.14);
  }

  private bloodSpray(p: THREE.Vector3, dir: THREE.Vector3, k: number) {
    for (let i = 0; i < 8 * k; i++) {
      const v = dir.clone().multiplyScalar(1 + Math.random() * 3).add(new THREE.Vector3((Math.random() - 0.5) * 2.5, Math.random() * 2, (Math.random() - 0.5) * 2.5));
      this.particles.spawn(p, v, { life: 0.4 + Math.random() * 0.5, size: 0.05 + Math.random() * 0.08, grow: 0.15, color: [0.28, 0.02, 0.02], alpha: 0.8, gravity: 7, drag: 1.5 });
    }
    this.particles.spawn(p, dir.clone().multiplyScalar(0.5), { life: 0.5, size: 0.3, grow: 0.5, color: [0.3, 0.04, 0.04], alpha: 0.35, drag: 2 });
  }

  /* ------------------------------ enemy fire ------------------------------ */
  private enemyShoot = (e: Enemy, from: THREE.Vector3, hc: number, ref: Enemy | null) => {
    const eye = this.camera.position;
    // aim point: the player's eyes, or the targeted bot's chest/head
    const aim = ref ? new THREE.Vector3(ref.pos.x, ref.pos.y + 1.6, ref.pos.z) : eye;
    this.audio.shot({ pos: from, listener: eye, kind: "enemy", vol: 0.85 });
    this.enemyFlash.position.copy(from); this.enemyFlash.intensity = 40; this.flashTimer = 0.05;
    const hit = Math.random() < hc;
    const target = new THREE.Vector3(aim.x, aim.y - 0.35 + (Math.random() - 0.3) * 0.5, aim.z);
    if (!hit) {
      const off = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.7, Math.random() - 0.5).normalize().multiplyScalar(0.6 + Math.random() * 1.8);
      target.add(off);
    }
    const dir = target.clone().sub(from).normalize();
    const wh = this.castRay(from, dir, 160, false);
    const dist = from.distanceTo(aim);
    const blocked = wh && wh.t < dist - 0.5;
    const end = wh ? wh.point : from.clone().addScaledVector(dir, 100);
    this.tracers.add(from, end, { speed: 260, len: 4, width: 0.01, color: [3.5, 2.6, 1.3] });
    if (wh && (wh.kind !== "ground" || blocked || !hit)) { this.impactFx(wh.point, wh.normal, wh.tag as Tag | "ground"); if (wh.t < 70) this.audio.impact(wh.tag as Tag | "ground", wh.point, eye); }
    if (hit && !blocked) {
      const dmg = 6 + Math.random() * 6;
      if (ref) this.botHitBot(e, ref, dmg, dir);
      else this.hurtPlayer(dmg, from, e);
    } else if (!blocked && !ref) {
      // flyby
      const toE = eye.clone().sub(from); const proj = toE.dot(dir);
      const closest = from.clone().addScaledVector(dir, Math.max(0, proj));
      if (closest.distanceTo(eye) < 3 && proj > 0) this.audio.whiz(closest, eye);
    }
    this.blips.push({ x: e.pos.x, z: e.pos.z, t: 2.2 });
  };

  private hurtPlayer(dmg: number, from: THREE.Vector3, killer: Enemy | null = null) {
    if (this.hud.status !== "playing") return;
    this.health -= dmg; this.lastHurt = this.t;
    this.damageFx = Math.min(1, this.damageFx + dmg / 28);
    this.audio.playerHurt(dmg);
    this.shake = Math.min(1.5, this.shake + dmg / 12);
    this.kickVP += (Math.random() - 0.3) * 1.5; this.roll += (Math.random() - 0.5) * 0.04;
    const dx = from.x - this.pos.x, dz = from.z - this.pos.z;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
    this.emit("damage", { angle: ang });
    if (this.health <= 0) this.die(killer);
  }

  private die(killer: Enemy | null = null) {
    this.health = 0; this.hud.status = "dead";
    this.resetTouch();
    document.exitPointerLock?.();
    if (this.mode !== "survival") {
      this.respawnT = RESPAWN_TIME;
      this.hud.respawnIn = RESPAWN_TIME;
      this.hud.killedBy = killer ? this.nameOf(killer) : "UNKNOWN";
      if (killer) this.creditBot(killer, "YOU");
    }
    this.emit("dead", { kills: this.kills, score: this.score, wave: this.wave, headshots: this.headshots });
  }

  /* ------------------------------ main loop ------------------------------ */
  private loop = (now: number) => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.fpsN++; this.fpsT += dt;
    if (this.fpsT > 0.5) { this.hud.fps = Math.round(this.fpsN / this.fpsT); this.fpsN = 0; this.fpsT = 0; }
    this.tick(dt);
    this.render(dt);
  };

  tick(dt: number) {
    this.t += dt;
    const status = this.hud.status;
    const playing = status === "playing";
    const teamMode = this.mode !== "survival";
    this.world.update(this.t);
    if (playing) this.updatePlayer(dt);
    else if (status === "dead") this.updateDead(dt);
    // in team modes the bots keep fighting while the player is down
    if (playing || (status === "dead" && teamMode)) {
      for (const e of this.enemies) e.update(dt, this.botCtx(e));
    } else if (status === "dead") {
      for (const e of this.enemies) if (e.dead) e.update(dt, { playerPos: this.pos } as EnemyCtx);
    }
    if (teamMode) {
      if (status === "playing" || status === "dead") this.matchUpdate(dt);
    } else if (playing) {
      this.waveUpdate(dt);
    }
    this.updateFx(dt);
    this.updateCamera(dt);
    this.updateHud(dt);
  }

  private collideEnemy(p: THREE.Vector3, r: number) {
    let push = this.collideCircle(p, r, 0, 1.8, 0.45);
    for (const o of this.enemies) {
      if (o.dead || o.pos === p) continue;
      const dx = p.x - o.pos.x, dz = p.z - o.pos.z, d = Math.hypot(dx, dz);
      if (d < r * 1.7 && d > 1e-4) { const k = (r * 1.7 - d) * 0.5; p.x += (dx / d) * k; p.z += (dz / d) * k; }
    }
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.8 && d > 1e-4) { p.x += (dx / d) * (0.8 - d) * 0.5; p.z += (dz / d) * (0.8 - d) * 0.5; }
    return push;
  }

  private updateDead(dt: number) {
    this.eye = THREE.MathUtils.lerp(this.eye, 0.35, 1 - Math.exp(-dt * 4));
    this.roll = THREE.MathUtils.lerp(this.roll, 0.9, 1 - Math.exp(-dt * 3));
    this.damageFx = Math.min(1, this.damageFx + dt * 0.3);
    this.ads = Math.max(0, this.ads - dt * 4);
  }

  private updatePlayer(dt: number) {
    const k = this.keys;
    const fwdIn = THREE.MathUtils.clamp((k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) + this.touchF, -1, 1);
    const strIn = THREE.MathUtils.clamp((k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) + this.touchS, -1, 1);
    if (k.has("ControlLeft") || k.has("KeyX")) this.crouch = true;
    // sprint: Shift, the touch SPRINT button, or a full forward push on the stick
    const wantSprint = (k.has("ShiftLeft") || k.has("ShiftRight") || this.touchSprint || this.touchF > 0.92) && fwdIn > 0.05 && !this.crouch && this.fireBlock <= 0 && !this.mouseR;
    if (wantSprint && this.onGround) this.sprinting = true;
    if (!wantSprint) this.sprinting = false;
    if (k.has("KeyW") === false && !wantSprint) this.sprinting = false;

    // ADS
    const adsTarget = this.mouseR && !this.sprinting && !this.vm.reloading ? 1 : 0;
    this.ads += (adsTarget - this.ads) * (1 - Math.exp(-dt * 12));

    // movement
    const speed = this.sprinting ? 6.6 : this.crouch ? 2.3 : this.ads > 0.5 ? 2.9 : 4.4;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wish = new THREE.Vector3(-sy * fwdIn + cy * strIn, 0, -cy * fwdIn - sy * strIn);
    // digital diagonals are normalised to full speed; partial analog stick input moves slower
    const wl = wish.length();
    if (wl > 1) wish.divideScalar(wl);
    wish.multiplyScalar(speed);
    const acc = this.onGround ? 14 : 2.2;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, acc * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, acc * dt);
    if (this.onGround && wish.lengthSq() === 0) { const f = Math.exp(-dt * 12); this.vel.x *= f; this.vel.z *= f; }

    if ((k.has("Space") || this.jumpQueued) && this.onGround && !this.crouch) { this.vel.y = 7.0; this.onGround = false; this.audio.footstep(false, false); }
    this.jumpQueued = false;
    this.vel.y -= 23 * dt;

    const feet = this.pos.y;
    this.pos.x += this.vel.x * dt; this.collideCircle(this.pos, 0.34, feet, this.crouch ? 1.2 : 1.8);
    this.pos.z += this.vel.z * dt; this.collideCircle(this.pos, 0.34, feet, this.crouch ? 1.2 : 1.8);
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -53, 53); this.pos.z = THREE.MathUtils.clamp(this.pos.z, -53, 53);

    const ground = this.groundAt(this.pos, 0.34, this.pos.y);
    const prevY = this.pos.y;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= ground && this.vel.y <= 0.0) {
      const impact = -this.vel.y;
      if (!this.onGround && impact > 5) { this.audio.land(Math.min(1, impact / 12)); this.landKick = Math.min(1, impact / 10); this.kickVP -= impact * 0.05; }
      if (this.onGround) this.stepSmooth += prevY - ground; // smooth step-ups
      this.pos.y = ground; this.vel.y = 0; this.onGround = true;
    } else if (this.pos.y > ground + 0.02) this.onGround = false;
    this.stepSmooth *= Math.exp(-dt * 14);

    const hs = Math.hypot(this.vel.x, this.vel.z);
    // footsteps / bob
    if (this.onGround && hs > 0.5) {
      this.stepDist += hs * dt;
      const stride = this.sprinting ? 2.3 : this.crouch ? 1.5 : 1.75;
      this.bobPhase += hs * dt * 1.6;
      if (this.stepDist > stride) { this.stepDist = 0; this.audio.footstep(this.sprinting, this.crouch); }
    }
    this.strafe = THREE.MathUtils.lerp(this.strafe, strIn, 1 - Math.exp(-dt * 8));

    // crouch eye
    const eyeT = this.crouch ? 1.15 : 1.7;
    this.eye = THREE.MathUtils.lerp(this.eye, eyeT, 1 - Math.exp(-dt * 12));
    if (!k.has("ControlLeft") && !k.has("KeyX") && false) this.crouch = false;

    // weapon handling
    this.fireT -= dt; this.fireBlock -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 0.03);
    if (this.t - this.lastShot > 0.25) this.burstN = 0;
    if (this.mouseDown || this.fireTapPending) { this.tryFire(); }
    this.fireTapPending = false;
    if (this.ammo === 0 && this.reserve > 0 && !this.vm.reloading && this.fireT <= 0) this.startReload();

    // regen
    if (this.t - this.lastHurt > 5 && this.health < 100) this.health = Math.min(100, this.health + dt * 28);
    this.damageFx = Math.max(0, this.damageFx - dt * 0.7);
    this.audio.heartbeat(this.health, dt);
    this.audio.ambient(dt, this.t, this.camera.position);
  }

  private updateFx(dt: number) {
    // particles
    const H = this.renderer.domElement.height;
    const scale = H / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    // fires -> flames, smoke, embers
    for (const f of this.world.fires) {
      this.smokeAcc += dt;
      const nF = Math.floor(dt * 50 + Math.random());
      for (let i = 0; i < nF; i++) {
        const p = f.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.35, 0, (Math.random() - 0.5) * 0.35));
        this.glow.spawn(p, new THREE.Vector3((Math.random() - 0.5) * 0.3, 1.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.3), { life: 0.5 + Math.random() * 0.4, size: 0.38, grow: -0.25, color: [2.4, 0.9, 0.2], alpha: 0.5, drag: 0.5 });
      }
      if (Math.random() < dt * 14) this.particles.spawn(f.pos.clone().add(new THREE.Vector3(0, 0.2, 0)), new THREE.Vector3(0.5 + Math.random() * 0.5, 1.4 + Math.random(), (Math.random() - 0.5) * 0.4), { life: 4 + Math.random() * 2, size: 0.5, grow: 2.6, color: [0.09, 0.085, 0.08], alpha: 0.5, drag: 0.25 });
      if (Math.random() < dt * 6) this.glow.spawn(f.pos, new THREE.Vector3((Math.random() - 0.5) * 1.2, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 1.2), { life: 1.2 + Math.random(), size: 0.035, grow: -0.02, color: [3, 1.2, 0.3], alpha: 1, drag: 0.2, gravity: -0.5 });
    }
    // dust motes
    this.moteAcc += dt * 16;
    while (this.moteAcc > 1) {
      this.moteAcc--;
      const p = this.camera.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 18, Math.random() * 5 - 1, (Math.random() - 0.5) * 18));
      p.y = Math.max(0.3, p.y);
      this.glow.spawn(p, new THREE.Vector3((Math.random() - 0.3) * 0.3, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.3), { life: 6 + Math.random() * 4, size: 0.022, grow: 0, color: [1.6, 1.3, 0.9], alpha: 0.28, drag: 0.1 });
    }
    this.particles.update(dt, scale);
    this.glow.update(dt, scale);
    this.tracers.update(dt);

    // lights
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 700);
    if (this.flashTimer > 0) { this.flashTimer -= dt; if (this.flashTimer <= 0) this.enemyFlash.intensity = 0; }
    // blips
    for (const b of this.blips) b.t -= dt;
    this.blips = this.blips.filter((b) => b.t > 0);
  }

  private updateCamera(dt: number) {
    const playing = this.hud.status === "playing";
    // view kick springs
    this.kickVP += (-this.kickPitch * 140 - this.kickVP * 17) * dt;
    this.kickPitch += this.kickVP * dt * 0.02;
    this.kickVY += (-this.kickYaw * 140 - this.kickVY * 17) * dt;
    this.kickYaw += this.kickVY * dt * 0.02;
    this.shake = Math.max(0, this.shake - dt * 4);
    this.roll *= Math.exp(-dt * (this.hud.status === "dead" ? 0.2 : 6));

    // fov
    const target = THREE.MathUtils.lerp(80, 54, this.ads) + (this.sprinting ? 5 : 0);
    this.fov += (target - this.fov) * (1 - Math.exp(-dt * 10));
    this.camera.fov = this.fov + this.shake * 0.4; this.camera.updateProjectionMatrix();

    const bobY = playing && this.onGround ? Math.sin(this.bobPhase * 2) * 0.016 * Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 4) * (1 - this.ads * 0.8) : 0;
    const bobX = playing && this.onGround ? Math.sin(this.bobPhase) * 0.012 * Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 4) * (1 - this.ads * 0.8) : 0;
    const sh = this.shake;
    const n = this.t * 38;
    this.camera.position.set(this.pos.x, this.pos.y + this.eye + bobY + this.stepSmooth - this.landKick * 0.08, this.pos.z);
    this.camera.rotation.order = "YXZ";
    const rollBob = bobX * 0.15 + this.roll + this.strafe * -0.012 + Math.sin(n) * 0.0016 * sh;
    this.camera.rotation.set(this.pitch + this.kickPitch * 0.9 + Math.sin(n * 1.3) * 0.0012 * sh, this.yaw + this.kickYaw, rollBob);
    this.camera.updateMatrixWorld();
    this.landKick = Math.max(0, this.landKick - dt * 3);

    // viewmodel
    const sp01 = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 6);
    this.vm.update(dt, {
      speed01: sp01, sprint: this.sprinting && sp01 > 0.5, ads: this.ads, lookX: this.lookDX / Math.max(dt, 0.001) * 0.02, lookY: this.lookDY / Math.max(dt, 0.001) * 0.02,
      grounded: this.onGround, crouch: this.crouch, t: this.t, camQuat: this.camera.quaternion, sunDir: SUN_DIR, strafe: this.strafe, landKick: this.landKick > 0.5 ? this.landKick * dt * 10 : 0,
    });
    this.lookDX = 0; this.lookDY = 0;

    const fwd = _v1.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.audio.setListener(this.camera.position, fwd);
  }

  private updateHud(dt: number) {
    const h = this.hud;
    h.health = Math.round(this.health); h.ammo = this.ammo; h.reserve = this.reserve; h.mag = MAG;
    h.reloadU = this.vm.reloadU; h.reloading = this.vm.reloading;
    h.kills = this.kills; h.headshots = this.headshots; h.score = this.score; h.wave = this.wave; h.streak = this.streak;
    h.yaw = this.yaw; h.ads = this.ads; h.sprint = this.sprinting; h.crouch = this.crouch;
    h.lowAmmo = this.ammo <= 8 && !this.vm.reloading;
    h.px = this.pos.x; h.pz = this.pos.z;
    const hpx = this.renderer.domElement.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    const moving = Math.hypot(this.vel.x, this.vel.z) > 1;
    const sp = THREE.MathUtils.lerp(0.022, 0.0012, this.ads) + this.bloom + (moving ? 0.01 : 0);
    h.spread = sp * hpx;
    if (h.bannerT > 0) h.bannerT -= dt;
    this.mmT -= dt;
    h.mode = this.mode; h.matchLeft = this.matchLeft; h.limit = KILL_LIMIT[this.mode];
    h.teamA = this.teamScore[0]; h.teamB = this.teamScore[1];
    let leader = "YOU", leaderKills = this.kills;
    for (const sl of this.slots) if (sl.kills > leaderKills) { leaderKills = sl.kills; leader = sl.name; }
    h.leader = leader; h.leaderKills = leaderKills;
    if (this.mmT <= 0) { this.mmT = 1 / 20; this.drawMinimap(); }
  }

  render(dt: number) {
    const u = this.post.grade.uniforms;
    u.time.value = this.t;
    u.damage.value = Math.min(1, this.damageFx * 0.9);
    u.lowHealth.value = THREE.MathUtils.clamp((45 - this.health) / 45, 0, 1) * (this.hud.status === "dead" ? 1 : 1);
    u.ads.value = this.ads;
    u.sprint.value = this.sprinting ? 1 : 0;
    this.post.render(dt);
  }

  /* ------------------------------ minimap ------------------------------ */
  setMinimap(c: HTMLCanvasElement | null) { this.mmCanvas = c ?? undefined; }
  private buildMinimap() {
    const S = 1024, ext = 60;
    const c = document.createElement("canvas"); c.width = c.height = S;
    const g = c.getContext("2d")!;
    g.fillStyle = "rgba(20,26,24,0.9)"; g.fillRect(0, 0, S, S);
    const m = (x: number) => (x + ext) / (2 * ext) * S;
    for (const col of this.world.colliders) {
      const w = col.max.x - col.min.x, d = col.max.z - col.min.z;
      const tall = col.max.y > 3;
      g.fillStyle = tall ? "rgba(130,140,130,0.85)" : col.max.y > 0.5 ? "rgba(190,200,190,0.9)" : "rgba(70,80,72,0.7)";
      g.fillRect(m(col.min.x), m(col.min.z), Math.max(2, w / (2 * ext) * S), Math.max(2, d / (2 * ext) * S));
    }
    this.mmStatic = c;
  }
  private drawMinimap() {
    const c = this.mmCanvas; if (!c || !this.mmStatic) return;
    const g = c.getContext("2d")!;
    const W = c.width, ext = 60, range = 34;
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 2, 0, 7); g.clip();
    g.translate(W / 2, W / 2);
    g.rotate(this.yaw);
    const S = this.mmStatic.width;
    const sc = (W / 2) / range; // px per meter
    g.scale(sc, sc);
    const px = (this.pos.x + ext) / (2 * ext) * S, pz = (this.pos.z + ext) / (2 * ext) * S;
    const k = (2 * ext) / S; // meters per source px
    g.drawImage(this.mmStatic, 0, 0, S, S, -(this.pos.x + ext), -(this.pos.z + ext), 2 * ext, 2 * ext);
    void px; void pz; void k;
    // enemy blips
    for (const b of this.blips) {
      g.fillStyle = `rgba(255,60,50,${Math.min(1, b.t)})`;
      g.beginPath(); g.arc(b.x - this.pos.x, b.z - this.pos.z, 1.1, 0, 7); g.fill();
    }
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      if (d < (this.mode === "survival" ? 9 : 34)) { g.fillStyle = e.team === PLAYER_TEAM ? "rgba(90,255,140,0.7)" : "rgba(255,60,50,0.55)"; g.beginPath(); g.arc(e.pos.x - this.pos.x, e.pos.z - this.pos.z, 1, 0, 7); g.fill(); }
    }
    g.restore();
    // player arrow
    g.save(); g.translate(W / 2, W / 2);
    g.fillStyle = "rgba(255,255,255,0.12)"; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, W / 2 - 4, -Math.PI / 2 - 0.7, -Math.PI / 2 + 0.7); g.closePath(); g.fill();
    g.fillStyle = "#fff"; g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill();
    g.restore();
  }
}
