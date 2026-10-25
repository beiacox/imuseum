// Ajustes del usuario: se editan desde la pantalla «Ajustes» y se guardan en
// localStorage (en la app de escritorio vive en la carpeta de datos de la app).

const KEY = 'imuseum.settings.v1';

/** Definición de cada ajuste; la pantalla de ajustes se genera a partir de aquí. */
export const SCHEMA = [
  { section: 'Video' },
  { key: 'maxVideos', label: 'Videos reproduciéndose a la vez', type: 'range', min: 1, max: 30, step: 1, def: 10,
    hint: 'Se reproducen los más cercanos. Más videos = más carga para la tarjeta gráfica.' },
  { key: 'videoDist', label: 'Distancia de reproducción', type: 'range', min: 8, max: 120, step: 1, def: 35, unit: 'm',
    hint: 'A partir de qué distancia una pantalla empieza a reproducirse.' },
  { key: 'mutedVideos', label: 'Videos en silencio hasta que pulse E', type: 'toggle', def: true },

  { section: 'Iluminación' },
  { key: 'ambient', label: 'Luz ambiental', type: 'range', min: 0, max: 100, step: 1, def: 6, unit: '%',
    hint: 'Baja = museo a oscuras, iluminado por las propias obras. Alta = galería iluminada.' },
  { key: 'glow', label: 'Luz que emiten las obras', type: 'range', min: 0, max: 3, step: 0.1, def: 1, unit: '×',
    hint: 'Cada cuadro y pantalla proyecta el color de su imagen sobre la pared y el suelo.' },
  { key: 'realLights', label: 'Luces dinámicas', type: 'range', min: 0, max: 16, step: 1, def: 8,
    hint: 'Las obras más cercanas iluminan de verdad paredes, columnas y suelos. Más = más carga gráfica.' },
  { key: 'liveVideoColor', label: 'La luz de los videos cambia con la imagen', type: 'toggle', def: true },

  { section: 'Imágenes y visión' },
  { key: 'imageDist', label: 'Distancia de carga de imágenes', type: 'range', min: 8, max: 45, step: 1, def: 16, unit: 'm',
    hint: 'Más distancia = cuadros listos antes, pero más memoria gráfica.' },
  { key: 'textureMax', label: 'Resolución de los cuadros', type: 'select', def: 1024,
    options: [[512, 'Baja (512 px)'], [1024, 'Normal (1024 px)'], [2048, 'Alta (2048 px)']],
    hint: 'Las miniaturas se guardan en caché por resolución.' },
  { key: 'viewDist', label: 'Distancia de visión', type: 'range', min: 40, max: 150, step: 5, def: 60, unit: 'm',
    hint: 'Hasta dónde se ve antes de la niebla. Más distancia = más salas en memoria.' },
  { key: 'renderScale', label: 'Calidad de imagen', type: 'select', def: 1.5,
    options: [[0.6, 'Muy baja'], [0.8, 'Baja'], [1, 'Normal'], [1.5, 'Alta'], [2, 'Máxima']] },

  { section: 'Arquitectura' },
  { key: 'hallSlopes', label: 'Desniveles en los pasillos', type: 'range', min: 0, max: 100, step: 5, def: 50, unit: '%',
    hint: 'Probabilidad de que el pasillo de un ala suba o baje entre una pareja de salas y la siguiente.', rebuild: true },
  { key: 'roomSunken', label: 'Salas hundidas', type: 'toggle', def: true, rebuild: true },
  { key: 'roomPanels', label: 'Salas de paneles', type: 'toggle', def: true, rebuild: true },
  { key: 'roomMezzanine', label: 'Salas de doble altura', type: 'toggle', def: true, rebuild: true },
  { key: 'roomTowers', label: 'Torres de varios pisos', type: 'toggle', def: true, rebuild: true,
    hint: 'Si se desactivan tipos, esas carpetas usan salas clásicas más grandes.' },
  { key: 'wingsPerFloor', label: 'Alas por piso de la galería', type: 'range', min: 4, max: 60, step: 2, def: 16, rebuild: true,
    hint: 'Con más alas que esto, la galería principal se apila en pisos unidos por ascensores.' },

  { section: 'Visita guiada' },
  { key: 'tourSeconds', label: 'Segundos delante de cada obra', type: 'range', min: 2, max: 20, step: 1, def: 5, unit: 's' },
  { key: 'tourPlayMedia', label: 'Reproducir videos y audios durante la visita', type: 'toggle', def: true },

  { section: 'Controles' },
  { key: 'mouseSpeed', label: 'Sensibilidad del ratón', type: 'range', min: 0.2, max: 3, step: 0.1, def: 1, unit: '×' },
  { key: 'walkSpeed', label: 'Velocidad al caminar', type: 'range', min: 2, max: 10, step: 0.2, def: 3.6, unit: 'm/s',
    hint: 'Con Shift se corre a 2,2 veces esta velocidad.' },
  { key: 'fov', label: 'Campo de visión', type: 'range', min: 50, max: 100, step: 1, def: 70, unit: '°' },
  { key: 'padSpeed', label: 'Sensibilidad del mando', type: 'range', min: 0.3, max: 3, step: 0.1, def: 1, unit: '×',
    hint: 'Stick izquierdo: caminar · derecho: mirar · A: interactuar · Y: directorio · X: visita guiada.' },
  { key: 'padInvertY', label: 'Invertir eje vertical del mando', type: 'toggle', def: false },

  { section: 'Sonido e interfaz' },
  { key: 'volume', label: 'Volumen general', type: 'range', min: 0, max: 100, step: 1, def: 80, unit: '%' },
  { key: 'showMinimap', label: 'Mostrar minimapa (M)', type: 'toggle', def: true },
  { key: 'showFps', label: 'Mostrar FPS y videos activos', type: 'toggle', def: false,
    hint: 'Útil para ajustar el rendimiento.' },

  { section: 'Escaneo y actualizaciones' },
  { key: 'scanCache', label: 'Recordar el escaneo de cada carpeta', type: 'toggle', def: true,
    hint: 'Reabre carpetas enormes al instante y busca cambios en segundo plano (solo app de escritorio).' },
  { key: 'readExif', label: 'Leer datos EXIF de las fotos', type: 'toggle', def: true,
    hint: 'Muestra cámara, fecha de captura y exposición en las cartelas.' },
  { key: 'autoUpdate', label: 'Buscar actualizaciones al iniciar', type: 'toggle', def: true,
    hint: 'Avisa cuando hay una versión nueva en GitHub (solo AppImage, Windows y macOS).', native: true },
];

