import * as THREE from 'three';
import { WALL_T, DOOR_H, OPEN_H, STEP_UP, BUILD_BUDGET_MS, LOAD_CONCURRENCY } from './config.js';
import { settings, distances } from './settings.js';
import { layoutMuseum, apply, rectToWorld, yawToward } from './layout.js';
import { ARCHETYPES, wingSpec, mainSpec } from './architecture.js';
import { MeshBuilder } from './meshbuilder.js';
import { ImageExhibit, VideoExhibit, AudioExhibit } from './exhibits.js';
import {
  makeWoodTexture, makePlasterTexture, makeTileTexture, makeSignTexture, makeEntranceTexture,
} from './textures.js';
import { hashString, countsLabel, plural } from './util.js';

const unitPlane = new THREE.PlaneGeometry(1, 1);
const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 20);

// metros que abarca cada repetición de textura, por material
const TEX_SCALE = { floor: 2.4, hallFloor: 2, stone: 2.2, wall: 3, hallWall: 3, panel: 3, ceiling: 4 };

function distToRect(p, r) {
  const dx = Math.max(r.minX - p.x, 0, p.x - r.maxX);
  const dz = Math.max(r.minZ - p.z, 0, p.z - r.maxZ);
  return Math.hypot(dx, dz);
}

const inRect = (p, r) => p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ;

function boxToWorld(t, b) {
  const r = rectToWorld(t, b.x0, b.x1, b.z0, b.z1);
  r.minY = t.py + b.y0;
  r.maxY = t.py + b.y1;
  return r;
}

function grow(r, e) {
  r.minX -= e; r.maxX += e; r.minZ -= e; r.maxZ += e;
  return r;
}

function surfaceY(s, x, z) {
  if (s.axis === undefined) return s.y;
  const t = s.axis === 'x' ? (x - s.minX) / (s.maxX - s.minX) : (z - s.minZ) / (s.maxZ - s.minZ);
  return s.ya + (s.yb - s.ya) * Math.min(1, Math.max(0, t));
}

/** Rejilla espacial (xz) para cajas de colisión y superficies caminables. */
class Grid {
  constructor(cell = 16) {
    this.cell = cell;
    this.map = new Map();
    this.count = 0;
  }

  key(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); }

  add(b) {
    const c = this.cell;
    for (let cx = Math.floor(b.minX / c); cx <= Math.floor(b.maxX / c); cx++) {
      for (let cz = Math.floor(b.minZ / c); cz <= Math.floor(b.maxZ / c); cz++) {
        const k = this.key(cx, cz);
        let a = this.map.get(k);
        if (!a) this.map.set(k, (a = []));
        a.push(b);
      }
    }
    this.count++;
  }

  query(x, z, r, out) {
    out.length = 0;
    const c = this.cell;
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++) {
      for (let cz = Math.floor((z - r) / c); cz <= Math.floor((z + r) / c); cz++) {
        const a = this.map.get(this.key(cx, cz));
        if (a) for (const b of a) out.push(b);
      }
    }
    return out;
  }
}

const newRes = () => ({ geos: [], tex: [], mats: [], inst: [] });
function releaseRes(res) {
  for (const g of res.geos) g.dispose();
  for (const t of res.tex) t.dispose();
  for (const m of res.mats) m.dispose();
  for (const i of res.inst) i.dispose();
}

const nearbySurfaces = [];

