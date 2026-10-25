import {
  WALL_H, WALL_T, DOOR_W, DOOR_H, WALL_MARGIN, RISE, TREAD, FLOOR_H, HALL_W, MAIN_W, MAIN_H, OPEN_H,
} from './config.js';

/*
 * Arquitectura del museo como datos. Cada sala (y cada pasillo) se describe con:
 *   boxes     sólidos alineados a ejes (paredes, forjados, peldaños…), con material,
 *             si colisionan, si tapan la mira (ray) y si se puede caminar encima (walk)
 *   oboxes    piezas giradas solo decorativas (pasamanos y vidrios inclinados)
 *   ramps     superficies inclinadas por las que se camina (escaleras)
 *   colliders cajas invisibles (barandillas, columnas)
 *   lines     tramos de pared donde se cuelgan obras, con su altura de suelo
 * Coordenadas locales de sala: x ∈ [0, W], z ∈ [0, D], puerta en z = 0, suelo del
 * pasillo en y = 0.
 */

const T = WALL_T;
const M = WALL_MARGIN;
const F = T / 2 + 0.01; // de la línea central de la pared a su cara

// materiales por cara: +x −x +y −y +z −z
const FRONT = ['wall', 'wall', 'wall', 'wall', 'wall', 'hallWall'];
const SLAB = ['trim', 'trim', 'floor', 'ceiling', 'trim', 'trim'];
const LANDING = ['stone', 'stone', 'floor', 'stone', 'stone', 'stone'];

export class Spec {
  constructor(type, W, D, H) {
    Object.assign(this, {
      type, W, D, H,
      boxes: [], oboxes: [], ramps: [], colliders: [], lines: [], lights: [], columns: [],
      levels: [{ y: 0, name: '' }], pedArea: null, entry: { x: W / 2, z: 2.2, y: 0 }, label: '',
    });
  }

