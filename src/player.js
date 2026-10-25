import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EYE_H, PLAYER_R, RUN_FACTOR, STEP_UP, HEAD } from './config.js';
import { settings } from './settings.js';

const fwd = new THREE.Vector3();
const target = new THREE.Vector3();
const nearby = [];
const GRAVITY = 22;

export class Player {
  constructor(camera, domElement) {
    this.camera = camera;
    this.controls = new PointerLockControls(camera, domElement);
    this.keys = new Set();
    this.vel = new THREE.Vector3();
    this.world = null; // Museum: colliders + groundAt()
    this.feet = 0;
    this.vy = 0;
    this.grounded = true;
    this.safe = { x: 0, y: 0, z: 0 };
    this.bob = 0;
    addEventListener('keydown', (e) => this.keys.add(e.code));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  get locked() { return this.controls.isLocked; }

  get yaw() {
    this.camera.getWorldDirection(fwd);
    return Math.atan2(-fwd.x, -fwd.z);
  }

  teleport(x, z, yaw, y = 0) {
    this.feet = y;
    this.vy = 0;
    this.grounded = true;
    this.safe = { x, y, z };
    this.camera.position.set(x, y + EYE_H, z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(0, yaw, 0);
    this.vel.set(0, 0, 0);
  }

  update(dt) {
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const walk = settings.walkSpeed;
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? walk * RUN_FACTOR : walk;

    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    target.set(fwd.x * f - fwd.z * r, 0, fwd.z * f + fwd.x * r);
    if (!this.locked || target.lengthSq() === 0) target.set(0, 0, 0);
    else target.normalize().multiplyScalar(speed);
    this.vel.lerp(target, 1 - Math.exp(-dt * 10));

    const p = this.camera.position;
    p.x += this.vel.x * dt;
    p.z += this.vel.z * dt;
    this.collide(p);
    this.fall(p, dt);

    const v = Math.hypot(this.vel.x, this.vel.z);
    this.bob += dt * v * 2.4;
    p.y = this.feet + EYE_H + Math.sin(this.bob) * 0.03 * Math.min(1, v / walk);
  }

  /** Sigue el suelo: sube peldaños/rampas, baja pegado a ellas y cae si no hay suelo. */
  fall(p, dt) {
    if (!this.world) return;
    const g = this.world.groundAt(p.x, p.z, this.feet);
    if (g >= this.feet) {
      this.feet = g;
      this.vy = 0;
      this.grounded = true;
    } else if (this.grounded && this.feet - g <= STEP_UP) {
      this.feet = g; // bajando una escalera o rampa
      this.vy = 0;
    } else {
      this.grounded = false;
      this.vy -= GRAVITY * dt;
      this.feet += this.vy * dt;
      if (this.feet <= g) {
        this.feet = g;
        this.vy = 0;
        this.grounded = true;
      }
    }
    if (this.grounded) this.safe = { x: p.x, y: this.feet, z: p.z };
    if (this.feet < -40) this.teleport(this.safe.x, this.safe.z, this.camera.rotation.y, this.safe.y);
  }

  /** Empuja al jugador (cilindro) fuera de las cajas que se cruzan con su altura. */
  collide(p) {
    if (!this.world) return;
    const R = PLAYER_R;
    const lo = this.feet + STEP_UP - 0.1, hi = this.feet + HEAD;
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.world.colliders.query(p.x, p.z, R + 0.5, nearby)) {
        if (b.maxY <= lo || b.minY >= hi) continue;
        if (p.x < b.minX - R || p.x > b.maxX + R || p.z < b.minZ - R || p.z > b.maxZ + R) continue;
        const cx = Math.min(Math.max(p.x, b.minX), b.maxX);
        const cz = Math.min(Math.max(p.z, b.minZ), b.maxZ);
        const dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2), push = (R - d) / d;
          p.x += dx * push;
          p.z += dz * push;
        } else {
          const opts = [
            [b.minX - R - p.x, 0], [b.maxX + R - p.x, 0], [0, b.minZ - R - p.z], [0, b.maxZ + R - p.z],
          ].sort((a, c) => Math.hypot(...a) - Math.hypot(...c));
          p.x += opts[0][0];
          p.z += opts[0][1];
        }
      }
    }
  }
}
