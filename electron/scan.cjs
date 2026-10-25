// Escaneo recursivo de una carpeta en disco. Solo lee nombres, tamaños y fechas:
// nunca el contenido de los archivos, así que escala a colecciones de cientos de GB.
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
 * @param {{ onProgress?: Function, isCancelled?: () => boolean }} opts
 * @returns {{ rootName: string, items: object[], files: {path:string,size:number,mtime:number}[] }}
 */
async function scanFolder(root, { onProgress, isCancelled } = {}) {
  const files = [];
  const items = [];
  let seen = 0, dirs = 0, last = 0;
  const stack = [''];

  while (stack.length) {
    if (isCancelled?.()) throw Object.assign(new Error('Escaneo cancelado'), { cancelled: true });
    const rel = stack.pop();
    const abs = rel ? path.join(root, rel) : root;
    let dir;
    try { dir = await fs.promises.opendir(abs, { bufferSize: 256 }); }
    catch { continue; } // sin permisos, desmontado, etc.
    dirs++;

    const media = [];
    try {
      for await (const ent of dir) {
        if (ent.name.startsWith('.') || SKIP.has(ent.name)) continue;
        if (ent.isDirectory()) stack.push(rel ? `${rel}/${ent.name}` : ent.name);
        else if (ent.isFile()) {
          seen++;
          const type = mediaType(ent.name);
          if (type) media.push({ type, name: ent.name });
        }
        // los enlaces simbólicos se ignoran para evitar ciclos
      }
    } catch { /* carpeta ilegible a medias: nos quedamos con lo leído */ }

    for (let i = 0; i < media.length; i += 64) {
      await Promise.all(media.slice(i, i + 64).map(async (m) => {
        const p = path.join(abs, m.name);
        try {
          const st = await fs.promises.stat(p);
          if (!st.size) return;
          const id = files.length;
          files.push({ path: p, size: st.size, mtime: st.mtimeMs });
          items.push({ id, type: m.type, name: m.name, dir: rel, size: st.size, mtime: st.mtimeMs });
        } catch { /* archivo inaccesible */ }
      }));
    }

    const now = Date.now();
    if (onProgress && now - last > 150) {
      last = now;
      onProgress({ seen, found: items.length, dirs, current: rel });
    }
  }
  onProgress?.({ seen, found: items.length, dirs, current: '' });
  return { rootName: path.basename(root) || root, items, files };
}

module.exports = { scanFolder, mediaType };
