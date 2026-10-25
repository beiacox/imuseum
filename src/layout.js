import {
  HALL_W, MAIN_W, MAIN_ENTRY, ROOM_GAP, MIN_ROOM, MAX_ROOM, IMG, VID, WALL_T,
  WING_START, WING_GAP, MAX_ROOMS_PER_WING, WING_OWN_MIN, HALL_LEVEL_STEP,
} from './config.js';
import { ARCHETYPES } from './architecture.js';
import { hashString, rng } from './util.js';
import { settings } from './settings.js';

/*
 * Jerarquía espacial:
 *   galería principal (eje Z) → alas a ambos lados (pasillos en eje X local, con
 *   tramos a distintas alturas) → salas de distintos tipos a ambos lados de cada ala.
 * Las transformaciones solo rotan 0 o π alrededor de Y, así que las cajas siguen
 * alineadas a los ejes en coordenadas de mundo.
 */

export const tf = (px, py, pz, flip) => ({ px, py, pz, flip });
export const apply = (t, x, z) => (t.flip ? [t.px - x, t.pz - z] : [t.px + x, t.pz + z]);
export function compose(parent, child) {
  const [px, pz] = apply(parent, child.px, child.pz);
  return tf(px, parent.py + child.py, pz, parent.flip !== child.flip);
}
export function rectToWorld(t, minX, maxX, minZ, maxZ) {
  const [ax, az] = apply(t, minX, minZ);
  const [bx, bz] = apply(t, maxX, maxZ);
  return { minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz) };
}
/** yaw de cámara para mirar hacia la dirección local (dx, dz). */
export function yawToward(t, dx, dz) {
  const s = t.flip ? -1 : 1;
  return Math.atan2(-dx * s, -dz * s);
}

// ---------------------------------------------------------------- sala

const ROT = { nz: 0, mz: Math.PI, px: Math.PI / 2, mx: -Math.PI / 2 };

/** Reparte las obras por las líneas de pared de la sala, en orden de lectura. */
function packLines(items, lines) {
  const ls = lines.map((l) => ({ ...l, len: l.to - l.from, items: [], used: 0 }));
  let li = 0;
  for (const it of items) {
    const slot = it.type === 'video' ? VID.slot : IMG.slot;
    while (li < ls.length && ls[li].used + slot > ls[li].len) li++;
    if (li >= ls.length) return null;
    ls[li].items.push({ it, slot });
    ls[li].used += slot;
  }
  const placed = [];
  for (const l of ls) {
    if (!l.items.length) continue;
    const gap = (l.len - l.used) / l.items.length;
    let u = gap / 2;
    for (const { it, slot } of l.items) {
      const c = u + slot / 2;
      // posición a lo largo de la línea según el sentido de lectura
      const along = l.kind === 'nz' || l.kind === 'mx' ? l.from + c : l.to - c;
      const [x, z] = l.kind === 'nz' || l.kind === 'mz' ? [along, l.fixed] : [l.fixed, along];
      placed.push({ item: it, x, z, y: l.y + (it.type === 'video' ? VID.y : IMG.y), rotY: ROT[l.kind] });
      u += slot + gap;
    }
  }
  return placed;
}

function pedestalGrid(n, area) {
  if (!n) return [];
  if (!area) return null;
  const sp = 3;
  const cols = Math.floor((area.x1 - area.x0) / sp) + 1;
  const rows = Math.floor((area.z1 - area.z0) / sp) + 1;
  if (area.x1 < area.x0 || area.z1 < area.z0 || cols * rows < n) return null;
  const useRows = Math.ceil(n / cols);
  const useCols = Math.ceil(n / useRows);
  const cx = (area.x0 + area.x1) / 2, cz = (area.z0 + area.z1) / 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / useCols), c = i % useCols;
    const inRow = r === useRows - 1 ? n - r * useCols : useCols;
    out.push({ x: cx + (c - (inRow - 1) / 2) * sp, z: cz + (r - (useRows - 1) / 2) * sp, y: area.y });
  }
  return out;
}