  box(x0, x1, y0, y1, z0, z1, mat, { collide = false, ray = false, walk = false } = {}) {
    if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3 || z1 - z0 < 1e-3) return;
    this.boxes.push({ x0, x1, y0, y1, z0, z1, mat, collide, ray, walk });
  }

  wall(x0, x1, y0, y1, z0, z1, mat = 'wall') {
    this.box(x0, x1, y0, y1, z0, z1, mat, { collide: true, ray: true });
  }

  floor(x0, x1, z0, z1, y, mat = 'floor', th = 0.3) {
    this.box(x0, x1, y - th, y, z0, z1, mat, { walk: true, ray: true });
  }

  collider(x0, x1, y0, y1, z0, z1) {
    this.colliders.push({ x0, x1, y0, y1, z0, z1 });
  }

  /** Barandilla de vidrio con pasamanos a lo largo de x (en z fijo). */
  railX(x0, x1, z, y) {
    if (x1 - x0 < 0.05) return;
    this.box(x0, x1, y, y + 0.98, z - 0.02, z + 0.02, 'glass');
    this.box(x0, x1, y + 0.98, y + 1.05, z - 0.04, z + 0.04, 'metal');
    this.collider(x0, x1, y, y + 1.05, z - 0.06, z + 0.06);
  }

  /** Barandilla de vidrio a lo largo de z (en x fijo). */
  railZ(z0, z1, x, y) {
    if (z1 - z0 < 0.05) return;
    this.box(x - 0.02, x + 0.02, y, y + 0.98, z0, z1, 'glass');
    this.box(x - 0.04, x + 0.04, y + 0.98, y + 1.05, z0, z1, 'metal');
    this.collider(x - 0.06, x + 0.06, y, y + 1.05, z0, z1);
  }

  column(x, z, y0, y1, r = 0.22) {
    this.columns.push({ x, z, y0, y1, r });
    this.box(x - r - 0.08, x + r + 0.08, y0, y0 + 0.25, z - r - 0.08, z + r + 0.08, 'stone');
    this.box(x - r - 0.06, x + r + 0.06, y1 - 0.2, y1, z - r - 0.06, z + r + 0.06, 'stone');
    this.collider(x - r, x + r, y0, y1, z - r, z + r);
  }

  /** Línea de pared para obras. kind: nz (mira a +z), mz (−z), px (+x), mx (−x). */
  line(kind, fixed, from, to, y) {
    if (to - from >= 1.5) this.lines.push({ kind, fixed, from, to, y });
  }

  light(x0, x1, z0, z1, y, step = 4.5) {
    this.lights.push({ x0, x1, z0, z1, y, step });
  }

  skylight(x0, x1, z0, z1, y) {
    if (x1 - x0 > 1 && z1 - z0 > 1) this.lights.push({ x0, x1, z0, z1, y, big: true });
  }

  /**
   * Tramo de escalera recto. axis: eje del recorrido; [a0, a1] a lo largo de ese eje,
   * [b0, b1] el ancho; dir +1 si sube hacia a1, −1 si sube hacia a0.
   * solid: peldaños macizos hasta yLow (escalera de obra) o finos (escalera volada).
   * rail: lados ('b0' | 'b1') que llevan barandilla.
   */
  stairs({ axis, a0, a1, b0, b1, yLow, yHigh, dir, solid = false, rail = [], mat = 'stone', collide = solid }) {
    const n = Math.max(1, Math.round((yHigh - yLow) / RISE));
    const run = a1 - a0, tread = run / n, rise = (yHigh - yLow) / n;
    for (let i = 0; i < n; i++) {
      const s = dir > 0 ? a0 + i * tread : a1 - (i + 1) * tread;
      const top = yLow + (i + 1) * rise;
      const bottom = solid ? yLow : top - 0.28;
      if (axis === 'x') this.box(s, s + tread, bottom, top, b0, b1, mat, { collide, ray: true });
      else this.box(b0, b1, bottom, top, s, s + tread, mat, { collide, ray: true });
    }
    const ya = dir > 0 ? yLow : yHigh, yb = dir > 0 ? yHigh : yLow;
    if (axis === 'x') this.ramps.push({ x0: a0, x1: a1, z0: b0, z1: b1, axis, ya, yb });
    else this.ramps.push({ x0: b0, x1: b1, z0: a0, z1: a1, axis, ya, yb });

    const len = Math.hypot(run, yHigh - yLow);
    const slope = Math.atan2(yHigh - yLow, run) * (dir > 0 ? 1 : -1);
    const mid = (a0 + a1) / 2, yMid = (yLow + yHigh) / 2;
    for (const side of rail) {
      const b = side === 'b0' ? b0 : b1;
      // pieza inclinada visual (vidrio + pasamanos)
      const rot = axis === 'x' ? [0, 0, slope] : [-slope, 0, 0];
      const size = (h, t) => (axis === 'x' ? [len, h, t] : [t, h, len]);
      const at = (y) => (axis === 'x' ? [mid, y, b] : [b, y, mid]);
      this.oboxes.push({ c: at(yMid + 0.5), s: size(0.96, 0.04), r: rot, mat: 'glass' });
      this.oboxes.push({ c: at(yMid + 1.02), s: size(0.07, 0.08), r: rot, mat: 'metal' });
      // colisión escalonada siguiendo la pendiente
      for (let i = 0; i < n; i += 2) {
        const s = dir > 0 ? a0 + i * tread : a1 - (i + 2) * tread;
        const lo = yLow + i * rise, hi = yLow + Math.min(n, i + 2) * rise + 1.05;
        if (axis === 'x') this.collider(s, s + 2 * tread, lo, hi, b - 0.06, b + 0.06);
        else this.collider(b - 0.06, b + 0.06, lo, hi, s, s + 2 * tread);
      }
    }
  }
}

// ---------------------------------------------------------------- piezas comunes

function shell(s, yb, H) {
  const { W, D } = s;
  const dl = W / 2 - DOOR_W / 2, dr = W / 2 + DOOR_W / 2;
  s.wall(-T / 2, W + T / 2, yb, H, D - T / 2, D + T / 2);
  s.wall(-T / 2, T / 2, yb, H, T / 2, D - T / 2);
  s.wall(W - T / 2, W + T / 2, yb, H, T / 2, D - T / 2);
  if (yb < 0) s.wall(-T / 2, W + T / 2, yb, 0, -T / 2, T / 2);
  s.wall(-T / 2, dl, 0, H, -T / 2, T / 2, FRONT);
  s.wall(dr, W + T / 2, 0, H, -T / 2, T / 2, FRONT);
  s.box(dl, dr, DOOR_H, H, -T / 2, T / 2, FRONT, { ray: true });
  const fw = 0.12, fd = T / 2 + 0.04;
  s.box(dl - fw, dl, 0, DOOR_H + fw, -fd, fd, 'trim');
  s.box(dr, dr + fw, 0, DOOR_H + fw, -fd, fd, 'trim');
  s.box(dl, dr, DOOR_H, DOOR_H + fw, -fd, fd, 'trim');
  s.box(0, W, H, H + 0.12, 0, D, 'ceiling');
}

