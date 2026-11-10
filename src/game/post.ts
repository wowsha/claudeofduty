import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";

/** Cinematic grade: chromatic aberration, shadow-teal / highlight-warm split tone, vignette, damage, grain. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    time: { value: 0 },
    damage: { value: 0 },
    lowHealth: { value: 0 },
    ads: { value: 0 },
    sprint: { value: 0 },
    aspect: { value: 1 },
    texel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time, damage, lowHealth, ads, sprint, aspect; uniform vec2 texel;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p*vec2(443.897,441.423)); p += dot(p, p.yx+19.19); return fract((p.x+p.y)*p.x); }
    void main(){
      vec2 uv = vUv; vec2 c = uv - 0.5;
      float r2 = dot(c*vec2(aspect,1.0), c*vec2(aspect,1.0));
      float ca = (0.0006 + sprint*0.0012 + damage*0.0025 + ads*0.0004) * r2 * 5.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c*ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c*ca).b;
      // subtle sharpen (unsharp mask)
      vec3 blur = (texture2D(tDiffuse, uv + vec2(texel.x,0.)).rgb + texture2D(tDiffuse, uv - vec2(texel.x,0.)).rgb
                 + texture2D(tDiffuse, uv + vec2(0.,texel.y)).rgb + texture2D(tDiffuse, uv - vec2(0.,texel.y)).rgb) * 0.25;
      col += (col - blur) * 0.35;
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      // split tone
      col = mix(col, col * vec3(0.93,1.0,1.08) + vec3(-0.004,0.002,0.012), (1.0 - smoothstep(0.0,0.5,l)) * 0.7);
      col = mix(col, col * vec3(1.06,1.0,0.92), smoothstep(0.45,1.0,l) * 0.6);
      // saturation / contrast
      float sat = 1.06 - lowHealth * 0.65;
      col = mix(vec3(l), col, sat);
      col = (col - 0.5) * (1.07 + lowHealth*0.1) + 0.5;
      // vignette
      float vig = smoothstep(1.05, 0.25, sqrt(r2) * 1.25);
      col *= mix(1.0, vig, 0.62 + ads*0.28);
      // damage / low health red edges
      float edge = smoothstep(0.5, 1.15, sqrt(r2) * 1.5);
      col = mix(col, col * vec3(1.25,0.3,0.26) + vec3(0.1,0.0,0.0), clamp(damage,0.,1.) * edge * 0.85);
      col = mix(col, col * vec3(1.0,0.35,0.32), lowHealth * edge * 0.5);
      // film grain + dither
      float g = hash(uv * (1.0/texel) + fract(time) * 71.0) - 0.5;
      col += g * (0.028 + 0.018 * (1.0 - l));
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class Post {
  composer: EffectComposer;
  gtao: GTAOPass | null = null;
  bloom: UnrealBloomPass | null = null;
  grade: ShaderPass;
  private weaponPass: RenderPass;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, wScene: THREE.Scene, wCam: THREE.Camera, w: number, h: number, public quality: number) {
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: quality >= 2 ? 4 : quality === 1 ? 2 : 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(scene, camera));

    if (quality >= 1) {
      const gtao = new GTAOPass(scene, camera, w, h);
      gtao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.3, thickness: 1.2, scale: 1.15, samples: quality >= 2 ? 16 : 8, distanceFallOff: 1.0, screenSpaceRadius: false });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1, rings: 2, samples: quality >= 2 ? 16 : 8 });
      gtao.blendIntensity = 1.0;
      // exclude transparent FX (tracers, decals, particles) from the G-buffer
      const gt = gtao as unknown as { _overrideVisibility: () => void; scene: THREE.Scene; _visibilityCache: THREE.Object3D[] };
      gt._overrideVisibility = function () {
        this.scene.traverse((o: THREE.Object3D) => {
          const m = o as THREE.Mesh;
          if (((o as THREE.Points).isPoints || (o as THREE.Line).isLine || o.userData.noAO || (m.isMesh && (m.material as THREE.Material).transparent)) && o.visible) {
            o.visible = false; this._visibilityCache.push(o);
          }
        });
      };
      this.composer.addPass(gtao);
      this.gtao = gtao;
    }

    this.weaponPass = new RenderPass(wScene, wCam);
    this.weaponPass.clear = false;
    this.weaponPass.clearDepth = true;
    this.composer.addPass(this.weaponPass);

    if (quality >= 1) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.5, 1.4);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    if (quality >= 1) this.composer.addPass(new SMAAPass());
    this.resize(w, h);
  }

  resize(w: number, h: number) {
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.grade.uniforms.texel.value.set(1 / (w * pr), 1 / (h * pr));
    this.grade.uniforms.aspect.value = w / h;
  }

  render(dt: number) {
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
  }
}
