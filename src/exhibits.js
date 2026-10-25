import * as THREE from 'three';
import { IMG, VID } from './config.js';
import { settings } from './settings.js';
import {
  makePlaqueTexture, makeMessageTexture, getHaloTexture, disposeTexture, loadImageTexture, sampleColor, PLAQUE_ASPECT,
} from './textures.js';
import { hashString, formatDuration, stripExt } from './util.js';

const unitPlane = new THREE.PlaneGeometry(1, 1);
const unitBox = new THREE.BoxGeometry(1, 1, 1);

const FRAME_MATS = [
  new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.55 }),
  new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.35 }),
  new THREE.MeshStandardMaterial({ color: 0xb48f3e, roughness: 0.32, metalness: 0.85 }),
  new THREE.MeshStandardMaterial({ color: 0xe6e2d9, roughness: 0.5 }),
];
const passepartoutMat = new THREE.MeshStandardMaterial({ color: 0xf1ede4, emissive: 0x1c1b19, roughness: 0.95 });
const bezelMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.25, metalness: 0.4 });
const marbleMat = new THREE.MeshStandardMaterial({ color: 0xe9e5dd, roughness: 0.35 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x5b3820, roughness: 0.5 });
const brassMat = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.28, metalness: 0.9, side: THREE.DoubleSide });
const vinylMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.25 });
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
const ledOff = new THREE.MeshBasicMaterial({ color: 0x5a1010 });
const ledOn = new THREE.MeshBasicMaterial({ color: 0x33ff77, toneMapped: false });

const PLACEHOLDER = 0x2b2926;
const PLAQUE_W = 0.62;

const BLACK = new THREE.Color(0, 0, 0);
const DIM = new THREE.Color(0.5, 0.5, 0.5);
const FORWARD = new THREE.Vector3(0, 0, 1);
const tmpQ = new THREE.Quaternion();

/** Material aditivo para la luz que una obra proyecta sobre pared o suelo. */
function glowMaterial() {
  return new THREE.MeshBasicMaterial({
    map: getHaloTexture(), color: 0x000000, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
  });
}

function fit(aspect, maxW, maxH) {
  let w = maxW, h = w / aspect;
  if (h > maxH) { h = maxH; w = h * aspect; }
  return [w, h];
}

class Exhibit {
  constructor(item, room) {
    this.item = item;
    this.room = room;
    this.title = stripExt(item.name);
    this.group = new THREE.Group();
    this.worldPos = new THREE.Vector3();
    this.normal = new THREE.Vector3(0, 0, 1);
    this.lightPos = new THREE.Vector3();  // donde se coloca la luz dinámica de la obra
    this.lightOffset = new THREE.Vector3(0, 0, 1.2);
    this.glowColor = new THREE.Color(0, 0, 0);
    this.glowLevel = 0;
    this.active = false;
    this.plaque = new THREE.Mesh(unitPlane, new THREE.MeshBasicMaterial({ toneMapped: false }));
    this.plaque.scale.set(PLAQUE_W, PLAQUE_W / PLAQUE_ASPECT, 1);
    this.plaque.visible = false;
    this.group.add(this.plaque);
  }

  /** Meshes que responden a la mira. */
  get targets() { return []; }

  extraInfo() { return ''; }

  showPlaque() {
    const m = this.plaque.material;
    disposeTexture(m.map);
    m.map = makePlaqueTexture(this.item, this.extraInfo());
    m.needsUpdate = true;
    this.plaque.visible = true;
  }

  hidePlaque() {
    const m = this.plaque.material;
    disposeTexture(m.map);
    m.map = null;
    this.plaque.visible = false;
  }

  /**
   * Halo sobre la pared (opcional) y charco de luz en el suelo, del color de la obra.
   * floorY: altura del suelo en coordenadas del grupo; poolZ: distancia del charco a la pared.
   */
  makeGlow({ halo = true, floorY, poolZ = 1.5 }) {
    this.poolMat = glowMaterial();
    this.pool = new THREE.Mesh(unitPlane, this.poolMat);
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.set(0, floorY + 0.015, poolZ);
    this.group.add(this.pool);
    (this.ownMaterials ??= []).push(this.poolMat);
    if (halo) {
      this.haloMat = glowMaterial();
      this.halo = new THREE.Mesh(unitPlane, this.haloMat);
      this.halo.position.z = 0.004;
      this.group.add(this.halo);
      this.ownMaterials.push(this.haloMat);
    }
  }