function baseboards(s, y, { back = [0, s.W], left = [0, s.D], right = [0, s.D], front = 'door' } = {}) {
  const bh = 0.14, bt = 0.025, i = T / 2, { W, D } = s;
  const cx = (r) => [Math.max(i, r[0]), Math.min(W - i, r[1])];
  const cz = (r) => [Math.max(i, r[0]), Math.min(D - i, r[1])];
  if (back) { const [a, b] = cx(back); s.box(a, b, y, y + bh, D - i - bt, D - i, 'trim'); }
  if (left) { const [a, b] = cz(left); s.box(i, i + bt, y, y + bh, a, b, 'trim'); }
  if (right) { const [a, b] = cz(right); s.box(W - i - bt, W - i, y, y + bh, a, b, 'trim'); }
  if (front === 'door') {
    s.box(i, W / 2 - DOOR_W / 2, y, y + bh, i, i + bt, 'trim');
    s.box(W / 2 + DOOR_W / 2, W - i, y, y + bh, i, i + bt, 'trim');
  } else if (front === 'full') s.box(i, W - i, y, y + bh, i, i + bt, 'trim');
}

const lineBack = (s, y, x0, x1) => s.line('mz', s.D - F, x0, x1, y);
const lineLeft = (s, y, z0, z1) => s.line('px', F, z0, z1, y);
const lineRight = (s, y, z0, z1) => s.line('mx', s.W - F, z0, z1, y);
const lineFront = (s, y, x0, x1) => s.line('nz', F, x0, x1, y);
function frontLines(s, y) {
  lineFront(s, y, M, s.W / 2 - DOOR_W / 2 - 0.5);
  lineFront(s, y, s.W / 2 + DOOR_W / 2 + 0.5, s.W - M);
}

function bench(s, x, z, y) {
  s.box(x - 1.2, x + 1.2, y + 0.42, y + 0.5, z - 0.28, z + 0.28, 'bench');
  for (const sx of [-1, 1]) s.box(x + sx - 0.04, x + sx + 0.04, y, y + 0.42, z - 0.24, z + 0.24, 'leg');
  s.collider(x - 1.2, x + 1.2, y, y + 0.5, z - 0.28, z + 0.28);
}

// ---------------------------------------------------------------- tipos de sala

/** Sala rectangular clásica. */
function classic(W, D, o) {
  if (W < 10 || D < 10) return null;
  const s = new Spec('classic', W, D, WALL_H);
  s.label = 'Sala clásica';
  shell(s, 0, s.H);
  s.floor(0, W, 0, D, 0);
  baseboards(s, 0);
  lineBack(s, 0, M, W - M);
  lineLeft(s, 0, M, D - M);
  frontLines(s, 0);
  lineRight(s, 0, M, D - M);
  s.light(1.5, W - 1.5, 1.5, D - 1.5, s.H - 0.01);
  s.pedArea = { x0: 3, x1: W - 3, z0: 4, z1: D - 3, y: 0 };
  if (!o.audio) bench(s, W / 2, D / 2, 0);
  return s;
}

