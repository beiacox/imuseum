// Formatos que necesitan conversión (HEIC y RAW) y lectura de EXIF, desde el hilo principal.
import TYPES from '../shared/media-types.json';
import { parseExif, isHeif, heifExifLocation, parseHeifExifItem } from './exif.js';
import { extOf } from './util.js';

const HEIF = new Set(TYPES.heif);
const RAW = new Set(TYPES.raw);

/** 'heic' | 'raw' | null */
export function conversionKind(name) {
  const e = extOf(name);
  return HEIF.has(e) ? 'heic' : RAW.has(e) ? 'raw' : null;
}

let worker = null, seq = 0;
const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./convert.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    pending.delete(data.id);
    if (!p) return;
    if (data.error) p.reject(new Error(data.error)); else p.resolve(data);
  };
  return worker;
}

function run(item, wantBlob) {
  const kind = conversionKind(item.name);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, url: item.url, kind, wantBlob });
  });
}

/** ImageBitmap a resolución completa de una foto HEIC o RAW (decodificada en el worker). */
export async function decodeConverted(item) {
  return (await run(item, false)).bitmap;
}

const displayCache = new Map();
/** URL que un <img> puede mostrar: la original, o un JPEG convertido para HEIC/RAW. */
export async function displayURL(item) {
  if (!conversionKind(item.name)) return item.url;
  if (!displayCache.has(item)) {
    displayCache.set(item, run(item, true).then(({ blob }) => URL.createObjectURL(blob)));
    if (displayCache.size > 12) { // no guardar decenas de JPEG grandes en memoria
      const [old, url] = displayCache.entries().next().value;
      displayCache.delete(old);
      url.then(URL.revokeObjectURL);
    }
  }
  return displayCache.get(item);
}

async function readRange(item, start, end) {
  if (item.readRange) return item.readRange(start, end);
  const res = await fetch(item.url, { headers: { Range: `bytes=${start}-${end - 1}` } });
  const buf = await res.arrayBuffer();
  return res.status === 206 || start === 0 ? buf.slice(0, end - start) : buf.slice(start, end);
}

/** EXIF de una foto leyendo solo su cabecera (y, en HEIC, el trozo donde está el EXIF). */
export async function readExif(item) {
  if (item.exif !== undefined) return item.exif;
  let exif = null;
  try {
    const head = await readRange(item, 0, 262144);
    if (isHeif(head)) {
      const loc = heifExifLocation(head);
      if (loc) exif = parseHeifExifItem(await readRange(item, loc.offset, loc.offset + loc.length));
    } else {
      exif = parseExif(head);
    }
  } catch { /* sin EXIF */ }
  item.exif = exif;
  return exif;
}