  setGlow(color, level) {
    this.glowColor.copy(color);
    this.glowLevel = level;
    this.applyGlow();
  }

  applyGlow() {
    const k = this.glowLevel * settings.glow;
    this.haloMat?.color.copy(this.glowColor).multiplyScalar(k * 0.85);
    this.poolMat?.color.copy(this.glowColor).multiplyScalar(k * 0.65);
  }

  /** Libera todo al destruir la sala. */
  dispose() {
    if (this.active) this.deactivate();
    this.plaque.material.dispose();
    for (const m of this.ownMaterials ?? []) m.dispose();
  }

  updateWorldPos() {
    this.group.updateWorldMatrix(true, false);
    this.group.getWorldPosition(this.worldPos);
    this.group.getWorldQuaternion(tmpQ);
    this.normal.copy(FORWARD).applyQuaternion(tmpQ);
    this.lightPos.copy(this.lightOffset).applyQuaternion(tmpQ).add(this.worldPos);
  }
}

// ---------------------------------------------------------------- Imagen

export class ImageExhibit extends Exhibit {
  kind = 'image';

  constructor(item, room) {
    super(item, room);
    this.state = 'idle';
    this.aspect = 4 / 3;
    this.frame = new THREE.Mesh(unitBox, FRAME_MATS[hashString(item.name) % FRAME_MATS.length]);
    this.passe = new THREE.Mesh(unitPlane, passepartoutMat);
    this.pic = new THREE.Mesh(unitPlane, new THREE.MeshBasicMaterial({ color: PLACEHOLDER, toneMapped: false }));
    this.pic.userData.exhibit = this.frame.userData.exhibit = this;
    this.ownMaterials = [this.pic.material];
    this.group.add(this.frame, this.passe, this.pic);
    this.makeGlow({ floorY: -IMG.y });
    this.layout();
  }

  get targets() { return [this.pic, this.frame]; }

  layout() {
    const [w, h] = fit(this.aspect, IMG.maxW, IMG.maxH);
    const m = 0.12, f = 0.07;
    this.pic.scale.set(w, h, 1);
    this.pic.position.z = 0.066;
    this.passe.scale.set(w + 2 * m, h + 2 * m, 1);
    this.passe.position.z = 0.063;
    this.frame.scale.set(w + 2 * (m + f), h + 2 * (m + f), 0.05);
    this.frame.position.z = 0.035;
    this.halo.scale.set(w + 2.6, h + 2.6, 1);
    this.pool.scale.set(w + 2.4, 3.2, 1);
    this.plaque.position.set(0, -(h / 2 + m + f) - 0.22, 0.012);
  }

  activate(ctx) {
    this.active = true;
    this.showPlaque();
    if (this.state === 'idle') ctx.enqueue(this);
  }

  async load(ctx) {
    if (!this.active || this.state !== 'idle') return;
    this.state = 'loading';
    let tex = null;
    try { tex = await loadImageTexture(this.item, settings.textureMax, ctx.saveThumb); }
    catch (e) { console.warn('Imagen no compatible:', this.item.name, e); }
    if (!this.active) { disposeTexture(tex); this.state = 'idle'; return; }
    if (tex) {
      this.aspect = tex.userData.aspect;
      this.state = 'loaded';
      this.setGlow(tex.userData.color ?? DIM, tex.userData.level ?? 0.3);
    } else {
      tex = makeMessageTexture('Imagen no compatible', this.item.name);
      this.aspect = 16 / 9;
      this.state = 'error';
      this.setGlow(DIM, 0.15);
    }
    this.texture = tex;
    const mat = this.pic.material;
    mat.map = tex;
    mat.color.set(0xffffff);
    mat.needsUpdate = true;
    this.layout();
  }

  deactivate() {
    this.active = false;
    this.hidePlaque();
    disposeTexture(this.texture);
    this.texture = null;
    const mat = this.pic.material;
    mat.map = null;
    mat.color.set(PLACEHOLDER);
    mat.needsUpdate = true;
    this.setGlow(BLACK, 0);
    if (this.state !== 'loading') this.state = 'idle';
  }
}

