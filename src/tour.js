// Visita guiada: la cámara recorre las salas en orden, se detiene delante de cada obra el
// tiempo elegido en Ajustes y, si se quiere, reproduce videos y audios al pasar.
// Las paradas se calculan con los datos de la sala (no hace falta que esté construida).
import { apply } from './layout.js';
import { EYE_H, IMG, VID } from './config.js';
import { settings } from './settings.js';

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const lerp = (a, b, t) => a + (b - a) * t;
function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function lookAngles(eye, target) {
  const dx = target[0] - eye[0], dy = target[1] - eye[1], dz = target[2] - eye[2];
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** Paradas de una sala: entrada, cada obra de pared y cada gramófono. */
function roomStops(room) {
  const { t } = room;
  const s = t.flip ? -1 : 1;
  const [ex, ez] = apply(t, room.W / 2, 2.2);
  const [cx, cz] = apply(t, room.W / 2, room.D / 2);
  const stops = [{ kind: 'room', room, eye: [ex, room.entry.y + EYE_H, ez], look: [cx, room.entry.y + 1.6, cz] }];
  for (const p of room.placed) {
    const [wx, wz] = apply(t, p.x, p.z);
    const nx = Math.sin(p.rotY) * s, nz = Math.cos(p.rotY) * s; // normal de la pared, hacia la sala
    const video = p.item.type === 'video';
    const dist = video ? 3.6 : 2.4;
    const floorY = t.py + p.y - (video ? VID.y : IMG.y);
    stops.push({ kind: p.item.type, room, item: p.item, eye: [wx + nx * dist, floorY + EYE_H, wz + nz * dist], look: [wx, t.py + p.y, wz] });
  }
  room.pedestals.forEach((p, i) => {
    const [wx, wz] = apply(t, p.x, p.z);
    const fz = -s; // los gramófonos miran hacia la puerta (−z local)
    stops.push({ kind: 'audio', room, item: room.col.audio[i], eye: [wx, t.py + p.y + EYE_H, wz + fz * 2.3], look: [wx, t.py + p.y + 1.2, wz] });
  });
  return stops;
}

export class GuidedTour {
  /**
   * @param {{ museum, camera, listener, fade: (on: boolean) => void, onChange: (info) => void }} opts
   */
  constructor({ museum, camera, listener, fade, onChange }) {
    Object.assign(this, { museum, camera, listener, fade, onChange });
    this.running = false;
  }

  start(fromRoom) {
    const rooms = this.museum.rooms;
    if (!rooms.length) return;
    this.roomIndex = fromRoom ? rooms.indexOf(fromRoom) : 0;
    if (this.roomIndex < 0) this.roomIndex = 0;
    this.stops = roomStops(rooms[this.roomIndex]);
    this.stopIndex = 0;
    this.running = true;
    this.paused = false;
    this.goTo(0, { fade: true });
  }

  stop() {
    this.releaseMedia();
    this.running = false;
    this.fade(false);
  }

  get current() { return this.stops?.[this.stopIndex]; }

  info() {
    const s = this.current;
    const artworks = this.stops.length - 1;
    return {
      room: s.room,
      roomNumber: this.roomIndex + 1,
      roomCount: this.museum.rooms.length,
      stop: this.stopIndex,
      artworks,
      title: s.kind === 'room' ? s.room.title : s.item.name.replace(/\.[^.]+$/, ''),
      paused: this.paused,
    };
  }

  togglePause() {
    this.paused = !this.paused;
    this.onChange(this.info());
  }

  next() { this.step(1); }
  prev() { this.step(-1); }

  step(d) {
    let i = this.stopIndex + d;
    if (i >= this.stops.length) {
      // siguiente sala (vuelve a la primera al terminar el museo)
      this.roomIndex = (this.roomIndex + 1) % this.museum.rooms.length;
      this.stops = roomStops(this.museum.rooms[this.roomIndex]);
      i = 0;
    } else if (i < 0) {
      this.roomIndex = (this.roomIndex - 1 + this.museum.rooms.length) % this.museum.rooms.length;
      this.stops = roomStops(this.museum.rooms[this.roomIndex]);
      i = this.stops.length - 1;
    }
    this.goTo(i);
  }

  goTo(i, { fade = false } = {}) {
    this.releaseMedia();
    const prev = this.camera.position;
    this.stopIndex = i;
    const s = this.current;
    const dist = Math.hypot(s.eye[0] - prev.x, s.eye[2] - prev.z);
    const dy = Math.abs(s.eye[1] - prev.y);
    const from = { pos: [prev.x, prev.y, prev.z], yaw: this.camera.rotation.y, pitch: this.camera.rotation.x };
    const to = { pos: s.eye, ...lookAngles(s.eye, s.look) };
    // trayectos largos o con cambio de nivel: fundido a negro para no atravesar paredes ni forjados
    this.useFade = fade || dist > 9 || dy > 1.2;
    this.move = { from, to, t: 0, dur: this.useFade ? 0.9 : Math.min(3.2, Math.max(0.9, dist / 2.2)) };
    this.phase = 'move';
    this.dwell = s.kind === 'room' ? 2.2 : settings.tourSeconds;
    this.mediaStarted = false;
    if (this.useFade) this.fade(true);
    this.museum.poke();
    this.onChange(this.info());
  }

  /** Reproduce el video o audio de la parada (si está activado en Ajustes). */
  startMedia() {
    const s = this.current;
    if (!settings.tourPlayMedia || this.mediaStarted || (s.kind !== 'video' && s.kind !== 'audio')) return;
    const ex = s.room.exhibits?.find((e) => e.item === s.item);
    if (!ex) return; // la sala aún se está construyendo: se reintenta en el siguiente fotograma
    if (s.kind === 'video') {
      if (!ex.ready) return;
      if (!ex.soundOn) { ex.toggleSound(this.listener); this.media = ex; }
    } else if (!ex.playing) {
      ex.toggle(this.listener);
      this.media = ex;
    }
    this.mediaStarted = true;
  }

  releaseMedia() {
    const ex = this.media;
    this.media = null;
    if (!ex) return;
    if (ex.kind === 'video' && ex.soundOn) ex.toggleSound(this.listener);
    if (ex.kind === 'audio' && ex.playing) ex.toggle(this.listener);
  }

  update(dt) {
    if (!this.running) return;
    const cam = this.camera;
    cam.rotation.order = 'YXZ';
    if (this.phase === 'move') {
      const m = this.move;
      m.t = Math.min(1, m.t + dt / m.dur);
      if (this.useFade) {
        // a oscuras: salto al llegar a la mitad del fundido
        if (m.t >= 0.5 && !m.jumped) {
          m.jumped = true;
          cam.position.set(...m.to.pos);
          cam.rotation.set(m.to.pitch, m.to.yaw, 0);
          this.fade(false);
        }
      } else {
        const k = ease(m.t);
        cam.position.set(lerp(m.from.pos[0], m.to.pos[0], k), lerp(m.from.pos[1], m.to.pos[1], k), lerp(m.from.pos[2], m.to.pos[2], k));
        cam.rotation.set(lerp(m.from.pitch, m.to.pitch, k), angleLerp(m.from.yaw, m.to.yaw, k), 0);
      }
      if (m.t >= 1) this.phase = 'dwell';
      return;
    }
    // detenido delante de la obra
    this.startMedia();
    if (!this.paused) {
      this.dwell -= dt;
      if (this.dwell <= 0) this.next();
    }
  }
}
