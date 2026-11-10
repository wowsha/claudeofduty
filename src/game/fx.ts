import * as THREE from "three";
import * as T from "./textures";

export interface SpawnOpts {
  life: number; size: number; grow?: number; color: [number, number, number]; alpha: number;
  gravity?: number; drag?: number; rot?: number; spin?: number;
}

/** CPU-simulated point-sprite particles rendered with a custom soft-sprite shader. */
export class ParticleSystem {
  points: THREE.Points;
  private N: number;
  private pos: Float32Array; private col: Float32Array; private size: Float32Array; private rot: Float32Array;
  private vel: Float32Array; private life: Float32Array; private maxLife: Float32Array;
  private grow: Float32Array; private grav: Float32Array; private drag: Float32Array; private spin: Float32Array;
  private a0: Float32Array; private s0: Float32Array; private base: Float32Array;
  private geo: THREE.BufferGeometry;
  private idx = 0;
  material: THREE.ShaderMaterial;

  constructor(N: number, additive: boolean, mode: 0 | 1, map: THREE.Texture | null) {
    this.N = N;
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 4); this.size = new Float32Array(N); this.rot = new Float32Array(N);
    this.vel = new Float32Array(N * 3); this.life = new Float32Array(N); this.maxLife = new Float32Array(N).fill(1);
    this.grow = new Float32Array(N); this.grav = new Float32Array(N); this.drag = new Float32Array(N); this.spin = new Float32Array(N);
    this.a0 = new Float32Array(N); this.s0 = new Float32Array(N); this.base = new Float32Array(N * 3);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aRot", new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 800 }, uMap: { value: map }, uMode: { value: mode } },
      vertexShader: /* glsl */ `
        attribute vec4 aColor; attribute float aSize; attribute float aRot;
        uniform float uScale; varying vec4 vColor; varying float vRot;
        void main(){
          vColor = aColor; vRot = aRot;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 0.0, 900.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform int uMode; varying vec4 vColor; varying float vRot;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float a;
          if (uMode == 0) {
            float s = sin(vRot), co = cos(vRot);
            vec2 r = vec2(co*c.x - s*c.y, s*c.x + co*c.y) + 0.5;
            a = texture2D(uMap, r).r * 3.2;
          } else {
            float d = length(c) * 2.0;
            a = smoothstep(1.0, 0.0, d); a *= a;
          }
          gl_FragColor = vec4(vColor.rgb, vColor.a * clamp(a, 0.0, 1.0));
        }`,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.userData.noAO = true;
    this.points.renderOrder = 5;
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, o: SpawnOpts) {
    const i = this.idx; this.idx = (this.idx + 1) % this.N;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.life[i] = o.life; this.maxLife[i] = o.life;
    this.s0[i] = o.size; this.grow[i] = o.grow ?? 0; this.a0[i] = o.alpha;
    this.base[i * 3] = o.color[0]; this.base[i * 3 + 1] = o.color[1]; this.base[i * 3 + 2] = o.color[2];
    this.grav[i] = o.gravity ?? 0; this.drag[i] = o.drag ?? 0;
    this.rot[i] = o.rot ?? Math.random() * 6.28; this.spin[i] = o.spin ?? (Math.random() - 0.5) * 0.8;
    this.size[i] = o.size;
  }

  update(dt: number, scale: number) {
    this.material.uniforms.uScale.value = scale;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02 && this.grav[i] > 0) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.3; this.vel[i * 3] *= 0.6; this.vel[i * 3 + 2] *= 0.6; }
      this.rot[i] += this.spin[i] * dt;
      this.size[i] = this.s0[i] + this.grow[i] * t;
      const a = this.a0[i] * Math.min(1, t * 8) * (1 - t) * (1 - t * 0.3);
      this.col[i * 4] = this.base[i * 3]; this.col[i * 4 + 1] = this.base[i * 3 + 1]; this.col[i * 4 + 2] = this.base[i * 3 + 2];
      this.col[i * 4 + 3] = a;
    }
    const g = this.geo.attributes;
    g.position.needsUpdate = true; g.aColor.needsUpdate = true; g.aSize.needsUpdate = true; g.aRot.needsUpdate = true;
  }
}

export class Decals {
  private pool: THREE.Mesh[] = [];
  private idx = 0;
  private up = new THREE.Vector3(0, 0, 1);
  constructor(scene: THREE.Object3D, N = 160) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshStandardMaterial({
      map: T.makeBulletHole(), transparent: true, depthWrite: false, roughness: 1, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    for (let i = 0; i < N; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false; m.userData.noAO = true; m.receiveShadow = true;
      scene.add(m); this.pool.push(m);
    }
  }
  add(p: THREE.Vector3, n: THREE.Vector3, size = 0.16) {
    const m = this.pool[this.idx++ % this.pool.length];
    m.visible = true;
    m.position.copy(p).addScaledVector(n, 0.006);
    m.quaternion.setFromUnitVectors(this.up, n);
    m.rotateZ(Math.random() * 6.28);
    m.scale.setScalar(size * (0.8 + Math.random() * 0.5));
  }
}

interface Tracer { mesh: THREE.Mesh; from: THREE.Vector3; dir: THREE.Vector3; dist: number; travelled: number; speed: number; len: number; active: boolean }

export class Tracers {
  private pool: Tracer[] = [];
  constructor(scene: THREE.Object3D, N = 64) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0, -0.5); // origin at tail end; extends toward -z
    for (let i = 0; i < N; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3.2, 1.4), transparent: true, opacity: 0.95, depthWrite: false, fog: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false; mesh.userData.noAO = true; mesh.frustumCulled = false;
      scene.add(mesh);
      this.pool.push({ mesh, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, travelled: 0, speed: 0, len: 0, active: false });
    }
  }
  add(from: THREE.Vector3, to: THREE.Vector3, o: { speed?: number; len?: number; width?: number; color?: [number, number, number] } = {}) {
    const t = this.pool.find((x) => !x.active) ?? this.pool[0];
    t.from.copy(from); t.dir.copy(to).sub(from); t.dist = t.dir.length(); t.dir.normalize();
    t.travelled = 0; t.speed = o.speed ?? 320; t.len = o.len ?? 5; t.active = true;
    const w = o.width ?? 0.014;
    t.mesh.scale.set(w, w, 1);
    const c = o.color ?? [5, 3.2, 1.4];
    (t.mesh.material as THREE.MeshBasicMaterial).color.setRGB(c[0], c[1], c[2]);
    t.mesh.visible = true;
  }
  update(dt: number) {
    for (const t of this.pool) {
      if (!t.active) continue;
      t.travelled += t.speed * dt;
      const tail = Math.max(0, t.travelled - t.len);
      const head = Math.min(t.dist, t.travelled);
      if (tail >= t.dist) { t.active = false; t.mesh.visible = false; continue; }
      const L = Math.max(0.05, head - tail);
      t.mesh.position.copy(t.from).addScaledVector(t.dir, head);
      t.mesh.scale.z = L;
      t.mesh.visible = head > 6 || t.dist < 8;
      t.mesh.lookAt(t.mesh.position.x + t.dir.x, t.mesh.position.y + t.dir.y, t.mesh.position.z + t.dir.z);
    }
  }
}