// ---------------------------------------------------------------- Video

export class VideoExhibit extends Exhibit {
  kind = 'video';

  constructor(item, room) {
    super(item, room);
    this.aspect = 16 / 9;
    this.soundOn = false;
    this.bezel = new THREE.Mesh(unitBox, bezelMat);
    this.screen = new THREE.Mesh(unitPlane, new THREE.MeshBasicMaterial({ color: 0x050505, toneMapped: false }));
    this.led = new THREE.Mesh(unitPlane, ledOff);
    this.screen.userData.exhibit = this.bezel.userData.exhibit = this;
    this.ownMaterials = [this.screen.material];
    this.group.add(this.bezel, this.screen, this.led);
    this.makeGlow({ floorY: -VID.y, poolZ: 1.8 });
    this.lightOffset.set(0, 0, 1.4);
    this.target = new THREE.Color();
    this.targetLevel = 0;
    this.sampleTimer = 0;
    this.layout();
  }

  get targets() { return [this.screen, this.bezel]; }

  extraInfo() {
    return this.duration ? `Duración ${formatDuration(this.duration)}` : '';
  }

  layout() {
    const [w, h] = fit(this.aspect, VID.maxW, VID.maxH);
    const b = 0.07;
    this.screen.scale.set(w, h, 1);
    this.screen.position.z = 0.1;
    this.bezel.scale.set(w + 2 * b, h + 2 * b, 0.08);
    this.bezel.position.z = 0.055;
    this.led.scale.set(0.03, 0.03, 1);
    this.led.position.set(w / 2 - 0.03, -h / 2 - b / 2, 0.0965);
    this.halo.scale.set(w + 3, h + 3, 1);
    this.pool.scale.set(w + 3, 3.8, 1);
    this.plaque.position.set(0, -(h / 2 + b) - 0.24, 0.012);
  }

  setScreen(tex) {
    const mat = this.screen.material;
    if (mat.map !== this.texture) disposeTexture(mat.map);
    mat.map = tex;
    mat.color.set(tex ? 0xffffff : 0x050505);
    mat.needsUpdate = true;
  }

  /**
   * La luz de la pantalla sigue al video: se muestrea el color del fotograma unas
   * 8 veces por segundo y se suaviza para que no parpadee.
   */
  updateGlow(dt) {
    if (!this.active) return;
    const v = this.video;
    const playing = v && !v.paused && this.texture;
    this.sampleTimer -= dt;
    if (this.sampleTimer <= 0 && this.texture && (playing || this.targetLevel === 0)) {
      this.sampleTimer = settings.liveVideoColor ? 0.12 : 2;
      const level = sampleColor(v, this.target);
      if (level >= 0) this.targetLevel = level;
    }
    const want = this.failed ? 0.12 : this.texture ? this.targetLevel * (playing ? 1 : 0.45) : 0.15;
    const k = Math.min(1, dt * 5);
    if (!this.texture) this.target.copy(DIM);
    this.glowColor.lerp(this.target, k);
    this.glowLevel += (want - this.glowLevel) * k;
    this.applyGlow();
  }

  activate() {
    this.active = true;
    this.showPlaque();
    this.setScreen(makeMessageTexture('▶  ' + this.title, 'Acércate para reproducir'));
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'metadata';
    v.addEventListener('loadedmetadata', () => {
      if (v !== this.video) return;
      if (v.videoWidth && v.videoHeight) { this.aspect = v.videoWidth / v.videoHeight; this.layout(); }
      this.duration = v.duration;
      this.showPlaque();
      // fuerza la decodificación de un fotograma para que la pantalla no quede negra
      if (v.paused && Number.isFinite(v.duration)) v.currentTime = Math.min(1, v.duration / 10);
    });
    v.addEventListener('loadeddata', () => {
      if (v !== this.video || this.texture) return;
      this.texture = new THREE.VideoTexture(v);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.setScreen(this.texture);
    });
    v.addEventListener('error', () => {
      if (v !== this.video) return;
      this.failed = true;
      this.setScreen(makeMessageTexture('Formato de video no compatible', this.item.name));
    });
    v.src = this.item.url;
    this.video = v;
  }

