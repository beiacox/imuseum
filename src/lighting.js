import * as THREE from 'three';
import { settings } from './settings.js';

const INTENSITY = 16;  // candelas por unidad de «luz que emiten las obras»
const RANGE = 11;      // metros de alcance de cada luz
const camDir = new THREE.Vector3();
const toLight = new THREE.Vector3();

/**
 * Reserva fija de luces puntuales que se asignan a las obras más relevantes (cercanas y
 * delante de la cámara). Cada luz toma el color de su obra y se funde al cambiar de obra,
 * así el número de luces del shader no cambia mientras se camina.
 */
export class ArtLights {
  constructor(scene) {
    this.scene = scene;
    this.slots = [];
    this.timer = 0;
    this.setCount(settings.realLights);
  }

  setCount(n) {
    while (this.slots.length > n) {
      const s = this.slots.pop();
      this.scene.remove(s.light);
      s.light.dispose();
    }
    while (this.slots.length < n) {
      const light = new THREE.PointLight(0xffffff, 0, RANGE, 2);
      this.scene.add(light);
      this.slots.push({ light, ex: null, next: null });
    }
  }

  update(dt, camera, museum) {
    if (!museum) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.15;
      this.assign(camera, museum);
    }
    const k = Math.min(1, dt * 6);
    for (const s of this.slots) {
      // apaga antes de mudarse a otra obra para que la luz no salte
      if (s.next !== s.ex) {
        s.light.intensity += (0 - s.light.intensity) * k * 2;
        if (s.light.intensity < 0.05) s.ex = s.next;
        continue;
      }
      const ex = s.ex;
      const target = ex ? ex.glowLevel * settings.glow * INTENSITY : 0;
      s.light.intensity += (target - s.light.intensity) * k;
      if (ex) {
        s.light.color.copy(ex.glowColor);
        s.light.position.copy(ex.lightPos);
      }
    }
  }

  assign(camera, museum) {
    if (!this.slots.length) return;
    camera.getWorldDirection(camDir);
    const p = camera.position;
    const scored = [];
    for (const ex of museum.glowSources()) {
      if (ex.glowLevel < 0.03) continue;
      toLight.subVectors(ex.lightPos, p);
      const d = toLight.length();
      if (d > RANGE + 8) continue;
      const facing = d > 0.01 ? camDir.dot(toLight) / d : 1;
      scored.push({ ex, score: d - facing * 4 });
    }
    scored.sort((a, b) => a.score - b.score);
    const chosen = new Set(scored.slice(0, this.slots.length).map((s) => s.ex));
    // conserva las asignaciones que siguen siendo válidas
    const free = [];
    for (const s of this.slots) {
      const keep = s.next && chosen.has(s.next);
      if (keep) chosen.delete(s.next);
      else free.push(s);
    }
    for (const ex of chosen) {
      const s = free.shift();
      if (!s) break;
      s.next = ex;
    }
    for (const s of free) s.next = null;
  }
}
