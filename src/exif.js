// Lector EXIF mínimo, sin dependencias: cámara, objetivo, fecha de captura, exposición y
// orientación. Entiende JPEG (APP1), TIFF y RAW basados en TIFF (CR2, NEF, ARW, DNG, ORF…),
// y busca la cabecera TIFF incrustada en HEIC y CR3. Se usa también desde el worker de
// conversión, por eso no toca el DOM.

const TAGS = {
  0x010f: 'make', 0x0110: 'model', 0x0112: 'orientation', 0x0132: 'dateTime', 0x8769: 'exifIFD',
  0x829a: 'exposure', 0x829d: 'fNumber', 0x8827: 'iso', 0x9003: 'dateOriginal', 0x920a: 'focal',
  0xa405: 'focal35', 0xa434: 'lens',
};
const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function readIFD(v, tiff, off, le, out) {
  const n = v.getUint16(tiff + off, le);
  for (let i = 0; i < n; i++) {
    const e = tiff + off + 2 + i * 12;
    const name = TAGS[v.getUint16(e, le)];
    if (!name) continue;
    const type = v.getUint16(e + 2, le), count = v.getUint32(e + 4, le);
    const size = (SIZES[type] ?? 1) * count;
    const at = size <= 4 ? e + 8 : tiff + v.getUint32(e + 8, le);
    if (at + size > v.byteLength) continue;
    if (type === 2) {
      let s = '';
      for (let k = 0; k < count; k++) { const c = v.getUint8(at + k); if (!c) break; s += String.fromCharCode(c); }
      out[name] = s.trim();
    } else if (type === 3) out[name] = v.getUint16(at, le);
    else if (type === 4 || type === 9) out[name] = v.getUint32(at, le);
    else if (type === 5 || type === 10) {
      const den = v.getUint32(at + 4, le);
      out[name] = den ? v.getUint32(at, le) / den : 0;
      out[`${name}Raw`] = [v.getUint32(at, le), den];
    }
  }
}

function parseTiff(v, tiff) {
  try {
    return parseTiffAt(v, tiff);
  } catch {
    return null; // bloque truncado o falso positivo
  }
}

function parseTiffAt(v, tiff) {
  if (tiff + 8 > v.byteLength) return null;
  const bo = v.getUint16(tiff);
  if (bo !== 0x4949 && bo !== 0x4d4d) return null;
  const le = bo === 0x4949;
  if (v.getUint16(tiff + 2, le) !== 42) return null;
  const raw = {};
  readIFD(v, tiff, v.getUint32(tiff + 4, le), le, raw);
  if (raw.exifIFD) readIFD(v, tiff, raw.exifIFD, le, raw);
  return raw;
}

/** Posibles inicios de un bloque TIFF dentro de contenedores ISO-BMFF (HEIC, CR3). */
function* tiffCandidates(u8) {
  for (let i = 0; i < u8.length - 10; i++) {
    // 'Exif\0\0' (HEIC); la palabra también aparece en la tabla de elementos, por eso se prueban todas
    if (u8[i] === 0x45 && u8[i + 1] === 0x78 && u8[i + 2] === 0x69 && u8[i + 3] === 0x66 && u8[i + 4] === 0 && u8[i + 5] === 0) yield i + 6;
    // CR3 guarda el EXIF en la caja CMT1 sin prefijo 'Exif'
    if (u8[i] === 0x43 && u8[i + 1] === 0x4d && u8[i + 2] === 0x54 && u8[i + 3] === 0x31) yield i + 4;
  }
}

function parseDate(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s ?? '');
  if (!m || m[1] === '0000') return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/**
 * @param {ArrayBuffer} buf primeros ~256 KB del archivo
 * @returns {null | { camera, lens, date, exposure, fNumber, iso, focal, orientation }}
 */