  get ready() { return !!this.video && !this.failed; }

  setPlaying(on) {
    const v = this.video;
    if (!v || this.failed) return;
    if (on && v.paused) v.play().catch(() => {});
    else if (!on && !v.paused) v.pause();
  }

  toggleSound(listener) {
    if (!this.ready) return false;
    if (!this.sound) {
      this.sound = new THREE.PositionalAudio(listener);
      this.sound.setMediaElementSource(this.video);
      this.sound.setRefDistance(2.5);
      this.sound.setRolloffFactor(1.3);
      this.sound.position.set(0, 0, 0.3);
      this.group.add(this.sound);
    }
    this.soundOn = !this.soundOn;
    this.autoSound = false;
    this.video.muted = !this.soundOn;
    this.led.material = this.soundOn ? ledOn : ledOff;
    if (this.soundOn) this.setPlaying(true);
    return this.soundOn;
  }

  deactivate() {
    this.active = false;
    this.hidePlaque();
    if (this.sound) {
      this.sound.disconnect();
      this.sound.gain.disconnect();
      this.sound.removeFromParent();
      this.sound = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
      this.video = null;
    }
    this.setScreen(null);
    disposeTexture(this.texture);
    this.texture = null;
    this.targetLevel = 0;
    this.setGlow(BLACK, 0);
    this.failed = false;
    this.soundOn = false;
    this.autoSound = false;
    this.led.material = ledOff;
  }
}

// ---------------------------------------------------------------- Audio (gramófono)

const BARS = 24;
const BAR_RADIUS = 0.68;
const hornGeo = new THREE.ConeGeometry(0.27, 0.55, 28, 1, true);
const discGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.012, 40);
const labelGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.014, 24);
const pipeGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 10);
const dummy = new THREE.Object3D();

export class AudioExhibit extends Exhibit {
  kind = 'audio';

