import * as THREE from "three";
import type { Tag } from "./world";

/** Fully synthesized, positional combat audio (no external assets). */
export class AudioEngine {
  ctx!: AudioContext;
  private master!: GainNode;
  private dry!: GainNode;
  private send!: GainNode;
  private noiseBuf!: AudioBuffer;
  ready = false;
  private ambT = 3;
  private wind?: { g: GainNode; f: BiquadFilterNode };
  private hbT = 0;

  init() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.2;
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.dry = ctx.createGain(); this.dry.connect(this.master);
    // convolution reverb (urban canyon tail)
    const conv = ctx.createConvolver();
    conv.buffer = this.makeIR(2.4);
    this.send = ctx.createGain(); this.send.gain.value = 1;
    const rg = ctx.createGain(); rg.gain.value = 0.55;
    this.send.connect(conv); conv.connect(rg); rg.connect(this.master);
    // noise
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ready = true;
    this.startWind();
  }

  private makeIR(sec: number) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = Math.floor(rate * sec);
    const buf = ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / rate;
        const env = Math.pow(1 - i / len, 3.2);
        lp += (Math.random() * 2 - 1 - lp) * (0.25 + 0.5 * (1 - t / sec));
        d[i] = lp * env * 1.4;
      }
      // discrete slap-back echoes from facades
      for (const [dt, a] of [[0.07, 0.5], [0.13, 0.4], [0.21, 0.3], [0.33, 0.2]]) {
        const k = Math.floor((dt + c * 0.011) * rate);
        for (let j = 0; j < 60; j++) d[k + j] += (Math.random() * 2 - 1) * a * (1 - j / 60);
      }
    }
    return buf;
  }

  setListener(pos: THREE.Vector3, fwd: THREE.Vector3) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    }
  }

  private noise(): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    return s;
  }

  /** returns [input node, distance] – positional chain if pos is provided */
  private dest(pos?: THREE.Vector3, listener?: THREE.Vector3): [AudioNode, number] {
    if (!pos) return [this.dry, 0];
    const ctx = this.ctx;
    const dist = listener ? pos.distanceTo(listener) : 10;
    const p = ctx.createPanner();
    p.panningModel = "HRTF"; p.distanceModel = "inverse"; p.refDistance = 7; p.rolloffFactor = 1.1; p.maxDistance = 400;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
    lp.frequency.value = Math.max(900, 17000 / (1 + dist / 14));
    lp.connect(p); p.connect(this.dry);
    return [lp, dist];
  }

  private env(g: GainNode, t: number, peak: number, atk: number, dec: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
  }

  private burst(out: AudioNode, t: number, o: { type?: BiquadFilterType; f: number; f2?: number; q?: number; peak: number; atk?: number; dec: number; reverb?: number }) {
    const ctx = this.ctx;
    const n = this.noise();
    const f = ctx.createBiquadFilter(); f.type = o.type ?? "bandpass"; f.frequency.value = o.f; f.Q.value = o.q ?? 0.8;
    if (o.f2) { f.frequency.setValueAtTime(o.f, t); f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.atk ?? 0.002) + o.dec); }
    const g = ctx.createGain();
    this.env(g, t, o.peak, o.atk ?? 0.002, o.dec);
    n.connect(f); f.connect(g); g.connect(out);
    if (o.reverb) { const s = ctx.createGain(); s.gain.value = o.reverb; g.connect(s); s.connect(this.send); }
    n.start(t, Math.random() * 1.5); n.stop(t + (o.atk ?? 0.002) + o.dec + 0.05);
  }

  private tone(out: AudioNode, t: number, o: { f: number; f2?: number; type?: OscillatorType; peak: number; atk?: number; dec: number; reverb?: number }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.atk ?? 0.002) + o.dec);
    const g = ctx.createGain(); this.env(g, t, o.peak, o.atk ?? 0.002, o.dec);
    osc.connect(g); g.connect(out);
    if (o.reverb) { const s = ctx.createGain(); s.gain.value = o.reverb; g.connect(s); s.connect(this.send); }
    osc.start(t); osc.stop(t + (o.atk ?? 0.002) + o.dec + 0.05);
  }

  /* ------------------------------ weapons ------------------------------ */
  shot(o: { pos?: THREE.Vector3; listener?: THREE.Vector3; kind?: "rifle" | "enemy" | "pistol"; vol?: number } = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const [out, dist] = this.dest(o.pos, o.listener);
    const v = (o.vol ?? 1) * (o.kind === "enemy" ? 0.9 : 1);
    const pv = 0.88 + Math.random() * 0.24;
    const far = Math.min(1, dist / 60);
    // supersonic crack
    this.burst(out, t, { type: "highpass", f: 2200 * pv, peak: 0.55 * v, dec: 0.035, reverb: 0.2 });
    this.burst(out, t, { type: "bandpass", f: 4200, q: 1.5, peak: 0.3 * v, dec: 0.02 });
    // body
    this.burst(out, t, { type: "lowpass", f: 3200 * pv, f2: 380, q: 0.7, peak: 1.0 * v, dec: 0.22, reverb: 0.5 });
    // chest thump
    this.tone(out, t, { f: 170 * pv, f2: 46, peak: 1.1 * v, dec: 0.16, reverb: 0.2 });
    this.tone(out, t, { f: 90 * pv, f2: 35, type: "triangle", peak: 0.7 * v, dec: 0.25 });
    // reverb tail / city slapback
    this.burst(this.send, t + 0.02, { type: "lowpass", f: 1400, f2: 300, peak: 0.6 * v * (1 - far * 0.4), dec: 0.9 });
  }

  impact(tag: Tag | "flesh" | "ground", pos: THREE.Vector3, listener: THREE.Vector3) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const [out] = this.dest(pos, listener);
    switch (tag) {
      case "metal":
        this.burst(out, t, { f: 3000, q: 1.2, peak: 0.5, dec: 0.05 });
        this.tone(out, t, { f: 1500 + Math.random() * 700, peak: 0.25, dec: 0.28, type: "triangle", reverb: 0.25 });
        this.tone(out, t, { f: 2650 + Math.random() * 500, peak: 0.12, dec: 0.2, reverb: 0.25 });
        break;
      case "wood":
        this.burst(out, t, { f: 900, q: 0.9, peak: 0.6, dec: 0.07 });
        this.tone(out, t, { f: 240, f2: 110, peak: 0.4, dec: 0.08 });
        break;
      case "glass":
        for (let i = 0; i < 4; i++) this.burst(out, t + i * 0.025, { type: "highpass", f: 4500, peak: 0.25, dec: 0.08 });
        break;
      case "flesh":
        this.burst(out, t, { type: "lowpass", f: 900, q: 0.6, peak: 0.8, dec: 0.12 });
        this.tone(out, t, { f: 130, f2: 60, peak: 0.5, dec: 0.1 });
        break;
      case "dirt": case "ground": case "fabric":
        this.burst(out, t, { type: "lowpass", f: 650, q: 0.6, peak: 0.55, dec: 0.1 });
        break;
      default:
        this.burst(out, t, { f: 2200, q: 0.8, peak: 0.5, dec: 0.045 });
        this.burst(out, t, { type: "lowpass", f: 500, peak: 0.35, dec: 0.08 });
    }
    if ((tag === "metal" || tag === "concrete" || tag === "brick") && Math.random() < 0.45) {
      const o2 = out;
      const ctx = this.ctx;
      const osc = ctx.createOscillator(); osc.type = "sawtooth";
      const f0 = 2600 + Math.random() * 1500;
      osc.frequency.setValueAtTime(f0, t + 0.01);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.35, t + 0.4);
      const lp = ctx.createBiquadFilter(); lp.type = "bandpass"; lp.frequency.value = 2400; lp.Q.value = 3;
      const g = ctx.createGain(); this.env(g, t + 0.01, 0.07, 0.01, 0.35);
      osc.connect(lp); lp.connect(g); g.connect(o2);
      osc.start(t); osc.stop(t + 0.5);
    }
  }

  whiz(pos: THREE.Vector3, listener: THREE.Vector3) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const [out] = this.dest(pos, listener);
    this.burst(out, t, { f: 3800, f2: 1100, q: 4, peak: 0.45, atk: 0.03, dec: 0.18 });
  }

  /* ------------------------------ feedback ------------------------------ */
  hitmarker(kind: "hit" | "head" | "kill") {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.dry;
    if (kind === "hit") {
      this.tone(o, t, { f: 1900, type: "square", peak: 0.14, dec: 0.03 });
      this.burst(o, t, { f: 3500, peak: 0.2, dec: 0.02 });
    } else if (kind === "head") {
      this.tone(o, t, { f: 2700, type: "square", peak: 0.17, dec: 0.05 });
      this.tone(o, t, { f: 4300, type: "sine", peak: 0.16, dec: 0.18, reverb: 0.2 });
      this.burst(o, t, { type: "lowpass", f: 1000, peak: 0.5, dec: 0.1 });
    } else {
      this.tone(o, t, { f: 1500, type: "square", peak: 0.15, dec: 0.05 });
      this.tone(o, t + 0.07, { f: 2100, type: "square", peak: 0.15, dec: 0.08 });
      this.tone(o, t, { f: 90, f2: 50, peak: 0.6, dec: 0.2 });
    }
  }

  playerHurt(dmg: number) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.tone(this.dry, t, { f: 80, f2: 40, peak: 0.6 * Math.min(1, dmg / 20), dec: 0.2 });
    this.burst(this.dry, t, { type: "lowpass", f: 600, peak: 0.5, dec: 0.15 });
    this.tone(this.dry, t, { f: 3100, peak: 0.03, dec: 0.5 });
  }

  heartbeat(health: number, dt: number) {
    if (!this.ready) return;
    this.hbT -= dt;
    if (health > 45 || this.hbT > 0) return;
    this.hbT = 0.5 + health / 100;
    const t = this.ctx.currentTime;
    this.tone(this.dry, t, { f: 62, f2: 40, peak: 0.55, dec: 0.15 });
    this.tone(this.dry, t + 0.17, { f: 55, f2: 38, peak: 0.4, dec: 0.15 });
  }

  /* ------------------------------ movement / handling ------------------------------ */
  footstep(sprint: boolean, crouch: boolean) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const v = crouch ? 0.3 : sprint ? 0.9 : 0.6;
    const k = 0.85 + Math.random() * 0.3;
    this.burst(this.dry, t, { type: "lowpass", f: 520 * k, q: 0.5, peak: 0.55 * v, dec: 0.07 });
    this.burst(this.dry, t, { f: 2400 * k, q: 1.2, peak: 0.12 * v, dec: 0.025 });
    this.tone(this.dry, t, { f: 85 * k, f2: 50, peak: 0.45 * v, dec: 0.08 });
    // gear rattle
    if (sprint) this.burst(this.dry, t + 0.02, { type: "highpass", f: 5000, peak: 0.05, dec: 0.06 });
  }

  land(hard: number) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.burst(this.dry, t, { type: "lowpass", f: 420, peak: 0.8 * hard, dec: 0.14 });
    this.tone(this.dry, t, { f: 70, f2: 40, peak: 0.7 * hard, dec: 0.16 });
  }

  clack(f = 1800, peak = 0.35, delay = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    this.burst(this.dry, t, { f, q: 2, peak, dec: 0.03 });
    this.tone(this.dry, t, { f: f * 0.6, f2: f * 0.4, type: "triangle", peak: peak * 0.5, dec: 0.05 });
  }
  magOut() { this.clack(1400, 0.4); this.clack(700, 0.3, 0.02); }
  magIn() { this.clack(900, 0.55); this.tone(this.dry, this.ctx.currentTime, { f: 120, f2: 70, peak: 0.4, dec: 0.08 }); this.clack(2400, 0.2, 0.05); }
  boltBack() { if (!this.ready) return; const t = this.ctx.currentTime; this.burst(this.dry, t, { f: 2000, f2: 900, q: 1.5, peak: 0.25, atk: 0.02, dec: 0.1 }); this.clack(1200, 0.4, 0.1); }
  boltFwd() { this.clack(1000, 0.5); this.clack(2600, 0.25, 0.04); }
  dryFire() { this.clack(2200, 0.3); }
  shell() { if (!this.ready) return; const t = this.ctx.currentTime; const k = 0.9 + Math.random() * 0.3; this.tone(this.dry, t, { f: 4200 * k, peak: 0.07, dec: 0.12, reverb: 0.1 }); this.tone(this.dry, t + 0.012, { f: 6300 * k, peak: 0.04, dec: 0.08 }); }
  bodyFall(pos: THREE.Vector3, listener: THREE.Vector3) {
    if (!this.ready) return;
    const [out] = this.dest(pos, listener);
    const t = this.ctx.currentTime;
    this.burst(out, t, { type: "lowpass", f: 380, peak: 0.9, dec: 0.18 });
    this.tone(out, t, { f: 80, f2: 40, peak: 0.6, dec: 0.2 });
    this.burst(out, t + 0.02, { type: "highpass", f: 3500, peak: 0.07, dec: 0.1 });
  }
  uiClick() { if (!this.ready) return; this.tone(this.dry, this.ctx.currentTime, { f: 800, type: "square", peak: 0.05, dec: 0.04 }); }
  waveStart() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.tone(this.dry, t, { f: 110, f2: 55, type: "sawtooth", peak: 0.2, atk: 0.05, dec: 1.2, reverb: 0.5 });
    this.tone(this.dry, t + 0.1, { f: 220, f2: 110, type: "triangle", peak: 0.15, atk: 0.05, dec: 1.0, reverb: 0.5 });
  }

  /* ------------------------------ ambience ------------------------------ */
  private startWind() {
    const ctx = this.ctx;
    const n = this.noise();
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 380; f.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.value = 0.05;
    n.connect(f); f.connect(g); g.connect(this.dry); g.connect(this.send);
    n.start();
    this.wind = { g, f };
  }

  ambient(dt: number, t: number, listener: THREE.Vector3) {
    if (!this.ready) return;
    if (this.wind) {
      this.wind.g.gain.value = 0.035 + 0.025 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1);
      this.wind.f.frequency.value = 300 + 180 * Math.sin(t * 0.17);
    }
    this.ambT -= dt;
    if (this.ambT <= 0) {
      this.ambT = 5 + Math.random() * 9;
      const a = Math.random() * Math.PI * 2, d = 140 + Math.random() * 120;
      const p = new THREE.Vector3(listener.x + Math.cos(a) * d, 5, listener.z + Math.sin(a) * d);
      const now = this.ctx.currentTime;
      if (Math.random() < 0.4) {
        // distant boom
        const [out] = this.dest(p, listener);
        this.burst(out, now, { type: "lowpass", f: 500, f2: 80, peak: 1.0, dec: 1.4, reverb: 0.8 });
        this.tone(out, now, { f: 70, f2: 28, peak: 1.0, dec: 1.0, reverb: 0.4 });
      } else {
        const n = 3 + Math.floor(Math.random() * 6);
        for (let i = 0; i < n; i++) {
          const [out] = this.dest(p, listener);
          const tt = now + i * 0.1;
          this.burst(out, tt, { type: "lowpass", f: 2200, f2: 400, peak: 0.6, dec: 0.15, reverb: 0.6 });
          this.burst(out, tt, { type: "highpass", f: 2500, peak: 0.2, dec: 0.03 });
        }
      }
    }
  }
}
