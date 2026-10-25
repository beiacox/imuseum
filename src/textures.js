import * as THREE from 'three';
import { rng, stripExt, extOf, formatSize, formatDate } from './util.js';
import { conversionKind, decodeConverted } from './convert.js';
import { exifSummary } from './exif.js';

const FONT = 'Inter, "Segoe UI", system-ui, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas, repeat = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function disposeTexture(t) {
  if (!t) return;
  t.dispose();
  t.image?.close?.();
}

export function fitText(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

function wrapText(g, text, maxW, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = fitText(g, lines[maxLines - 1] + '…', maxW);
  }
  return lines;
}

// ---------- Materiales procedurales ----------

export function makeWoodTexture() {
  const S = 512, c = makeCanvas(S, S), g = c.getContext('2d'), r = rng(11);
  const planks = 6, pw = S / planks;
  for (let i = 0; i < planks; i++) {
    let y = -r() * 300;
    while (y < S) {
      const len = 200 + r() * 220;
      const b = 0.78 + r() * 0.32;
      g.fillStyle = `rgb(${(132 * b) | 0},${(88 * b) | 0},${(54 * b) | 0})`;
      g.fillRect(i * pw, y, pw, len);
      g.strokeStyle = 'rgba(50,25,10,0.18)';
      g.lineWidth = 1.2;
      for (let k = 0; k < 9; k++) {
        const gx = i * pw + 4 + r() * (pw - 8);
        g.beginPath();
        g.moveTo(gx, y);
        g.bezierCurveTo(gx + (r() - 0.5) * 12, y + len / 3, gx + (r() - 0.5) * 12, y + (2 * len) / 3, gx + (r() - 0.5) * 6, y + len);
        g.stroke();
      }
      g.fillStyle = 'rgba(20,10,5,0.55)';
      g.fillRect(i * pw, y, pw, 2);
      y += len;
    }
    g.fillStyle = 'rgba(20,10,5,0.6)';
    g.fillRect(i * pw, 0, 2, S);
  }
  return toTexture(c, true);
}

export function makePlasterTexture() {
  const S = 256, c = makeCanvas(S, S), g = c.getContext('2d'), r = rng(5);
  const img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = 236 + (r() - 0.5) * 14;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, true);
}

export function makeTileTexture() {
  const S = 512, c = makeCanvas(S, S), g = c.getContext('2d'), r = rng(23);
  const n = 2, ts = S / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const b = 0.93 + r() * 0.07;
    const dark = (i + j) % 2 === 1;
    const base = dark ? [70, 66, 62] : [214, 208, 198];
    g.fillStyle = `rgb(${(base[0] * b) | 0},${(base[1] * b) | 0},${(base[2] * b) | 0})`;
    g.fillRect(i * ts, j * ts, ts, ts);
    g.strokeStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(90,80,70,0.18)';
    for (let k = 0; k < 5; k++) {
      g.lineWidth = 0.5 + r() * 1.5;
      g.beginPath();
      let x = i * ts + r() * ts, y = j * ts;
      g.moveTo(x, y);
      for (let s = 0; s < 6; s++) { x += (r() - 0.5) * 50; y += ts / 6; g.lineTo(x, y); }
      g.stroke();
    }
    g.fillStyle = 'rgba(30,25,20,0.5)';
    g.fillRect(i * ts, j * ts, ts, 3);
    g.fillRect(i * ts, j * ts, 3, ts);
  }
  return toTexture(c, true);
}

let haloTexture;
/** Degradado radial centrado: halo de luz que emite una obra sobre pared y suelo. */
export function getHaloTexture() {
  if (haloTexture) return haloTexture;
  const S = 256, c = makeCanvas(S, S), g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.6)');
  grad.addColorStop(0.65, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  haloTexture = toTexture(c);
  return haloTexture;
}

const sampleCanvas = makeCanvas(8, 8);
const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
const hsl = {};

/**
 * Color medio de una imagen o fotograma de video, realzado para usarlo como luz.
 * Escribe el color en `out` y devuelve la intensidad (0–1, menor si la imagen es oscura),
 * o -1 si no se pudo leer.
 */
export function sampleColor(source, out) {
  let d;
  try {
    sampleCtx.drawImage(source, 0, 0, 8, 8);
    d = sampleCtx.getImageData(0, 0, 8, 8).data;
  } catch {
    return -1;
  }
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < 64; i++) { r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; }
  r /= 64 * 255; g /= 64 * 255; b /= 64 * 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  out.setRGB(r, g, b, THREE.SRGBColorSpace);
  out.getHSL(hsl, THREE.SRGBColorSpace);
  out.setHSL(hsl.h, Math.min(1, hsl.s * 1.5 + 0.06), 0.55, THREE.SRGBColorSpace);
  return 0.3 + 0.7 * Math.sqrt(lum);
}

// ---------- Textos ----------

export const PLAQUE_ASPECT = 512 / 160;

