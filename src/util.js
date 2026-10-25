export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function extOf(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function stripExt(name) {
  const i = name.lastIndexOf('.');
  return i <= 0 ? name : name.slice(0, i);
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

export function formatDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('es', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDuration(sec) {
  if (!Number.isFinite(sec)) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

export function countsLabel({ image = 0, video = 0, audio = 0 }) {
  const parts = [];
  if (image) parts.push(plural(image, 'imagen', 'imágenes'));
  if (video) parts.push(plural(video, 'video', 'videos'));
  if (audio) parts.push(plural(audio, 'audio', 'audios'));
  return parts.join(' · ');
}