export function parseExif(buf) {
  try {
    const v = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let raw = null;
    if (v.getUint16(0) === 0xffd8) {
      let o = 2;
      while (o + 10 < v.byteLength) {
        const marker = v.getUint16(o);
        if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
        if (marker === 0xffe1 && v.getUint32(o + 4) === 0x45786966) { raw = parseTiff(v, o + 10); break; }
        o += 2 + v.getUint16(o + 2);
      }
    } else {
      raw = parseTiff(v, 0);
      for (const t of raw ? [] : tiffCandidates(u8)) {
        raw = parseTiff(v, t);
        if (raw) break;
      }
    }
    if (!raw) return null;
    const make = raw.make ?? '';
    let camera = raw.model ?? '';
    const brand = make.split(/\s+/)[0];
    if (make && camera && !camera.toLowerCase().startsWith(brand.toLowerCase())) camera = `${brand} ${camera}`;
    const exp = raw.exposure;
    const out = {
      camera: camera || make || '',
      lens: raw.lens || '',
      date: parseDate(raw.dateOriginal) ?? parseDate(raw.dateTime),
      exposure: exp ? (exp >= 1 ? `${+exp.toFixed(1)} s` : `1/${Math.round(1 / exp)} s`) : '',
      fNumber: raw.fNumber ? `f/${+raw.fNumber.toFixed(1)}` : '',
      iso: raw.iso ? `ISO ${raw.iso}` : '',
      focal: raw.focal35 ? `${raw.focal35} mm` : raw.focal ? `${Math.round(raw.focal)} mm` : '',
      orientation: raw.orientation ?? 1,
    };
    const any = out.camera || out.date || out.exposure || out.fNumber || out.iso;
    return any ? out : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- HEIC / HEIF

/** ¿Empieza el archivo por una caja ftyp de HEIF/AVIF? */
export function isHeif(buf) {
  const v = new DataView(buf);
  return v.byteLength > 12 && v.getUint32(4) === 0x66747970; // 'ftyp'
}

function boxes(v, start, end) {
  const out = [];
  let o = start;
  while (o + 8 <= end) {
    let size = v.getUint32(o);
    const type = String.fromCharCode(v.getUint8(o + 4), v.getUint8(o + 5), v.getUint8(o + 6), v.getUint8(o + 7));
    let header = 8;
    if (size === 1) { size = Number(v.getBigUint64(o + 8)); header = 16; }
    if (size === 0) size = end - o;
    if (size < header) break;
    out.push({ type, start: o, body: o + header, end: Math.min(end, o + size) });
    o += size;
  }
  return out;
}

const readN = (v, o, n) => (n === 0 ? 0 : n === 2 ? v.getUint16(o) : n === 4 ? v.getUint32(o) : Number(v.getBigUint64(o)));

/**
 * Dónde está el bloque EXIF de un HEIC: lo dice la tabla de elementos (iinf + iloc) de la
 * caja meta, que va al principio del archivo aunque los datos estén al final.
 * @returns {null | { offset: number, length: number }}
 */
export function heifExifLocation(buf) {
  try {
    const v = new DataView(buf);
    const meta = boxes(v, 0, v.byteLength).find((b) => b.type === 'meta');
    if (!meta) return null;
    const inner = boxes(v, meta.body + 4, meta.end); // meta es una «full box»: 4 bytes de versión/flags
    const iinf = inner.find((b) => b.type === 'iinf');
    const iloc = inner.find((b) => b.type === 'iloc');
    if (!iinf || !iloc) return null;

    let exifId = -1;
    const iv = v.getUint8(iinf.body);
    const entriesStart = iinf.body + 4 + (iv === 0 ? 2 : 4);
    for (const infe of boxes(v, entriesStart, iinf.end)) {
      if (infe.type !== 'infe') continue;
      const ver = v.getUint8(infe.body);
      if (ver < 2) continue;
      const idSize = ver === 2 ? 2 : 4;
      const id = readN(v, infe.body + 4, idSize);
      const t = infe.body + 4 + idSize + 2;
      const type = String.fromCharCode(v.getUint8(t), v.getUint8(t + 1), v.getUint8(t + 2), v.getUint8(t + 3));
      if (type === 'Exif') { exifId = id; break; }
    }
    if (exifId < 0) return null;

    let o = iloc.body;
    const ver = v.getUint8(o);
    o += 4;
    const a = v.getUint8(o), b = v.getUint8(o + 1);
    const offSize = a >> 4, lenSize = a & 15, baseSize = b >> 4, idxSize = ver >= 1 ? b & 15 : 0;
    o += 2;
    const count = ver < 2 ? v.getUint16(o) : v.getUint32(o);
    o += ver < 2 ? 2 : 4;
    for (let i = 0; i < count; i++) {
      const id = ver < 2 ? v.getUint16(o) : v.getUint32(o);
      o += ver < 2 ? 2 : 4;
      if (ver >= 1) o += 2; // método de construcción
      o += 2;               // índice de referencia de datos
      const base = readN(v, o, baseSize);
      o += baseSize;
      const extents = v.getUint16(o);
      o += 2;
      let first = null;
      for (let e = 0; e < extents; e++) {
        o += idxSize;
        const off = readN(v, o, offSize);
        o += offSize;
        const len = readN(v, o, lenSize);
        o += lenSize;
        first ??= { offset: base + off, length: len };
      }
      if (id === exifId) return first;
    }
    return null;
  } catch {
    return null;
  }
}

/** Interpreta el contenido del elemento Exif de un HEIC (4 bytes de desplazamiento + TIFF). */
export function parseHeifExifItem(buf) {
  try {
    const v = new DataView(buf);
    let t = 4 + v.getUint32(0);
    // algunos codificadores incluyen 'Exif\0\0' antes del TIFF
    if (v.getUint32(t) === 0x45786966) t += 6;
    return parseExif(buf.slice(t));
  } catch {
    return null;
  }
}

/** «Canon EOS R6 · f/2.8 · 1/250 s · ISO 400 · 35 mm» */
export function exifSummary(x) {
  if (!x) return '';
  return [x.camera, x.fNumber, x.exposure, x.iso, x.focal].filter(Boolean).join(' · ');
}