export class Museum {
  /**
   * @param {THREE.Scene} scene
   * @param {object[]} collections salida de buildCollections
   * @param {string} rootName
   * @param {{ saveThumb?: Function, listener?: THREE.AudioListener }} opts
   */
  constructor(scene, collections, rootName, opts = {}) {
    this.scene = scene;
    this.rootName = rootName;
    this.ctx = { enqueue: (ex) => this.queue.add(ex), saveThumb: opts.saveThumb ?? null };
    this.listener = opts.listener ?? null;
    this.root = new THREE.Group();
    scene.add(this.root);

    this.colliders = new Grid();
    this.surfaces = new Grid();
    this.queue = new Set();
    this.loading = 0;
    this.timer = 0;
    this.lastPos = new THREE.Vector3();
    this.activeAudio = new Set();
    this.activeRooms = new Set();
    this.videoRooms = new Set();
    this.buildQueue = [];
    this.rayTargets = [];
    this.mainWalls = [];
    this.mainRes = newRes();
    this.dirty = true;
    this.dist = distances();
    this.stats = { videosReady: 0, videosPlaying: 0 };

    const tex = { wood: makeWoodTexture(), plaster: makePlasterTexture(), tile: makeTileTexture() };
    this.mainRes.tex.push(...Object.values(tex));
    this.plasterTex = tex.plaster;
    const std = (o) => new THREE.MeshStandardMaterial(o);
    this.mats = {
      floor: std({ map: tex.wood, roughness: 0.55, color: 0xd8c8b8 }),
      hallFloor: std({ map: tex.tile, roughness: 0.25 }),
      stone: std({ map: tex.plaster, color: 0xcfc6b6, roughness: 0.6 }),
      ceiling: std({ color: 0xf2efe9, emissive: 0x6b665e, roughness: 1 }),
      hallWall: std({ map: tex.plaster, color: 0x4b4540, roughness: 0.9 }),
      trim: std({ color: 0x241811, roughness: 0.5 }),
      rug: std({ color: 0x5a1717, roughness: 1 }),
      glass: std({
        color: 0xbfd8e6, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22,
        depthWrite: false, side: THREE.DoubleSide,
      }),
      metal: std({ color: 0x9a9284, roughness: 0.3, metalness: 0.9 }),
      column: std({ map: tex.plaster, color: 0xe7e1d6, roughness: 0.5 }),
      bench: std({ color: 0x3b2716, roughness: 0.45 }),
      leg: std({ color: 0x1a1a1a, roughness: 0.3, metalness: 0.8 }),
      light: new THREE.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false }),
      sky: new THREE.MeshBasicMaterial({ color: 0xe9f1ff, toneMapped: false }),
    };
    this.mainRes.mats.push(...Object.values(this.mats));
    this.applyAmbient();

    const lay = layoutMuseum(collections, rootName);
    this.main = { minX: -4.5, maxX: 4.5, minZ: lay.mainStart, maxZ: lay.mainEnd };

    const wingMap = new Map();
    this.wings = lay.wings.map((w) => {
      const d = this.prepareWing(w);
      wingMap.set(w, d);
      return d;
    });
    this.rooms = lay.rooms.map((r) => {
      const room = this.prepareRoom(r, wingMap.get(r.wing));
      room.wing.rooms.push(room);
      return room;
    });
    for (const r of lay.rooms) delete r.spec; // la geometría se regenera al construir
    for (const w of this.wings) {
      w.counts = { image: 0, video: 0, audio: 0 };
      for (const r of w.rooms) for (const k in w.counts) w.counts[k] += r.counts[k];
    }
    this.totals = { image: 0, video: 0, audio: 0 };
    for (const w of this.wings) for (const k in this.totals) this.totals[k] += w.counts[k];
    this.types = {};
    for (const r of this.rooms) this.types[r.typeLabel] = (this.types[r.typeLabel] ?? 0) + 1;

    this.buildMain(lay);
    this.spawn = { x: 0, y: 0, z: lay.mainStart + 3, yaw: Math.PI };
  }

  // ------------------------------------------------------------------ física (datos)

  registerPhysics(spec, t) {
    for (const b of spec.boxes) {
      if (b.collide) this.colliders.add(boxToWorld(t, b));
      if (b.walk) {
        const r = grow(boxToWorld(t, b), 0.03);
        r.y = r.maxY;
        this.surfaces.add(r);
      }
    }
    for (const c of spec.colliders) this.colliders.add(boxToWorld(t, c));
    for (const rp of spec.ramps) {
      const r = rectToWorld(t, rp.x0, rp.x1, rp.z0, rp.z1);
      const [ya, yb] = t.flip ? [rp.yb, rp.ya] : [rp.ya, rp.yb];
      this.surfaces.add({ ...grow(r, 0.03), axis: rp.axis, ya: ya + t.py, yb: yb + t.py });
    }
  }

  /** Altura del suelo bajo (x, z) alcanzable desde la altura de los pies. */
  groundAt(x, z, feet) {
    let best = -Infinity;
    for (const s of this.surfaces.query(x, z, 0, nearbySurfaces)) {
      if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
      const y = surfaceY(s, x, z);
      if (y <= feet + STEP_UP && y > best) best = y;
    }
    return best;
  }

  // ------------------------------------------------------------------ preparación

  prepareWing(w) {
    this.registerPhysics(wingSpec(w), w.t);
    const [ex, ez] = apply(w.t, 2.5, 0);
    return {
      kind: 'wing',
      title: w.title,
      side: w.side,
      t: w.t,
      layout: w,
      rooms: [],
      bounds: rectToWorld(w.t, 0, w.length, -3.5, 3.5),
      entry: { x: ex, y: 0, z: ez, yaw: yawToward(w.t, 1, 0) },
      built: false,
      walls: [],
    };
  }

  prepareRoom(r, wing) {
    const { W, D, col, t, spec } = r;
    this.registerPhysics(spec, t);
    for (const p of r.pedestals) {
      this.colliders.add(boxToWorld(t, { x0: p.x - 0.42, x1: p.x + 0.42, y0: p.y, y1: p.y + 1.9, z0: p.z - 0.42, z1: p.z + 0.42 }));
    }
    const hue = (hashString(col.path + col.title) % 360) / 360;
    const [ex, ez] = apply(t, spec.entry.x, spec.entry.z);
    const [dx, dz] = apply(t, W / 2, 0);
    return {
      kind: 'room',
      index: r.index,
      title: col.title,
      path: col.path,
      counts: col.counts,
      typeLabel: spec.label,
      levels: spec.levels,
      arch: r.arch,
      archOpts: r.o,
      col, W, D, t, wing, hue,
      side: r.side,
      placed: r.placed,
      pedestals: r.pedestals,
      color: `hsl(${Math.round(hue * 360)} 45% 62%)`,
      bounds: rectToWorld(t, 0, W, 0, D),
      door: { x: dx, z: dz },
      entry: { x: ex, y: t.py + spec.entry.y, z: ez, yaw: yawToward(t, 0, 1) },
      built: false,
      active: false,
      exhibits: [],
      walls: [],
    };
  }

  /** Nombre del nivel (piso, entreplanta…) en el que están los pies dentro de una sala. */
  levelName(room, feet) {
    if (!room || room.levels.length < 2) return '';
    const local = feet - room.t.py;
    let name = '';
    for (const l of room.levels) if (local >= l.y - 0.4) name = l.name;
    return name;
  }

  // ------------------------------------------------------------------ mallas

  groupFor(t) {
    const g = new THREE.Group();
    g.position.set(t.px, t.py, t.pz);
    g.rotation.y = t.flip ? Math.PI : 0;
    return g;
  }

  /** Construye las mallas de una Spec dentro de `group`; devuelve las que tapan la mira. */
  buildSpecMeshes(spec, group, res, matFor) {
    const mb = new MeshBuilder(TEX_SCALE);
    for (const b of spec.boxes) mb.addBox(b);
    for (const o of spec.oboxes) mb.addOriented(o);
    const ray = [];
    for (const { mesh, ray: r } of mb.build(matFor)) {
      group.add(mesh);
      res.geos.push(mesh.geometry);
      if (r) ray.push(mesh);
    }

    if (spec.columns.length) {
      const inst = new THREE.InstancedMesh(unitCylinder, this.mats.column, spec.columns.length);
      const m = new THREE.Matrix4();
      spec.columns.forEach((c, i) => {
        inst.setMatrixAt(i, m.makeScale(c.r, c.y1 - c.y0, c.r).setPosition(c.x, (c.y0 + c.y1) / 2, c.z));
      });
      inst.computeBoundingSphere();
      group.add(inst);
      res.inst.push(inst);
    }

    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    for (const big of [false, true]) {
      const mats = [];
      for (const l of spec.lights) {
        if (!!l.big !== big) continue;
        if (big) {
          mats.push(new THREE.Matrix4().compose(
            new THREE.Vector3((l.x0 + l.x1) / 2, l.y, (l.z0 + l.z1) / 2), q, new THREE.Vector3(l.x1 - l.x0, l.z1 - l.z0, 1)));
          continue;
        }
        const nx = Math.max(1, Math.round((l.x1 - l.x0) / l.step) + 1);
        const nz = Math.max(1, Math.round((l.z1 - l.z0) / l.step) + 1);
        for (let i = 0; i < nx; i++) {
          for (let j = 0; j < nz; j++) {
            const x = nx === 1 ? (l.x0 + l.x1) / 2 : l.x0 + ((l.x1 - l.x0) * i) / (nx - 1);
            const z = nz === 1 ? (l.z0 + l.z1) / 2 : l.z0 + ((l.z1 - l.z0) * j) / (nz - 1);
            mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, l.y, z), q, new THREE.Vector3(1.1, 1.1, 1)));
          }
        }
      }
      if (!mats.length) continue;
      const inst = new THREE.InstancedMesh(unitPlane, big ? this.mats.sky : this.mats.light, mats.length);
      mats.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.computeBoundingSphere();
      group.add(inst);
      res.inst.push(inst);
    }
    return ray;
  }

  addSign(parent, tex, w, h, x, y, z, rotY, res) {
    res.tex.push(tex);
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    res.mats.push(mat);
    const sign = new THREE.Mesh(unitPlane, mat);
    sign.scale.set(w, h, 1);
    sign.rotation.y = rotY;
    sign.position.set(x, y, z);
    parent.add(sign);
  }

  /** Galería principal: siempre construida (une todas las alas). */
  buildMain(lay) {
    const { mainStart: zs, mainEnd: ze } = lay;
    const spec = mainSpec(this.wings.map((w) => ({ side: w.side, z: w.t.pz })), zs, ze);
    this.registerPhysics(spec, { px: 0, py: 0, pz: 0, flip: false });
    const g = new THREE.Group();
    this.root.add(g);
    this.mainWalls = this.buildSpecMeshes(spec, g, this.mainRes, (k) => this.mats[k] ?? this.mats.hallWall);

    const nW = this.wings.length, nR = this.rooms.length;
    const types = Object.entries(this.types).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} ${k.toLowerCase()}`);
    this.addSign(g, makeEntranceTexture(this.rootName, [
      `${plural(nW, 'ala', 'alas')} · ${plural(nR, 'sala', 'salas')} · ${countsLabel(this.totals)}`,
      types.slice(0, 3).join(' · '),
      'Tab: directorio · M: mapa · E: interactuar',
    ]), 6, 3, 0, 3, zs + 0.02, 0, this.mainRes);
    this.addSign(g, makeEntranceTexture('Fin de la galería', ['Pulsa Tab para ir a cualquier sala']),
      4, 2, 0, 3, ze - 0.02, Math.PI, this.mainRes);
  }

  buildWing(w) {
    const g = this.groupFor(w.t);
    const res = newRes();
    w.walls = this.buildSpecMeshes(wingSpec(w.layout), g, res, (k) => this.mats[k] ?? this.mats.hallWall);
    this.addSign(g, makeSignTexture(w.title, `${plural(w.rooms.length, 'sala', 'salas')} · ${countsLabel(w.counts)}`),
      3.6, 0.9, -WALL_T / 2 - 0.03, OPEN_H + 0.55, 0, -Math.PI / 2, res);
    const end = w.layout.segments.at(-1).level;
    this.addSign(g, makeSignTexture(w.title, 'Fin del ala'), 2.8, 0.7, w.layout.length - 0.02, end + 2.6, 0, -Math.PI / 2, res);
    this.root.add(g);
    Object.assign(w, { group: g, res, built: true });
    this.dirty = true;
  }

  buildRoom(room) {
    const g = this.groupFor(room.t);
    const res = newRes();
    const spec = ARCHETYPES[room.arch](room.W, room.D, room.archOpts);
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.plasterTex, color: new THREE.Color().setHSL(room.hue, 0.22, 0.8), roughness: 0.92,
    });
    const panelMat = new THREE.MeshStandardMaterial({
      map: this.plasterTex, color: new THREE.Color().setHSL(room.hue, 0.3, 0.32), roughness: 0.85,
    });
    res.mats.push(wallMat, panelMat);
    const matFor = (k) => (k === 'wall' ? wallMat : k === 'panel' ? panelMat : this.mats[k] ?? wallMat);
    room.walls = this.buildSpecMeshes(spec, g, res, matFor);

    this.addSign(g, makeSignTexture(room.col.title, `${room.typeLabel} · ${countsLabel(room.col.counts)}`), 2.8, 0.7,
      room.W / 2, DOOR_H + 0.62, -WALL_T / 2 - 0.05, Math.PI, res);

    room.exhibits = [];
    for (const p of room.placed) {
      const ex = p.item.type === 'video' ? new VideoExhibit(p.item, room) : new ImageExhibit(p.item, room);
      ex.group.position.set(p.x, p.y, p.z);
      ex.group.rotation.y = p.rotY;
      g.add(ex.group);
      room.exhibits.push(ex);
    }
    room.pedestals.forEach((p, i) => {
      const ex = new AudioExhibit(room.col.audio[i], room);
      ex.group.position.set(p.x, p.y, p.z);
      ex.group.rotation.y = Math.PI; // mirando hacia la puerta
      g.add(ex.group);
      room.exhibits.push(ex);
    });

    this.root.add(g);
    g.updateMatrixWorld(true);
    for (const ex of room.exhibits) ex.updateWorldPos();
    Object.assign(room, { group: g, res, built: true });
    this.dirty = true;
  }

  destroyChunk(c) {
    if (!c.built) return;
    if (c.kind === 'room') {
      if (c.active) this.deactivateRoom(c);
      if (c.videosOn) this.setRoomVideos(c, false);
      for (const ex of c.exhibits) ex.dispose();
      c.exhibits = [];
    }
    c.group.removeFromParent();
    releaseRes(c.res);
    c.group = c.res = null;
    c.walls = [];
    c.built = false;
    this.dirty = true;
  }

  // Imágenes y audios se activan en un radio corto (texturas en GPU); los videos en uno
  // mayor para que las pantallas se vean reproduciendo desde lejos.
  activateRoom(r) {
    r.active = true;
    this.activeRooms.add(r);
    for (const ex of r.exhibits) {
      if (ex.kind === 'video') continue;
      ex.activate(this.ctx);
      if (ex.kind === 'audio') this.activeAudio.add(ex);
    }
    this.dirty = true;
  }

  deactivateRoom(r) {
    r.active = false;
    this.activeRooms.delete(r);
    for (const ex of r.exhibits) {
      if (ex.kind === 'video') continue;
      ex.deactivate();
      this.queue.delete(ex);
      this.activeAudio.delete(ex);
    }
    this.dirty = true;
  }

  setRoomVideos(r, on) {
    r.videosOn = on;
    if (on) this.videoRooms.add(r); else this.videoRooms.delete(r);
    for (const ex of r.exhibits) {
      if (ex.kind !== 'video') continue;
      if (on) ex.activate(this.ctx); else ex.deactivate();
    }
  }

  // ------------------------------------------------------------------ ejecución

  roomAt(p) {
    for (const r of this.rooms) if (inRect(p, r.bounds)) return r;
    return null;
  }

  wingAt(p) {
    for (const w of this.wings) if (inRect(p, w.bounds)) return w;
    return null;
  }

  /** Luz ambiental: techos y paneles de luz se apagan en el modo oscuro. */
  applyAmbient() {
    const a = settings.ambient / 100;
    this.mats.ceiling.emissive.setRGB(0.42, 0.4, 0.37).multiplyScalar(a);
    this.mats.ceiling.color.setScalar(0.12 + 0.83 * a);
    this.mats.light.color.set(0xfff1d6).multiplyScalar(0.03 + 0.97 * a);
    this.mats.sky.color.set(0xe9f1ff).multiplyScalar(0.02 + 0.98 * a);
  }

  /** Obras que pueden emitir luz ahora mismo (salas activas). */
  glowSources() {
    const out = [];
    for (const r of this.activeRooms) for (const ex of r.exhibits) if (ex.kind !== 'video') out.push(ex);
    for (const r of this.videoRooms) for (const ex of r.exhibits) if (ex.kind === 'video') out.push(ex);
    return out;
  }

  /** Reaplica la intensidad de brillo (al cambiar el ajuste). */
  refreshGlow() {
    for (const ex of this.glowSources()) ex.applyGlow();
  }

  /** Fuerza a recalcular qué construir (tras teletransportarse o cambiar ajustes). */
  poke() { this.timer = 0; }

  /** Recarga los cuadros cercanos (p. ej. al cambiar la resolución de texturas). */
  reloadImages() {
    for (const r of [...this.activeRooms]) {
      this.deactivateRoom(r);
      this.activateRoom(r);
    }
  }

  rebuildTargets() {
    const t = [...this.mainWalls];
    for (const w of this.wings) if (w.built) t.push(...w.walls);
    for (const r of this.activeRooms) {
      t.push(...r.walls);
      for (const ex of r.exhibits) t.push(...ex.targets);
    }
    this.rayTargets = t;
  }

  update(dt, pos) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.2;
      this.lastPos.copy(pos);
      this.updateChunks(pos);
      this.updateVideos(pos);
      this.pump();
    }
    this.processBuilds();
    if (this.dirty) { this.rebuildTargets(); this.dirty = false; }
    for (const ex of this.activeAudio) ex.update(dt);
    for (const r of this.videoRooms) for (const ex of r.exhibits) if (ex.kind === 'video') ex.updateGlow(dt);
  }

  updateChunks(pos) {
    const D = (this.dist = distances());
    const want = [];
    for (const w of this.wings) {
      const d = (w._d = distToRect(pos, w.bounds));
      if (!w.built && d < D.build) want.push(w);
      else if (w.built && d > D.destroy) this.destroyChunk(w);
    }
    for (const r of this.rooms) {
      const d = (r._d = distToRect(pos, r.bounds));
      if (!r.built) { if (d < D.build) want.push(r); continue; }
      if (d > D.destroy) { this.destroyChunk(r); continue; }
      if (!r.active && d < D.imageOn) this.activateRoom(r);
      else if (r.active && d > D.imageOff) this.deactivateRoom(r);
      if (!r.videosOn && d < D.videoOn) this.setRoomVideos(r, true);
      else if (r.videosOn && d > D.videoOff) this.setRoomVideos(r, false);
    }
    want.sort((a, b) => a._d - b._d);
    this.buildQueue = want;
  }

  /** Construye trozos pendientes sin pasar del presupuesto de tiempo por fotograma. */
  processBuilds() {
    const t0 = performance.now();
    while (this.buildQueue.length) {
      const c = this.buildQueue.shift();
      if (c.built) continue;
      if (c.kind === 'wing') this.buildWing(c);
      else {
        this.buildRoom(c);
        if (c._d < this.dist.imageOn) this.activateRoom(c);
        if (c._d < this.dist.videoOn) this.setRoomVideos(c, true);
      }
      if (performance.now() - t0 > BUILD_BUDGET_MS) break;
    }
  }

  updateVideos(pos) {
    const vids = [];
    for (const r of this.videoRooms) {
      for (const ex of r.exhibits) if (ex.kind === 'video' && ex.ready) vids.push(ex);
    }
    // los videos a los que el usuario activó el sonido tienen prioridad y alcance mayor
    const manual = (v) => v.soundOn && !v.autoSound;
    for (const v of vids) v._d = v.worldPos.distanceTo(pos);
    vids.sort((a, b) => (a._d - (manual(a) ? 1000 : 0)) - (b._d - (manual(b) ? 1000 : 0)));
    let playing = 0;
    vids.forEach((v, i) => {
      const limit = manual(v) ? this.dist.videoOff : settings.videoDist;
      const on = i < settings.maxVideos && v._d < limit && !v.held;
      v.setPlaying(on);
      if (on) playing++;
      // «Videos en silencio» desactivado: el sonido (posicional) se activa solo
      if (on && !settings.mutedVideos && !v.soundOn && this.listener) {
        v.toggleSound(this.listener);
        v.autoSound = true;
      } else if (v.autoSound && v.soundOn && (settings.mutedVideos || !on)) {
        v.toggleSound(this.listener);
        v.autoSound = false;
      }
    });
    this.stats = { videosReady: vids.length, videosPlaying: playing };
  }

  pump() {
    while (this.loading < LOAD_CONCURRENCY && this.queue.size) {
      let best = null, bd = Infinity;
      for (const ex of this.queue) {
        if (!ex.active) { this.queue.delete(ex); continue; }
        const d = ex.worldPos.distanceToSquared(this.lastPos);
        if (d < bd) { bd = d; best = ex; }
      }
      if (!best) break;
      this.queue.delete(best);
      this.loading++;
      best.load(this.ctx).finally(() => { this.loading--; this.pump(); });
    }
  }

  dispose() {
    for (const c of [...this.rooms, ...this.wings]) this.destroyChunk(c);
    this.scene.remove(this.root);
    releaseRes(this.mainRes);
  }
}
