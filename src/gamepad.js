// Mando (Gamepad API, distribución estándar de Xbox/PlayStation).
// Con el mando no hace falta capturar el ratón: en cuanto se usa, la app pasa a «modo mando».

export const BTN = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};
const DEAD = 0.18;
const dz = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

export class GamepadInput {
  constructor() {
    this.prev = [];
    this.lastUse = 0;
    this.repeat = new Map();
    addEventListener('gamepaddisconnected', () => { this.prev = []; });
  }

  get recent() { return performance.now() - this.lastUse < 30000; }

  /** Lee el primer mando conectado. Devuelve null si no hay ninguno. */
  poll() {
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected);
    if (!pad) return null;
    const pressed = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    const prev = this.prev;
    const s = {
      lx: dz(pad.axes[0] ?? 0), ly: dz(pad.axes[1] ?? 0),
      rx: dz(pad.axes[2] ?? 0), ry: dz(pad.axes[3] ?? 0),
      held: (b) => !!pressed[b],
      down: (b) => !!pressed[b] && !prev[b], // recién pulsado (respecto a la lectura anterior)
    };
    if (pressed.some(Boolean) || s.lx || s.ly || s.rx || s.ry) this.lastUse = performance.now();
    this.prev = pressed;
    return s;
  }

  /** Repetición para navegar listas con la cruceta o el stick (primer paso inmediato, luego cada 140 ms). */
  nav(s) {
    const dir = s.held(BTN.DOWN) || s.ly > 0.6 ? 1 : s.held(BTN.UP) || s.ly < -0.6 ? -1 : 0;
    const now = performance.now();
    if (!dir) { this.repeat.delete('nav'); return 0; }
    const r = this.repeat.get('nav');
    if (r && r.dir === dir && now < r.next) return 0;
    this.repeat.set('nav', { dir, next: now + (r && r.dir === dir ? 140 : 380) });
    return dir;
  }
}