/** Sala hundida: rellano a la altura del pasillo y escalera hasta un foso. */
function sunken(W, D, o) {
  if (W < 10 || D < 13) return null;
  const P = -1.6, LD = 2.6;
  const s = new Spec('sunken', W, D, WALL_H);
  s.label = 'Sala hundida';
  shell(s, P, s.H);
  s.box(0, W, P, 0, 0, LD, LANDING, { walk: true, ray: true, collide: true });
  const sw = 3.2, sx0 = W / 2 - sw / 2, sx1 = W / 2 + sw / 2;
  const run = Math.round(-P / RISE) * TREAD;
  s.stairs({ axis: 'z', a0: LD, a1: LD + run, b0: sx0, b1: sx1, yLow: P, yHigh: 0, dir: -1, solid: true, rail: ['b0', 'b1'] });
  s.floor(0, W, LD, D, P);
  s.railX(T / 2, sx0, LD - 0.06, 0);
  s.railX(sx1, W - T / 2, LD - 0.06, 0);
  baseboards(s, P, { left: [LD, D], right: [LD, D], front: null });
  lineBack(s, P, M, W - M);
  lineLeft(s, P, LD + 0.8, D - M);
  frontLines(s, 0);
  lineRight(s, P, LD + 0.8, D - M);
  s.light(1.5, W - 1.5, 1.5, D - 1.5, s.H - 0.01);
  s.pedArea = { x0: 3, x1: W - 3, z0: LD + run + 1.4, z1: D - 3, y: P };
  s.entry = { x: W / 2, z: 1.3, y: 0 };
  s.levels = [{ y: P, name: 'Nivel inferior' }, { y: -0.01, name: 'Rellano' }];
  if (!o.audio) bench(s, W / 2, (LD + run + D) / 2 + 0.5, P);
  return s;
}

/** Doble altura con balcón en U (entreplanta) y escalera de obra junto a la pared. */
function mezzanine(W, D, o) {
  if (W < 14 || D < 16) return null;
  const U = WALL_H, H = 2 * WALL_H, BD = 2.8;
  const s = new Spec('mezzanine', W, D, H);
  s.label = 'Doble altura';
  shell(s, 0, H);
  s.floor(0, W, 0, D, 0);
  const run = Math.round(U / RISE) * TREAD;
  const z0 = 1.6, zb = z0 + run;
  if (zb > D - BD - 1.5) return null;
  const sx0 = T / 2, sx1 = T / 2 + 1.5;
  s.stairs({ axis: 'z', a0: z0, a1: zb, b0: sx0, b1: sx1, yLow: 0, yHigh: U, dir: 1, solid: true, rail: ['b1'] });
  baseboards(s, 0, { left: [zb, D] });

  const slab = { walk: true, ray: true };
  s.box(0, W, U - 0.3, U, D - BD, D, SLAB, slab);
  s.box(0, BD, U - 0.3, U, zb, D - BD, SLAB, slab);
  s.box(W - BD, W, U - 0.3, U, zb, D - BD, SLAB, slab);
  s.railZ(zb, D - BD, BD, U);
  s.railX(BD, W - BD, D - BD, U);
  s.railZ(zb, D - BD, W - BD, U);
  s.railX(sx1, BD, zb, U);
  s.railX(W - BD, W - T / 2, zb, U);
  baseboards(s, U, { left: [zb, D], right: [zb, D], front: null });

  // columnas bajo el borde del balcón
  const cy1 = U - 0.3;
  s.column(BD, zb + 0.3, 0, cy1);
  s.column(W - BD, zb + 0.3, 0, cy1);
  const nb = Math.max(2, Math.round((W - 2 * BD) / 5) + 1);
  for (let i = 0; i < nb; i++) s.column(BD + ((W - 2 * BD) * i) / (nb - 1), D - BD, 0, cy1);

  lineBack(s, 0, M, W - M);
  lineLeft(s, 0, zb + 0.6, D - M);
  frontLines(s, 0);
  lineRight(s, 0, M, D - M);
  lineBack(s, U, M, W - M);
  lineLeft(s, U, zb + 0.6, D - M);
  lineRight(s, U, zb + 0.6, D - M);

  s.light(BD + 1, W - BD - 1, 1.5, D - BD - 1, H - 0.01, 5);
  s.skylight(BD + 2, W - BD - 2, 3, D - BD - 2.5, H - 0.02);
  s.light(1.5, W - 1.5, D - BD / 2, D - BD / 2, U - 0.31, 4);
  s.light(BD / 2, BD / 2, zb + 1, D - BD - 1, U - 0.31, 4);
  s.light(W - BD / 2, W - BD / 2, zb + 1, D - BD - 1, U - 0.31, 4);
  s.pedArea = { x0: BD + 2.2, x1: W - BD - 2.2, z0: 4, z1: D - BD - 2.2, y: 0 };
  s.levels = [{ y: 0, name: 'Planta baja' }, { y: U - 0.01, name: 'Entreplanta' }];
  if (!o.audio) bench(s, W / 2, (D - BD) / 2 + 1, 0);
  return s;
}

