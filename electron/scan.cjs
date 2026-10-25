// Escaneo recursivo de una carpeta en disco. Solo lee nombres, tamaños y fechas:
// nunca el contenido de los archivos, así que escala a colecciones de cientos de GB.
//
// Con un escaneo anterior (`previous`) es incremental: si la fecha de modificación de una
// carpeta no cambió, su lista de archivos y subcarpetas sigue siendo válida y no se vuelve
// a leer. Así se detectan archivos añadidos, borrados o renombrados mirando solo las
// carpetas, no cada archivo.
const fs = require('node:fs');
const path = require('node:path');
const types = require('../shared/media-types.json');

const TYPE_BY_EXT = new Map();
for (const t of ['image', 'video', 'audio']) for (const e of types[t]) TYPE_BY_EXT.set(e, t);
const SKIP = new Set(types.skipDirs);

function mediaType(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? null : TYPE_BY_EXT.get(name.slice(i + 1).toLowerCase()) ?? null;
}

/**
 * @param {string} root carpeta absoluta
 * @param {{ onProgress?: Function, isCancelled?: () => boolean, previous?: object }} opts
 *   previous: `dirs` de un escaneo anterior de la misma carpeta
 * @returns {{ rootName: string, dirs: object, entries: object[], reused: number, read: number }}
 *   dirs: { [rel]: { m: mtime, f: [[nombre, tamaño, mtime]], s: [subcarpetas] } }
 *   entries: { path, dir, name, type, size, mtime }
 */
async function scanFolder(root, { onProgress, isCancelled, previous } = {}) {
  const dirs = {};
  const entries = [];
  let seen = 0, count = 0, last = 0, reused = 0, read = 0;
  const stack = [''];

  while (stack.length) {
    if (isCancelled?.()) throw Object.assign(new Error('Escaneo cancelado'), { cancelled: true });
    const rel = stack.pop();
    const abs = rel ? path.join(root, rel) : root;
    let st;
    try { st = await fs.promises.stat(abs); } catch { continue; } // borrada, sin permisos, desmontada…
    count++;

    let rec = previous?.[rel];
    if (rec && rec.m === st.mtimeMs) {
      reused++;
    } else {
      read++;
      rec = { m: st.mtimeMs, f: [], s: [] };
      const media = [];
      try {
        const dir = await fs.promises.opendir(abs, { bufferSize: 256 });
        for await (const ent of dir) {
          if (ent.name.startsWith('.') || SKIP.has(ent.name)) continue;
          if (ent.isDirectory()) rec.s.push(ent.name);
          else if (ent.isFile() && mediaType(ent.name)) media.push(ent.name);
          // los enlaces simbólicos se ignoran para evitar ciclos
        }
      } catch { /* carpeta ilegible a medias: nos quedamos con lo leído */ }
      for (let i = 0; i < media.length; i += 64) {
        await Promise.all(media.slice(i, i + 64).map(async (name) => {
          try {
            const fst = await fs.promises.stat(path.join(abs, name));
            if (fst.size) rec.f.push([name, fst.size, fst.mtimeMs]);
          } catch { /* archivo inaccesible */ }
        }));
      }
    }
    dirs[rel] = rec;
    for (const [name, size, mtime] of rec.f) {
      seen++;
      entries.push({ path: path.join(abs, name), dir: rel, name, type: mediaType(name), size, mtime });
    }
    for (const sub of rec.s) stack.push(rel ? `${rel}/${sub}` : sub);

    const now = Date.now();
    if (onProgress && now - last > 150) {
      last = now;
      onProgress({ seen, found: entries.length, dirs: count, current: rel });
    }
  }
  onProgress?.({ seen, found: entries.length, dirs: count, current: '' });
  return { rootName: path.basename(root) || root, dirs, entries, reused, read };
}

/** Reconstruye la lista de archivos de un escaneo guardado sin tocar el disco. */
function entriesFromDirs(root, dirs) {
  const entries = [];
  for (const [rel, rec] of Object.entries(dirs)) {
    const abs = rel ? path.join(root, rel) : root;
    for (const [name, size, mtime] of rec.f) {
      entries.push({ path: path.join(abs, name), dir: rel, name, type: mediaType(name), size, mtime });
    }
  }
  return entries;
}

module.exports = { scanFolder, entriesFromDirs, mediaType };
