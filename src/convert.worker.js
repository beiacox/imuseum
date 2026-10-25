// Worker de conversión de formatos que Chromium no decodifica:
//   · HEIC/HEIF → libheif (WebAssembly, se carga solo la primera vez que hace falta)
//   · RAW (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2…) → la vista previa JPEG que la cámara
//     incrusta en el archivo (la mayor de calidad normal; se descartan los JPEG sin pérdida
//     que algunas marcas usan para los datos del sensor).
// Responde con un ImageBitmap (para texturas) o un Blob JPEG (para el visor).
import { parseExif } from './exif.js';

let heifPromise;
function heif() {
  heifPromise ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then((m) => m.default());
  return heifPromise;
}

/** Fin de un JPEG que empieza en `start` y su tipo de SOF, o null si no es válido. */
function jpegInfo(u8, start) {
  let o = start + 2, sof = -1;
  while (o + 2 <= u8.length) {
    if (u8[o] !== 0xff) return null;
    const m = u8[o + 1];
    if (m === 0xff) { o++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
    if (m === 0xd9) return { end: o + 2, sof }; // el fin puede coincidir con el final del archivo
    if (o + 4 > u8.length) return null;
    const len = (u8[o + 2] << 8) | u8[o + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) sof = m;
    if (m === 0xda) {
      o += 2 + len;
      // datos comprimidos: hasta el siguiente marcador que no sea relleno ni de reinicio
      while (o + 1 < u8.length && !(u8[o] === 0xff && u8[o + 1] !== 0 && !(u8[o + 1] >= 0xd0 && u8[o + 1] <= 0xd7))) o++;
      continue;
    }
    o += 2 + len;
  }
  return null;
}

/** La mayor vista previa JPEG (base o progresiva) incrustada en un archivo RAW. */
function largestJpeg(u8) {
  let best = null;
  for (let i = 0; i < u8.length - 3; i++) {
    if (u8[i] !== 0xff || u8[i + 1] !== 0xd8 || u8[i + 2] !== 0xff) continue;
    const info = jpegInfo(u8, i);
    if (!info) continue;
    if ((info.sof === 0xc0 || info.sof === 0xc1 || info.sof === 0xc2) && (!best || info.end - i > best.end - best.start)) {
      best = { start: i, end: info.end };
    }
    i = info.end - 1; // salta su contenido (y la miniatura que lleva dentro)
  }
  return best && u8.subarray(best.start, best.end);
}

/** Aplica la orientación EXIF del RAW si la vista previa no trae la suya. */
async function orient(bitmap, orientation) {
  if (![3, 6, 8].includes(orientation)) return bitmap;
  const swap = orientation !== 3;
  const w = swap ? bitmap.height : bitmap.width, h = swap ? bitmap.width : bitmap.height;
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d');
  g.translate(w / 2, h / 2);
  g.rotate(orientation === 3 ? Math.PI : orientation === 6 ? Math.PI / 2 : -Math.PI / 2);
  g.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();
  return c.transferToImageBitmap();
}

async function convert({ url, kind, wantBlob }) {
  const buf = await (await fetch(url)).arrayBuffer();
  if (kind === 'raw') {
    const jpg = largestJpeg(new Uint8Array(buf));
    if (!jpg) throw new Error('El RAW no contiene vista previa JPEG');
    const own = parseExif(jpg.slice().buffer);
    const outer = parseExif(buf.slice(0, 262144));
    const orientation = own?.orientation && own.orientation !== 1 ? 1 : outer?.orientation ?? 1;
    const blob = new Blob([jpg], { type: 'image/jpeg' });
    let bitmap = await orient(await createImageBitmap(blob), orientation);
    if (!wantBlob) return { bitmap };
    if (orientation === 1) { bitmap.close(); return { blob }; }
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    c.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    return { blob: await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 }) };
  }
  // HEIC / HEIF
  const lib = await heif();
  const decoder = new lib.HeifDecoder();
  const images = decoder.decode(new Uint8Array(buf));
  if (!images?.length) throw new Error('HEIC sin imágenes');
  const img = images[0];
  const w = img.get_width(), h = img.get_height();
  const data = await new Promise((resolve, reject) => {
    img.display({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }, (d) => (d ? resolve(d) : reject(new Error('HEIC ilegible'))));
  });
  const imageData = new ImageData(data.data, w, h);
  for (const i of images) i.free?.();
  if (!wantBlob) return { bitmap: await createImageBitmap(imageData) };
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d').putImageData(imageData, 0, 0);
  return { blob: await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 }) };
}

self.onmessage = async ({ data }) => {
  try {
    const out = await convert(data);
    self.postMessage({ id: data.id, ...out }, out.bitmap ? [out.bitmap] : []);
  } catch (e) {
    self.postMessage({ id: data.id, error: String(e?.message ?? e) });
  }
};