  constructor(item, room) {
    super(item, room);
    const hue = (hashString(item.name) % 360) / 360;
    this.color = new THREE.Color().setHSL(hue, 0.8, 0.58);

    const pedestal = new THREE.Mesh(unitBox, marbleMat);
    pedestal.scale.set(0.7, 1.0, 0.7);
    pedestal.position.y = 0.5;
    const cap = new THREE.Mesh(unitBox, marbleMat);
    cap.scale.set(0.8, 0.05, 0.8);
    cap.position.y = 1.025;
    const base = new THREE.Mesh(unitBox, woodMat);
    base.scale.set(0.52, 0.13, 0.52);
    base.position.y = 1.115;

    this.disc = new THREE.Group();
    this.disc.position.set(0, 1.186, 0.03);
    const vinyl = new THREE.Mesh(discGeo, vinylMat);
    const label = new THREE.Mesh(labelGeo, new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.6 }));
    const mark = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({ color: 0xf5f0e0 }));
    mark.scale.set(0.05, 0.016, 0.012);
    mark.position.x = 0.04;
    this.disc.add(vinyl, label, mark);

    const arm = new THREE.Mesh(unitBox, brassMat);
    arm.scale.set(0.018, 0.018, 0.24);
    arm.position.set(0.19, 1.2, 0.02);
    arm.rotation.y = 0.35;

    const pipe = new THREE.Mesh(pipeGeo, brassMat);
    pipe.scale.y = 0.3;
    pipe.position.set(-0.18, 1.33, -0.18);
    const horn = new THREE.Mesh(hornGeo, brassMat);
    horn.rotation.x = (-3 * Math.PI) / 4;
    horn.position.set(-0.18, 1.62, -0.0);

    this.hit = new THREE.Mesh(unitBox, hitMat);
    this.hit.scale.set(0.9, 1.9, 0.9);
    this.hit.position.y = 0.95;
    this.hit.userData.exhibit = this;

    this.bars = new THREE.InstancedMesh(unitBox, new THREE.MeshBasicMaterial({ color: this.color, toneMapped: false }), BARS);
    this.levels = new Float32Array(BARS);
    this.updateBars();
    this.ownMaterials = [label.material, mark.material, this.bars.material];

    this.makeGlow({ halo: false, floorY: 0, poolZ: 0 });
    this.pool.scale.set(3.6, 3.6, 1);
    this.lightOffset.set(0, 1.9, 0.6);
    this.plaque.position.set(0, 0.74, 0.352);
    this.plaque.scale.set(0.6, 0.6 / PLAQUE_ASPECT, 1);
    this.group.add(pedestal, cap, base, this.disc, arm, pipe, horn, this.hit, this.bars);
  }

  get targets() { return [this.hit]; }

  dispose() {
    super.dispose();
    this.bars.dispose();
  }

  get playing() { return !!this.audio && !this.audio.paused; }

  extraInfo() {
    return this.duration ? `Duración ${formatDuration(this.duration)}` : '';
  }

  activate() {
    this.active = true;
    this.showPlaque();
    const a = new Audio();
    a.crossOrigin = 'anonymous';
    a.preload = 'metadata';
    a.addEventListener('loadedmetadata', () => {
      if (a !== this.audio) return;
      this.duration = a.duration;
      this.showPlaque();
    });
    a.addEventListener('error', () => { if (a === this.audio) this.failed = true; });
    a.src = this.item.url;
    this.audio = a;
  }

  /** Devuelve 'play' | 'pause' | 'error'. */
  toggle(listener) {
    if (!this.audio || this.failed) return 'error';
    if (!this.sound) {
      this.sound = new THREE.PositionalAudio(listener);
      this.sound.setMediaElementSource(this.audio);
      this.sound.setRefDistance(2.2);
      this.sound.setRolloffFactor(1.1);
      this.sound.position.set(-0.18, 1.7, 0.1);
      this.group.add(this.sound);
      this.analyser = this.sound.context.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.7;
      this.sound.source.connect(this.analyser);
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    }
    if (this.audio.paused) {
      this.audio.play().catch(() => { this.failed = true; });
      return 'play';
    }
    this.audio.pause();
    return 'pause';
  }

  update(dt) {
    const playing = this.playing;
    if (playing) this.disc.rotation.y -= dt * 3.5;
    let moving = false;
    if (playing && this.analyser) {
      this.analyser.getByteFrequencyData(this.freq);
      const half = BARS / 2;
      for (let i = 0; i < BARS; i++) {
        const k = i < half ? i : BARS - 1 - i;
        const bin = 1 + Math.floor((k / half) * (this.freq.length * 0.6));
        const target = this.freq[bin] / 255;
        this.levels[i] += (target - this.levels[i]) * Math.min(1, dt * 18);
      }
      moving = true;
    } else {
      for (let i = 0; i < BARS; i++) {
        if (this.levels[i] > 0.001) { this.levels[i] *= Math.exp(-dt * 6); moving = true; }
      }
    }
    if (moving) this.updateBars();
    // charco de luz del color del disco que late con la música
    let avg = 0;
    for (let i = 0; i < BARS; i++) avg += this.levels[i];
    avg /= BARS;
    this.glowColor.copy(this.color);
    this.glowLevel = playing ? 0.35 + Math.min(1, avg * 2) : this.active ? 0.08 : 0;
    this.applyGlow();
  }

  updateBars() {
    for (let i = 0; i < BARS; i++) {
      const ang = (i / BARS) * Math.PI * 2;
      const h = 0.02 + this.levels[i] * 0.9;
      dummy.position.set(Math.cos(ang) * BAR_RADIUS, h / 2, Math.sin(ang) * BAR_RADIUS);
      dummy.rotation.set(0, -ang, 0);
      dummy.scale.set(0.11, h, 0.05);
      dummy.updateMatrix();
      this.bars.setMatrixAt(i, dummy.matrix);
    }
    this.bars.instanceMatrix.needsUpdate = true;
  }

  deactivate() {
    this.active = false;
    this.hidePlaque();
    if (this.sound) {
      this.sound.disconnect();
      this.sound.gain.disconnect();
      this.sound.source.disconnect();
      this.sound.removeFromParent();
      this.sound = null;
      this.analyser = null;
    }
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio = null;
    }
    this.failed = false;
    this.levels.fill(0);
    this.updateBars();
    this.setGlow(BLACK, 0);
  }
}