function tryArchetype(name, col) {
  const o = { audio: col.audio.length };
  let W = MIN_ROOM, D = MIN_ROOM;
  for (let i = 0; W <= MAX_ROOM; i++) {
    const spec = ARCHETYPES[name](W, D, o);
    if (spec) {
      const placed = packLines(col.wall, spec.lines);
      const pedestals = pedestalGrid(col.audio.length, spec.pedArea);
      if (placed && pedestals) return { arch: name, o, W, D, spec, placed, pedestals };
    }
    if (i % 2 === 0) W += 2; else D += 2;
  }
  return null;
}

/** Elige el tipo de sala según el contenido, con variedad entre salas parecidas. */
function layoutRoom(col) {
  const need = col.wall.reduce((s, it) => s + (it.type === 'video' ? VID.slot : IMG.slot), 0);
  const audio = col.audio.length > 0;
  // las opciones repetidas pesan más en el reparto
  let options;
  if (need <= 40) options = audio ? ['classic', 'sunken', 'classic', 'sunken'] : ['classic', 'sunken', 'panels', 'classic', 'sunken'];
  else if (need <= 95) options = audio ? ['mezzanine', 'sunken', 'mezzanine', 'tower2'] : ['mezzanine', 'panels', 'sunken', 'mezzanine', 'tower2'];
  else options = ['tower3', 'mezzanine', 'tower2', 'tower3'];
  // tipos desactivados en Ajustes → Arquitectura (la clásica siempre está disponible)
  const enabled = {
    classic: true,
    sunken: settings.roomSunken,
    panels: settings.roomPanels,
    mezzanine: settings.roomMezzanine,
    tower2: settings.roomTowers,
    tower3: settings.roomTowers,
  };
  options = options.filter((o) => enabled[o]);
  if (!options.length) options = ['classic'];
  const start = hashString(col.path + col.title) % options.length;
  const order = [...options.slice(start), ...options.slice(0, start), 'classic'];
  if (enabled.tower3) order.push('tower3');
  for (const name of order) {
    const r = tryArchetype(name, col);
    if (r) return { col, ...r };
  }
  throw new Error(`No cabe la sala ${col.title}`);
}

// ---------------------------------------------------------------- ala

/**
 * Salas alternadas a ambos lados de un pasillo local (x = 0 … length). Entre parejas
 * de salas el pasillo puede subir o bajar con una escalera de ancho completo.
 */
function layoutWing(spec, seed) {
  const rooms = spec.cols.map(layoutRoom);
  const rnd = rng(seed);
  const segments = [], stairs = [];
  let cursor = WING_START, maxN = 0, maxS = 0, level = 0, segStart = 0;

  for (let i = 0; i < rooms.length; i += 2) {
    if (i > 0 && rnd() < settings.hallSlopes / 100) {
      let next = level + (rnd() < 0.5 ? -1 : 1) * HALL_LEVEL_STEP;
      if (Math.abs(next) > 2 * HALL_LEVEL_STEP + 0.01) next = level - Math.sign(level) * HALL_LEVEL_STEP;
      const run = Math.round(Math.abs(next - level) / 0.15) * 0.32 + 0.4;
      segments.push({ x0: segStart, x1: cursor, level });
      stairs.push({ x0: cursor, x1: cursor + run, from: level, to: next });
      cursor += run;
      segStart = cursor;
      level = next;
    }
    const n = rooms[i], s = rooms[i + 1];
    Object.assign(n, { side: 'N', x0: cursor, local: tf(cursor + n.W, level, -HALL_W / 2, true) });
    maxN = Math.max(maxN, n.D);
    if (s) {
      Object.assign(s, { side: 'S', x0: cursor, local: tf(cursor, level, HALL_W / 2, false) });
      maxS = Math.max(maxS, s.D);
    }
    cursor += Math.max(n.W, s?.W ?? 0) + ROOM_GAP;
  }
  const length = cursor + 2.5;
  segments.push({ x0: segStart, x1: length, level });

  const gaps = [];
  for (const [side, z] of [['N', -HALL_W / 2], ['S', HALL_W / 2]]) {
    const covered = rooms.filter((r) => r.side === side).map((r) => [r.x0, r.x0 + r.W]);
    let x = 0;
    for (const [a, b] of [...covered, [length, length]]) {
      if (a > x) gaps.push({ x0: x, x1: a, z });
      x = Math.max(x, b);
    }
  }
  return {
    title: spec.title,
    rooms, length, gaps, segments, stairs,
    depthN: HALL_W / 2 + maxN + WALL_T,
    depthS: HALL_W / 2 + maxS + WALL_T,
  };
}