export function makePlaqueTexture(item, extra = '') {
  const W = 512, H = 160, c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#f3efe6';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#b9ae98';
  g.lineWidth = 4;
  g.strokeRect(2, 2, W - 4, H - 4);
  g.fillStyle = '#1d1a16';
  g.font = `600 36px ${SERIF}`;
  g.textBaseline = 'top';
  g.fillText(fitText(g, stripExt(item.name), W - 48), 24, 26);
  g.fillStyle = '#6d6455';
  g.font = `400 23px ${FONT}`;
  const taken = item.exif?.date ? formatDate(item.exif.date.getTime()) : formatDate(item.mtime);
  const meta = [extOf(item.name).toUpperCase(), formatSize(item.size), taken].filter(Boolean).join(' · ');
  extra ||= exifSummary(item.exif);
  g.fillText(fitText(g, meta, W - 48), 24, 82);
  if (extra) {
    g.fillStyle = '#8a6d2e';
    g.fillText(fitText(g, extra, W - 48), 24, 116);
  }
  return toTexture(c);
}

export function makeSignTexture(title, subtitle) {
  const W = 768, H = 192, c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#16130f';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#a8894a';
  g.lineWidth = 5;
  g.strokeRect(10, 10, W - 20, H - 20);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#e8d5a6';
  g.font = `600 64px ${SERIF}`;
  g.fillText(fitText(g, title, W - 70), W / 2, 78);
  g.fillStyle = '#b8a888';
  g.font = `400 28px ${FONT}`;
  g.fillText(fitText(g, subtitle, W - 70), W / 2, 142);
  return toTexture(c);
}

export function makeEntranceTexture(title, lines) {
  const W = 1024, H = 512, c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#16130f';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#a8894a';
  g.lineWidth = 6;
  g.strokeRect(16, 16, W - 32, H - 32);
  g.textAlign = 'center';
  g.fillStyle = '#b8a888';
  g.font = `400 30px ${FONT}`;
  g.fillText('M U S E O   V I R T U A L', W / 2, 92);
  g.fillStyle = '#efdcae';
  g.font = `600 92px ${SERIF}`;
  g.fillText(fitText(g, title, W - 100), W / 2, 205);
  g.fillStyle = '#d9cdb3';
  g.font = `400 32px ${FONT}`;
  lines.forEach((l, i) => g.fillText(fitText(g, l, W - 100), W / 2, 290 + i * 50));
  return toTexture(c);
}

export function makeMessageTexture(text, sub = '') {
  const W = 512, H = 288, c = makeCanvas(W, H), g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#24211d');
  grad.addColorStop(1, '#121110');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#e9e1d0';
  g.font = `500 30px ${FONT}`;
  const lines = wrapText(g, text, W - 60, 3);
  const y0 = H / 2 - ((lines.length - 1) * 38) / 2 - (sub ? 16 : 0);
  lines.forEach((l, i) => g.fillText(l, W / 2, y0 + i * 38));
  if (sub) {
    g.fillStyle = '#9b927f';
    g.font = `400 22px ${FONT}`;
    g.fillText(fitText(g, sub, W - 60), W / 2, y0 + lines.length * 38 + 10);
  }
  return toTexture(c);
}

// ---------- Imágenes del usuario ----------

function fitSize(w, h, max) {
  const s = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

async function bitmapTexture(bmp) {
  const color = new THREE.Color();
  const level = sampleColor(bmp, color);
  // ImageBitmap ignora flipY en WebGL: se voltea al crear el bitmap final
  const flipped = await createImageBitmap(bmp, { imageOrientation: 'flipY' });
  const tex = new THREE.Texture(flipped);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  tex.userData.aspect = bmp.width / bmp.height;
  tex.userData.color = color;
  tex.userData.level = Math.max(0, level);
  return tex;
}

async function fetchBlob(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

/**
 * Carga una imagen reducida a `max` px. En la app de escritorio usa primero la
 * miniatura en caché (disco); si no existe, decodifica el original fuera del hilo
 * principal y guarda la miniatura para la próxima vez.
 */
export async function loadImageTexture(item, max, saveThumb) {
  if (item.thumbURL) {
    try {
      const res = await fetch(`${item.thumbURL}?s=${max}`);
      if (res.ok) {
        const bmp = await createImageBitmap(await res.blob());
        const tex = await bitmapTexture(bmp);
        bmp.close();
        return tex;
      }
    } catch { /* sin miniatura: se genera abajo */ }
  }

  let full, size = item.size;
  if (conversionKind(item.name)) {
    full = await decodeConverted(item); // HEIC / RAW, en el worker
  } else {
    const blob = await fetchBlob(item.url);
    size = blob.size;
    try {
      full = await createImageBitmap(blob);
    } catch {
      return loadViaImageElement(item.url, max); // SVG y similares
    }
  }
  const [w, h] = fitSize(full.width, full.height, max);
  const small = await createImageBitmap(full, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  const downscaled = w < full.width || h < full.height;
  full.close();

  if (saveThumb && item.thumbURL && (downscaled || size > 400_000)) {
    try {
      const c = new OffscreenCanvas(w, h);
      c.getContext('2d').drawImage(small, 0, 0);
      const out = await c.convertToBlob({ type: 'image/webp', quality: 0.86 });
      saveThumb(item.id, await out.arrayBuffer(), max);
    } catch (e) { console.warn('Miniatura no guardada', e); }
  }

  const tex = await bitmapTexture(small);
  small.close();
  return tex;
}

async function loadViaImageElement(url, max) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  const [w, h] = fitSize(img.naturalWidth || max, img.naturalHeight || max, max);
  const c = makeCanvas(w, h);
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  const tex = toTexture(c);
  tex.userData.aspect = w / h;
  tex.userData.color = new THREE.Color();
  tex.userData.level = Math.max(0, sampleColor(c, tex.userData.color));
  return tex;
}