const FIELDS = SCHEMA.filter((s) => s.key);
export const DEFAULTS = Object.fromEntries(FIELDS.map((f) => [f.key, f.def]));

function sanitize(f, v) {
  if (f.type === 'toggle') return typeof v === 'boolean' ? v : f.def;
  const n = Number(v);
  if (!Number.isFinite(n)) return f.def;
  if (f.type === 'select') return f.options.some(([o]) => o === n) ? n : f.def;
  return Math.min(f.max, Math.max(f.min, n));
}

function load() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { /* valores por defecto */ }
  return Object.fromEntries(FIELDS.map((f) => [f.key, f.key in stored ? sanitize(f, stored[f.key]) : f.def]));
}

export const settings = load();
const listeners = new Set();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { console.warn('Ajustes no guardados', e); }
}

export function setSetting(key, value) {
  const f = FIELDS.find((x) => x.key === key);
  if (!f) return;
  const v = sanitize(f, value);
  if (settings[key] === v) return;
  settings[key] = v;
  save();
  for (const fn of listeners) fn(key, v);
}

export function resetSettings() {
  for (const f of FIELDS) setSetting(f.key, f.def);
}

/** Ajustes que solo surten efecto al reconstruir el museo. */
export const REBUILD_KEYS = new Set(FIELDS.filter((f) => f.rebuild).map((f) => f.key));

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Distancias internas derivadas de los ajustes, siempre coherentes entre sí:
 * una sala debe estar construida para que sus pantallas o cuadros existan.
 */
export function distances() {
  const { imageDist, videoDist, viewDist } = settings;
  const build = Math.max(viewDist + 2, videoDist + 8, imageDist + 15);
  return {
    imageOn: imageDist,
    imageOff: imageDist + 12,
    videoOn: videoDist + 3,
    videoOff: videoDist + 15,
    build,
    destroy: build + 23,
  };
}