function groupIntoWings(collections, rootName) {
  const groups = [];
  for (const c of collections) {
    const last = groups.at(-1);
    if (last && last.top === c.top) last.cols.push(c);
    else groups.push({ top: c.top, cols: [c] });
  }
  const name = (g) => g.top || rootName;
  const wings = [];
  let pending = [], pendingRooms = 0;
  const flush = () => {
    if (!pending.length) return;
    const title = pending.length === 1 ? name(pending[0]) : `${name(pending[0])} – ${name(pending.at(-1))}`;
    wings.push({ title, cols: pending.flatMap((g) => g.cols) });
    pending = [];
    pendingRooms = 0;
  };
  for (const g of groups) {
    if (g.cols.length >= WING_OWN_MIN) {
      flush();
      const n = Math.ceil(g.cols.length / MAX_ROOMS_PER_WING);
      for (let i = 0; i < n; i++) {
        wings.push({
          title: n > 1 ? `${name(g)} (${i + 1}/${n})` : name(g),
          cols: g.cols.slice(i * MAX_ROOMS_PER_WING, (i + 1) * MAX_ROOMS_PER_WING),
        });
      }
    } else {
      if (pendingRooms + g.cols.length > MAX_ROOMS_PER_WING) flush();
      pending.push(g);
      pendingRooms += g.cols.length;
    }
  }
  flush();
  return wings;
}

// ---------------------------------------------------------------- museo

/** Separación vertical entre pisos de la galería (cabe una torre de 3 pisos sobre un pasillo elevado). */
export const GALLERY_FLOOR_H = 22;

/**
 * Las alas se reparten en pisos de la galería principal (Ajustes → Arquitectura → Alas por
 * piso). Todos los pisos comparten el vestíbulo, donde está el ascensor.
 */
export function layoutMuseum(collections, rootName) {
  const wings = groupIntoWings(collections, rootName).map((w, i) => layoutWing(w, hashString(w.title) + i));
  const perFloor = Math.max(2, settings.wingsPerFloor);
  const floors = [];
  for (let f = 0; f === 0 || f * perFloor < wings.length; f++) {
    const fw = wings.slice(f * perFloor, (f + 1) * perFloor);
    const py = f * GALLERY_FLOOR_H;
    let cursor = 0, lastZ = 0;
    for (let i = 0; i < fw.length; i += 2) {
      const e = fw[i], w = fw[i + 1];
      const before = Math.max(e.depthN, w ? w.depthS : 0);
      const after = Math.max(e.depthS, w ? w.depthN : 0);
      const z = cursor + before;
      Object.assign(e, { side: 'E', z, floor: f, t: tf(MAIN_W / 2, py, z, false) });
      if (w) Object.assign(w, { side: 'O', z, floor: f, t: tf(-MAIN_W / 2, py, z, true) });
      cursor = z + after + WING_GAP;
      lastZ = z;
    }
    floors.push({ index: f, y: py, wings: fw, mainStart: -MAIN_ENTRY, mainEnd: lastZ + HALL_W / 2 + 5 });
  }
  const rooms = [];
  for (const wing of wings) {
    for (const r of wing.rooms) {
      r.wing = wing;
      r.t = compose(wing.t, r.local);
      r.index = rooms.length;
      rooms.push(r);
    }
  }
  return { wings, rooms, floors };
}