/** Torre de varios pisos con escalera de ida y vuelta (dos tramos y descansillo). */
function tower(W, D, o) {
  const n = o.floors;
  if (W < 14 || D < 12) return null;
  const FH = FLOOR_H, H = n * FH, half = FH / 2;
  const L = Math.round(half / RISE) * TREAD;
  const zA0 = D - 1.7, zA1 = D - T / 2;   // tramo A (junto a la pared del fondo)
  const zB0 = D - 3.3, zB1 = D - 1.8;     // tramo B (lado de la sala)
  const xs = W - T / 2 - 1.5 - L, xl = xs + L;
  if (xs < 7) return null;

  const s = new Spec('tower', W, D, H);
  s.label = `Torre de ${n} pisos`;
  shell(s, 0, H);
  s.floor(0, W, 0, D, 0);
  s.wall(xs, xl, 0, H, zB1, zA0); // muro central de la escalera
  const slab = { walk: true, ray: true };
  s.levels = [];

  for (let k = 0; k < n; k++) {
    const y = k * FH;
    s.levels.push({ y: y - 0.01, name: k === 0 ? 'Planta baja' : `Piso ${k}` });
    if (k > 0) {
      // forjado con hueco sobre el tramo B que llega desde abajo
      s.box(0, W, y - 0.3, y, 0, zB0, SLAB, slab);
      s.box(0, xs, y - 0.3, y, zB0, D, SLAB, slab);
      s.box(xl, W, y - 0.3, y, zB0, D, SLAB, slab);
      s.box(xs, xl, y - 0.3, y, zB1, D, SLAB, slab);
      s.railX(xs, xl, zB0, y);
      s.railZ(zB0, zB1, xl, y);
      baseboards(s, y, { back: [0, xs], right: [0, zB0], front: 'full' });
      lineFront(s, y, M, W - M);
    } else {
      baseboards(s, 0, { back: [0, xs], right: [0, zB0] });
      frontLines(s, 0);
    }
    lineBack(s, y, M, xs - 0.6);
    lineLeft(s, y, M, D - M);
    lineRight(s, y, M, zB0 - 0.4);
    if (k < n - 1) {
      s.stairs({ axis: 'x', a0: xs, a1: xl, b0: zA0, b1: zA1, yLow: y, yHigh: y + half, dir: 1 });
      s.box(xl, W - T / 2, y + half - 0.3, y + half, zB0, D - T / 2, SLAB, slab);
      s.railX(xl, W - T / 2, zB0, y + half);
      s.stairs({ axis: 'x', a0: xs, a1: xl, b0: zB0, b1: zB1, yLow: y + half, yHigh: y + FH, dir: -1, rail: ['b0'] });
      s.light(1.5, xs - 1, 1.5, zB0 - 1, y + FH - 0.31);
    } else {
      s.light(1.5, W - 1.5, 1.5, D - 1.5, H - 0.01);
    }
  }
  s.pedArea = { x0: 3, x1: xs - 1.5, z0: 4, z1: zB0 - 1.5, y: 0 };
  if (!o.audio) bench(s, (xs - 1) / 2 + 0.5, zB0 / 2 + 1, 0);
  return s;
}

