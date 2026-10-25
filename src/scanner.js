import { IMG, VID, MAX_WALL_LENGTH, MAX_AUDIO_PER_ROOM } from './config.js';
import { extOf } from './util.js';
import TYPES from '../shared/media-types.json';

const TYPE_BY_EXT = new Map();
for (const t of ['image', 'video', 'audio']) for (const e of TYPES[t]) TYPE_BY_EXT.set(e, t);
const SKIP_DIRS = new Set(TYPES.skipDirs);
const skipName = (n) => n.startsWith('.') || SKIP_DIRS.has(n);

export const mediaType = (name) => TYPE_BY_EXT.get(extOf(name)) ?? null;
export const native = window.imuseumNative ?? null;
export const supportsPicker = () => typeof window.showDirectoryPicker === 'function';

/*
 * Un "item" es independiente de dónde viene:
 *   { type, name, dir, size, mtime, url, thumbURL?, id? }
 * En la app de escritorio `url` apunta al protocolo imuseum:// (streaming desde disco);
 * en el navegador es un blob: creado bajo demanda a partir del File.
 */
function webItem(type, name, dir, file) {
  let url;
  return {
    type, name, dir,
    size: file.size,
    mtime: file.lastModified,
    get url() { return (url ??= URL.createObjectURL(file)); },
    readRange: (start, end) => file.slice(start, end).arrayBuffer(),
  };
}

function nativeItem(raw) {
  return {
    ...raw,
    url: `${native.mediaBase}__media/${raw.id}`,
    thumbURL: `${native.mediaBase}__thumb/${raw.id}`,
  };
}

// ---------------------------------------------------------------- escritorio

export async function scanNative(root, onProgress, { useCache = true } = {}) {
  const off = native.onScanProgress(onProgress);
  try {
    const res = await native.scan(root, { useCache });
    return { ...res, items: res.items.map(nativeItem) };
  } finally {
    off();
  }
}

/** Busca cambios respecto al escaneo guardado (en segundo plano). */
export async function rescanNative(root, onProgress) {
  const off = native.onRescanProgress(onProgress);
  try {
    const res = await native.rescan(root);
    return { ...res, items: res.items.map(nativeItem) };
  } finally {
    off();
  }
}

// ---------------------------------------------------------------- navegador

export async function scanDirectoryHandle(root, onProgress) {
  const items = [];
  let seen = 0, last = 0;
  async function walk(dir, path) {
    for await (const handle of dir.values()) {
      if (skipName(handle.name)) continue;
      if (handle.kind === 'directory') {
        await walk(handle, path ? `${path}/${handle.name}` : handle.name);
        continue;
      }
      seen++;
      const type = mediaType(handle.name);
      if (type) {
        try { items.push(webItem(type, handle.name, path, await handle.getFile())); }
        catch (e) { console.warn('No se pudo leer', handle.name, e); }
      }
      const now = performance.now();
      if (now - last > 120) { last = now; onProgress?.({ seen, found: items.length, current: path }); }
    }
  }
  await walk(root, '');
  return { rootName: root.name, items };
}

export function scanFileList(files) {
  const items = [];
  let rootName = 'Mi museo';
  for (const file of files) {
    const parts = (file.webkitRelativePath || file.name).split('/');
    if (parts.length > 1) rootName = parts[0];
    if (parts.some(skipName)) continue;
    const type = mediaType(file.name);
    if (type) items.push(webItem(type, file.name, parts.slice(1, -1).join('/'), file));
  }
  return { rootName, items };
}

export async function loadDemo(base = 'demo/') {
  const manifest = await (await fetch(base + 'manifest.json')).json();
  const items = await Promise.all(manifest.files.map(async (path) => {
    const blob = await (await fetch(base + path)).blob();
    const parts = path.split('/');
    const name = parts.pop();
    return webItem(mediaType(name), name, parts.join('/'), new File([blob], name, { type: blob.type }));
  }));
  return { rootName: manifest.name, items };
}

// ---------------------------------------------------------------- salas

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const topOf = (dir) => (dir === '' ? '' : dir.split('/')[0]);

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Agrupa por carpeta. Cada carpeta con multimedia se convierte en una o más salas
 * (las muy grandes se reparten). `top` es la carpeta de primer nivel → ala del museo.
 */
export function buildCollections({ rootName, items }) {
  const byDir = new Map();
  for (const it of items) {
    let c = byDir.get(it.dir);
    if (!c) byDir.set(it.dir, (c = { dir: it.dir, top: topOf(it.dir), image: [], video: [], audio: [] }));
    c[it.type].push(it);
  }
  const dirs = [...byDir.values()].sort((a, b) => {
    if (a.top !== b.top) return a.top === '' ? -1 : b.top === '' ? 1 : collator.compare(a.top, b.top);
    return collator.compare(a.dir, b.dir);
  });

  const collections = [];
  for (const c of dirs) {
    for (const k of ['image', 'video', 'audio']) c[k].sort((a, b) => collator.compare(a.name, b.name));

    const wallChunks = [];
    let cur = [], len = 0;
    for (const it of [...c.video, ...c.image]) {
      const slot = it.type === 'video' ? VID.slot : IMG.slot;
      if (cur.length && len + slot > MAX_WALL_LENGTH) { wallChunks.push(cur); cur = []; len = 0; }
      cur.push(it);
      len += slot;
    }
    if (cur.length) wallChunks.push(cur);
    const audioChunks = chunk(c.audio, MAX_AUDIO_PER_ROOM);

    const n = Math.max(wallChunks.length, audioChunks.length);
    const baseTitle = c.dir === '' ? rootName : c.dir.split('/').pop();
    const path = c.dir === '' ? rootName : `${rootName}/${c.dir}`;
    for (let i = 0; i < n; i++) {
      const wall = wallChunks[i] ?? [];
      const audio = audioChunks[i] ?? [];
      collections.push({
        title: n > 1 ? `${baseTitle} (${i + 1}/${n})` : baseTitle,
        path,
        top: c.top,
        wall,
        audio,
        counts: {
          image: wall.filter((x) => x.type === 'image').length,
          video: wall.filter((x) => x.type === 'video').length,
          audio: audio.length,
        },
      });
    }
  }
  return collections;
}
