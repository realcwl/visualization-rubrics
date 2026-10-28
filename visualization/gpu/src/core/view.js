import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clamp } from './util.js';

function backdrop() {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#111a2e');
  grad.addColorStop(0.55, '#0a0f1b');
  grad.addColorStop(1, '#06080e');
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function floorTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rad.addColorStop(0, 'rgba(120,150,220,0.22)');
  rad.addColorStop(0.45, 'rgba(80,100,160,0.07)');
  rad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, S, S);
  // faint grid that fades out radially
  g.globalCompositeOperation = 'source-atop';
  g.strokeStyle = 'rgba(170,190,240,0.18)';
  g.lineWidth = 1;
  for (let i = 0; i <= S; i += 32) {
    g.beginPath();
    g.moveTo(i + 0.5, 0);
    g.lineTo(i + 0.5, S);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i + 0.5);
    g.lineTo(S, i + 0.5);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * One 3-D viewport: renderer + bloom composer + CSS labels + orbit camera with
 * an optional "director" that glides between named shots.
 */
export class View {
  constructor(host) {
    this.host = host;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    host.appendChild(r.domElement);

    this.css = new CSS2DRenderer();
    this.css.domElement.className = 'labels';
    host.appendChild(this.css.domElement);

    const scene = (this.scene = new THREE.Scene());
    scene.background = backdrop();
    scene.fog = new THREE.Fog(0x070a12, 55, 120);
    const pm = new THREE.PMREMGenerator(r);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.42;
    scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x0a0e18, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.3);
    key.position.set(-8, 18, 14);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x86a6ff, 0.7);
    rim.position.set(12, 6, -10);
    scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 70),
      new THREE.MeshBasicMaterial({ map: floorTexture(), transparent: true, depthWrite: false })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.03;
    scene.add(floor);
    this.floor = floor;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);
    this.camera.position.set(6, 10, 30);
    const ctl = (this.controls = new OrbitControls(this.camera, r.domElement));
    ctl.enableDamping = true;
    ctl.dampingFactor = 0.08;
    ctl.minDistance = 2.5;
    ctl.maxDistance = 70;
    ctl.maxPolarAngle = Math.PI * 0.6;
    ctl.rotateSpeed = 0.7;
    ctl.zoomSpeed = 0.9;
    ctl.screenSpacePanning = true;
    this.auto = true;
    ctl.addEventListener('start', () => {
      this.auto = false;
      this.glide = false;
      this.onManual?.();
    });

    const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(16, 16), 0.62, 0.5, 0.86);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.shots = {};
    this.shot = null;
    this.visible = true;
    this.time = 0;
    this.pickables = [];
    this.onPick = null;
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._desired = new THREE.Vector3();
    this._dir = new THREE.Vector3();

    let down = null;
    r.domElement.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
    r.domElement.addEventListener('pointerup', (e) => {
      if (down && (e.clientX - down[0]) ** 2 + (e.clientY - down[1]) ** 2 < 25) {
        const hit = this.raycast(e);
        this.onPick?.(hit ? hit.object.userData.info : null, e.clientX, e.clientY, this);
      }
      down = null;
    });
    r.domElement.addEventListener('pointermove', (e) => {
      if (e.buttons) return;
      const hit = this.raycast(e);
      r.domElement.style.cursor = hit ? 'pointer' : 'grab';
    });

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  raycast(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this._ray.setFromCamera(this._ndc, this.camera);
    const hits = this._ray.intersectObjects(this.pickables, false);
    return hits.find((h) => h.object.userData.info) || null;
  }

  resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.css.setSize(w, h);
    this.camera.aspect = w / h;
    this.w = w;
    this.h = h;
    if (this.inset) this.applyInsets(1);
    else this.camera.updateProjectionMatrix();
    this.onResize?.();
  }

  /** shots: { name: { target: Vector3, dir: Vector3, w, h } } */
  setShots(shots) {
    this.shots = shots;
  }

  /** Screen-space margins (px) covered by UI; shots are framed inside the rest. */
  setInsets(ins, immediate = false) {
    this.insetTarget = { ...ins };
    if (immediate || !this.inset) this.inset = { ...ins };
  }

  applyInsets(dt) {
    if (!this.insetTarget || !this.w) return;
    const k = 1 - Math.exp(-dt * 5);
    for (const key of ['top', 'bottom', 'left', 'right']) this.inset[key] += (this.insetTarget[key] - this.inset[key]) * k;
    const { top, bottom, left, right } = this.inset;
    this.camera.setViewOffset(this.w, this.h, (right - left) / 2, (bottom - top) / 2, this.w, this.h);
  }

  fitDistance(s) {
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const ins = this.insetTarget || { top: 0, bottom: 0, left: 0, right: 0 };
    const fh = Math.max(0.3, (this.h - ins.top - ins.bottom) / this.h);
    const fw = Math.max(0.3, (this.w - ins.left - ins.right) / this.w);
    return Math.max(s.h / 2 / (t * fh), s.w / 2 / (t * this.camera.aspect * fw)) * 1.03;
  }

  /** Glide to a named shot. Works in manual mode too (one-off move). */
  goTo(name, immediate = false) {
    this.shot = name;
    this.glide = true;
    if (immediate) this.snap();
  }

  snap() {
    const s = this.shots[this.shot];
    if (!s) return;
    this.camera.position.copy(s.target).addScaledVector(this._dir.copy(s.dir).normalize(), this.fitDistance(s));
    this.controls.target.copy(s.target);
    this.controls.update();
  }

  update(dt) {
    this.time += dt;
    const s = this.shots[this.shot];
    if ((this.auto || this.glide) && s) {
      // a slow, almost imperceptible drift keeps the scene alive
      const yaw = Math.sin(this.time * 0.11) * 0.06;
      const d = this._dir.copy(s.dir).normalize();
      const cx = d.x * Math.cos(yaw) + d.z * Math.sin(yaw);
      const cz = -d.x * Math.sin(yaw) + d.z * Math.cos(yaw);
      d.set(cx, d.y, cz);
      this._desired.copy(s.target).addScaledVector(d, this.fitDistance(s));
      const k = 1 - Math.exp(-dt * 1.6);
      this.camera.position.lerp(this._desired, k);
      this.controls.target.lerp(s.target, k);
      if (!this.auto && this.camera.position.distanceTo(this._desired) < 0.02) this.glide = false;
    }
    this.controls.update();
    this.applyInsets(dt);
    // label size follows how many pixels one world unit covers
    const dist = this.camera.position.distanceTo(this.controls.target);
    const ppu = this.h / (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    const ls = clamp(Math.pow(ppu / 52, 0.45), 0.8, 1.22);
    const el = this.css.domElement;
    el.style.setProperty('--ls', ls.toFixed(3));
    const zoom = ppu < 46 ? 'far' : ppu < 70 ? 'mid' : 'near';
    if (el.dataset.zoom !== zoom) el.dataset.zoom = zoom;
  }

  render() {
    if (!this.visible || !this.w) return;
    this.composer.render();
    this.css.render(this.scene, this.camera);
  }
}