/** Sala alta con tarima central y paneles exentos de doble cara. */
function panels(W, D, o) {
  if (W < 14 || D < 14 || o.audio) return null;
  const H = 5.4;
  const s = new Spec('panels', W, D, H);
  s.label = 'Sala de paneles';
  shell(s, 0, H);
  s.floor(0, W, 0, D, 0);
  baseboards(s, 0);
  const x0 = 2.8, x1 = W - 2.8, z0 = 4.2, z1 = D - 2.8;
  s.box(x0, x1, 0, 0.2, z0, z1, 'stone', { walk: true, ray: true });
  s.box(x0 + 0.45, x1 - 0.45, 0, 0.4, z0 + 0.45, z1 - 0.45, 'stone', { walk: true, ray: true });
  const y = 0.4;
  const pz0 = z0 + 0.45 + 1.8, pz1 = z1 - 0.45 - 1.8;
  const rows = Math.max(1, Math.floor((pz1 - pz0) / 4.2) + 1);
  const ix0 = x0 + 1.45, ix1 = x1 - 1.45, width = ix1 - ix0;
  const per = width > 14 ? 2 : 1;
  const len = Math.min(9, per === 2 ? (width - 2.4) / 2 : width);
  for (let r = 0; r < rows; r++) {
    const zc = rows === 1 ? (pz0 + pz1) / 2 : pz0 + (r * (pz1 - pz0)) / (rows - 1);
    for (let p = 0; p < per; p++) {
      const cx = per === 1 ? W / 2 : W / 2 + (p === 0 ? -1 : 1) * (len / 2 + 1.2);
      const px0 = cx - len / 2, px1 = cx + len / 2;
      s.wall(px0, px1, y, y + 3.4, zc - 0.14, zc + 0.14, 'panel');
      s.box(px0 - 0.05, px1 + 0.05, y + 3.4, y + 3.5, zc - 0.18, zc + 0.18, 'trim');
      s.line('nz', zc + 0.15, px0 + 0.4, px1 - 0.4, y);
      s.line('mz', zc - 0.15, px0 + 0.4, px1 - 0.4, y);
    }
  }
  lineBack(s, 0, M, W - M);
  lineLeft(s, 0, M, D - M);
  frontLines(s, 0);
  lineRight(s, 0, M, D - M);
  s.light(1.5, W - 1.5, 1.5, D - 1.5, H - 0.01, 5);
  s.skylight(x0 + 1, x1 - 1, z0 + 1, z1 - 1, H - 0.02);
  return s;
}

export const ARCHETYPES = {
  classic,
  sunken,
  mezzanine,
  panels,
  tower2: (W, D, o) => tower(W, D, { ...o, floors: 2 }),
  tower3: (W, D, o) => tower(W, D, { ...o, floors: 3 }),
};

// ---------------------------------------------------------------- pasillos

/**
 * Pasillo de un ala en coordenadas locales (x de 0 a length, z ∈ ±HALL_W/2), con
 * tramos a distintas alturas unidos por escaleras de ancho completo.
 */
export function wingSpec(w) {
  const hw = HALL_W / 2, H = WALL_H, L = w.length;
  const s = new Spec('wing', L, HALL_W, H);
  for (const seg of w.segments) {
    s.box(seg.x0, seg.x1, seg.level - 0.3, seg.level, -hw, hw, 'hallFloor', { walk: true, ray: true });
    s.box(seg.x0 + 0.4, seg.x1 - 0.4, seg.level, seg.level + 0.008, -1.1, 1.1, 'rug');
    s.box(seg.x0, seg.x1, seg.level + H, seg.level + H + 0.12, -hw, hw, 'ceiling');
    s.light(seg.x0 + 2, seg.x1 - 2, 0, 0, seg.level + H - 0.01, 5);
  }
  for (const st of w.stairs) {
    const lo = Math.min(st.from, st.to), hi = Math.max(st.from, st.to);
    s.stairs({
      axis: 'x', a0: st.x0, a1: st.x1, b0: -hw + T / 2, b1: hw - T / 2,
      yLow: lo, yHigh: hi, dir: st.to > st.from ? 1 : -1, solid: true, collide: false, mat: 'hallFloor',
    });
    s.box(st.x0, st.x1, hi + H, hi + H + 0.12, -hw, hw, 'ceiling');
    // frentes del techo donde cambia de altura
    s.box(st.x0 - 0.1, st.x0 + 0.1, Math.min(st.from, hi) + H, hi + H, -hw, hw, 'ceiling');
    s.box(st.x1 - 0.1, st.x1 + 0.1, Math.min(st.to, hi) + H, hi + H, -hw, hw, 'ceiling');
  }
  // tramos de pared sin puerta: su altura depende del tramo de pasillo que tocan
  const zones = [
    ...w.segments.map((g) => ({ x0: g.x0, x1: g.x1, y0: g.level, y1: g.level + H })),
    ...w.stairs.map((g) => ({ x0: g.x0, x1: g.x1, y0: Math.min(g.from, g.to), y1: Math.max(g.from, g.to) + H })),
  ];
  for (const gap of w.gaps) {
    for (const zn of zones) {
      const a = Math.max(gap.x0, zn.x0), b = Math.min(gap.x1, zn.x1);
      if (b > a) s.wall(a, b, zn.y0 - 0.3, zn.y1, gap.z - T / 2, gap.z + T / 2, 'hallWall');
    }
  }
  const end = w.segments.at(-1).level;
  s.wall(L, L + T, end - 0.3, end + H, -hw - T / 2, hw + T / 2, 'hallWall');
  return s;
}

/** Galería principal: alta, con columnata y lucernario, de la que salen las alas. */
/** Cabina del ascensor del vestíbulo, detrás de la pared de entrada (coordenadas de mundo). */
export const ELEVATOR = { x0: -1.5, x1: 1.5, depth: 3.2, doorW: 2.2, doorH: 3.0, h: 3.3 };

export function mainSpec(wings, zs, ze, { elevator = false } = {}) {
  const mw = MAIN_W / 2, H = MAIN_H, hw = HALL_W / 2;
  const s = new Spec('main', MAIN_W, ze - zs, H);
  s.box(-mw, mw, -0.3, 0, zs, ze, 'hallFloor', { walk: true, ray: true });
  s.box(-1.3, 1.3, 0, 0.008, zs + 1.5, ze - 1.5, 'rug');
  s.box(-mw, mw, H, H + 0.12, zs, ze, 'ceiling');
  s.skylight(-1.6, 1.6, zs + 2, ze - 2, H - 0.02);
  s.light(-mw + 2.4, -mw + 2.4, zs + 3, ze - 3, H - 0.01, 6);
  s.light(mw - 2.4, mw - 2.4, zs + 3, ze - 3, H - 0.01, 6);

  for (const [side, x] of [['E', mw], ['O', -mw]]) {
    const openings = wings.filter((w) => w.side === side).map((w) => [w.z - hw, w.z + hw]);
    let z = zs;
    for (const [a, b] of [...openings, [ze, ze]]) {
      if (a > z) s.wall(x - T / 2, x + T / 2, -0.3, H, z, a, 'hallWall');
      if (b > a) s.box(x - T / 2, x + T / 2, OPEN_H, H, a, b, 'hallWall', { ray: true });
      z = Math.max(z, b);
    }
    // columnata, sin tapar las entradas a las alas
    const cx = x - Math.sign(x) * 1.1;
    for (let cz = zs + 4; cz < ze - 3; cz += 6) {
      if (openings.some(([a, b]) => cz > a - 1 && cz < b + 1)) continue;
      s.column(cx, cz, 0, H, 0.32);
    }
  }
  if (elevator) {
    // pared de entrada con la puerta del ascensor y la cabina detrás
    const E = ELEVATOR, dw = E.doorW / 2, zc = zs - T - E.depth;
    s.wall(-mw - T / 2, -dw, -0.3, H, zs - T, zs, 'hallWall');
    s.wall(dw, mw + T / 2, -0.3, H, zs - T, zs, 'hallWall');
    s.box(-dw, dw, E.doorH, H, zs - T, zs, 'hallWall', { ray: true });
    s.box(-dw - 0.1, -dw, 0, E.doorH + 0.1, zs - T - 0.03, zs + 0.03, 'metal');
    s.box(dw, dw + 0.1, 0, E.doorH + 0.1, zs - T - 0.03, zs + 0.03, 'metal');
    s.box(-dw, dw, E.doorH, E.doorH + 0.1, zs - T - 0.03, zs + 0.03, 'metal');
    s.box(E.x0, E.x1, -0.3, 0, zc, zs - T, 'stone', { walk: true, ray: true });
    s.wall(E.x0 - T, E.x0, -0.3, E.h, zc - T, zs - T, 'metal');
    s.wall(E.x1, E.x1 + T, -0.3, E.h, zc - T, zs - T, 'metal');
    s.wall(E.x0 - T, E.x1 + T, -0.3, E.h, zc - T, zc, 'metal');
    s.box(E.x0 - T, E.x1 + T, E.h, E.h + 0.15, zc - T, zs - T, 'metal', { ray: true });
    s.light((E.x0 + E.x1) / 2, (E.x0 + E.x1) / 2, (zc + zs - T) / 2, (zc + zs - T) / 2, E.h - 0.01, 1);
  } else {
    s.wall(-mw - T / 2, mw + T / 2, -0.3, H, zs - T, zs, 'hallWall');
  }
  s.wall(-mw - T / 2, mw + T / 2, -0.3, H, ze, ze + T, 'hallWall');
  return s;
}
