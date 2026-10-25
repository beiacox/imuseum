// Genera las capturas de docs/screenshots con la app de escritorio real.
//   npm run demo                       (una vez: crea public/demo con ffmpeg)
//   npm run build && node scripts/screenshots.mjs
//   IMUSEUM_BIN=release/linux-unpacked/imuseum node scripts/screenshots.mjs
// Usa una carpeta de datos temporal, así no aparecen carpetas recientes ni ajustes propios.
import path from 'node:path';
import fs from 'node:fs';
import { launchApp, sleep } from './lib/electron-cdp.mjs';

const OUT = path.resolve('docs/screenshots');
const W = 1600, H = 900;
fs.mkdirSync(OUT, { recursive: true });

const app = await launchApp();
const { evaluate, send } = app;
const shot = async (name) => {
  const file = await app.screenshot(path.join(OUT, `${name}.jpg`));
  console.log('✓', path.relative(process.cwd(), file));
};

try {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await sleep(800);
  await shot('01-inicio');

  // Museo de muestra: la multimedia de la demo repartida en carpetas de distintos tamaños
  // para que aparezcan todos los tipos de sala.
  const summary = await evaluate(`
    const manifest = await (await fetch('demo/manifest.json')).json();
    const demo = { items: await Promise.all(manifest.files.map(async (p) => {
      const blob = await (await fetch('demo/' + p)).blob();
      const name = p.split('/').pop();
      const ext = name.split('.').pop().toLowerCase();
      const type = ['mp4', 'webm', 'mov'].includes(ext) ? 'video' : ['mp3', 'ogg', 'wav', 'opus'].includes(ext) ? 'audio' : 'image';
      return { type, name, size: blob.size, mtime: Date.now(), url: URL.createObjectURL(blob) };
    })) };
    const by = (t) => demo.items.filter((i) => i.type === t);
    const imgs = by('image'), vids = by('video'), auds = by('audio');
    const folders = [
      ['Viajes/Japón 2024', 22, 2, 0], ['Viajes/Islandia', 45, 3, 0], ['Viajes/Marruecos', 12, 1, 0],
      ['Viajes/Patagonia', 30, 1, 3], ['Familia/Navidad', 60, 2, 0], ['Familia/Cumpleaños', 18, 0, 4],
      ['Familia/Vacaciones', 90, 4, 0], ['Arte/Fractales', 8, 0, 0], ['Arte/Patrones', 40, 1, 2],
      ['Arte/Geometría', 26, 0, 0], ['Arte/Videoarte', 6, 6, 0], ['Música/Conciertos', 6, 1, 6],
      ['Arte/Retratos', 70, 3, 0], ['Viajes/Lisboa', 14, 0, 0], ['Arte/Esculturas', 20, 0, 0],
      ['Arte/Grabados', 34, 0, 0], ['Viajes/Roma', 28, 0, 0], ['Familia/Bodas', 24, 0, 0], ['Viajes/Kioto', 16, 0, 0], ['Arte/Instalaciones', 10, 0, 0],
    ];
    const items = [];
    for (const [dir, ni, nv, na] of folders) {
      for (let i = 0; i < ni; i++) { const s = imgs[i % imgs.length]; items.push({ ...s, url: s.url, name: 'Foto ' + (i + 1) + '.jpg', dir }); }
      for (let i = 0; i < nv; i++) { const s = vids[i % vids.length]; items.push({ ...s, url: s.url, name: 'Video ' + (i + 1) + '.mp4', dir }); }
      for (let i = 0; i < na; i++) { const s = auds[i % auds.length]; items.push({ ...s, url: s.url, name: 'Pista ' + (i + 1) + '.mp3', dir }); }
    }
    window.__showcase = { rootName: 'Mis recuerdos', items };
    window.__imuseumBuild(window.__showcase);
    while (!window.__imuseum) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 600));
    return window.__imuseum.museum.types;
  `);
  console.log('tipos de sala:', summary);

  // ayudante para colocar la cámara en coordenadas locales de una sala
  await evaluate(`
    const a = window.__imuseum, m = a.museum;
    const apply = (t, x, z) => (t.flip ? [t.px - x, t.pz - z] : [t.px + x, t.pz + z]);
    const yawToward = (t, dx, dz) => { const s = t.flip ? -1 : 1; return Math.atan2(-dx * s, -dz * s); };
    window.__place = async (target, { lx, lz, dx, dz, dy = 0, pitch = 0, wait = 3500, mode = 'play' }) => {
      if (!target) throw new Error('SIN_SALA');
      a.setMode(mode);
      const [x, z] = apply(target.t, lx, lz);
      a.teleport(x, z, yawToward(target.t, dx, dz), target.t.py + dy);
      a.camera.rotation.x = pitch;
      await new Promise((r) => setTimeout(r, wait));
    };
    window.__room = (pred) => m.rooms.find(pred);
    return true;
  `);

  const views = [
    ['02-doble-altura', `const r = __room((r) => r.arch === 'mezzanine'); await __place(r, { lx: 3, lz: 2.2, dx: 1, dz: 1.35, pitch: 0.12 });`],
    ['03-entreplanta', `const r = __room((r) => r.arch === 'mezzanine'); await __place(r, { lx: 1.6, lz: r.D - 2, dx: 1, dz: -0.9, dy: 4.4, pitch: -0.3 });`],
    ['04-sala-hundida', `const r = __room((r) => r.arch === 'sunken'); await __place(r, { lx: r.W / 2, lz: 1.3, dx: 0, dz: 1, pitch: -0.26 });`],
    ['05-torre', `const r = __room((r) => r.arch === 'tower3') ?? __room((r) => r.arch === 'tower2'); await __place(r, { lx: 2, lz: 2, dx: 1, dz: 0.75, pitch: 0.18 });`],
    ['06-sala-de-paneles', `const r = __room((r) => r.arch === 'panels'); await __place(r, { lx: 1.3, lz: 1.6, dx: 1, dz: 1.1, pitch: 0.05 });`],
    ['07-videos', `
      const r = window.__imuseum.museum.rooms.slice().sort((x, y) => y.col.counts.video - x.col.counts.video)[0];
      const v = r.placed.find((p) => p.item.type === 'video');
      const nx = Math.sin(v.rotY), nz = Math.cos(v.rotY);
      await __place(r, { lx: v.x + nx * 5.5 + nz * 1.6, lz: v.z + nz * 5.5 - nx * 1.6, dx: -nx - nz * 0.3, dz: -nz + nx * 0.3, dy: v.y - 2, pitch: -0.05, wait: 5000 });`],
    ['08-gramofonos', `
      const r = __room((r) => r.pedestals.length >= 4);
      const p = r.pedestals[0];
      await __place(r, { lx: p.x + 1.8, lz: p.z - 3.4, dx: -0.35, dz: 1, dy: p.y, pitch: -0.2, wait: 2500 });
      const listener = window.__imuseum.camera.children.find((c) => c.type === 'AudioListener');
      await listener.context.resume();
      r.exhibits.filter((e) => e.kind === 'audio').slice(0, 2).forEach((e) => e.toggle(listener));
      await new Promise((res) => setTimeout(res, 2500));`],
    ['09-pasillo', `
      const w = window.__imuseum.museum.wings.find((w) => w.layout.stairs.length) ?? window.__imuseum.museum.wings[0];
      const st = w.layout.stairs[0];
      await __place(w, { lx: st ? st.x0 - 7 : 3, lz: 0.9, dx: 1, dz: -0.04, dy: st ? st.from : 0, pitch: -0.06 });`],
    ['10-galeria-principal', `const a = window.__imuseum, m = a.museum; a.setMode('play'); a.teleport(-1.5, m.spawn.z + 5, m.spawn.yaw + 0.22, 0); a.camera.rotation.x = 0.1; await new Promise((r) => setTimeout(r, 3000));`],
  ];
  for (const [name, code] of views) {
    try {
      await evaluate(code + '\nreturn true;');
    } catch (e) {
      if (String(e).includes('SIN_SALA') || String(e).includes("reading 't'")) { console.log('–', name, '(no hay sala de ese tipo)'); continue; }
      throw e;
    }
    await shot(name);
  }

  // visor a pantalla completa: mirar un cuadro de cerca y pulsar E
  await evaluate(`
    // la 4.ª foto de cada carpeta es un Mandelbrot de la demo
    const r = __room((r) => r.title === 'Fractales') ?? __room((r) => r.placed.some((p) => p.item.type === 'image'));
    const p = r.placed.find((p) => p.item.name === 'Foto 4.jpg') ?? r.placed.find((p) => p.item.type === 'image');
    const nx = Math.sin(p.rotY), nz = Math.cos(p.rotY);
    await __place(r, { lx: p.x + nx * 2.4, lz: p.z + nz * 2.4, dx: -nx, dz: -nz, dy: p.y - 1.8, pitch: 0.05, wait: 3000 });
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    await new Promise((r) => setTimeout(r, 1500));
    return true;`);
  await shot('11-visor');

  // directorio de salas (Tab)
  await evaluate(`
    dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    window.__imuseum.setMode('play');
    dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab' }));
    await new Promise((r) => setTimeout(r, 1000));
    return true;`);
  await shot('12-directorio');

  // visita guiada: empieza en la sala de doble altura y se captura delante de la primera obra
  await evaluate(`
    dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    const a = window.__imuseum, r = __room((r) => r.arch === 'mezzanine');
    a.setSetting('tourSeconds', 8);
    await __place(r, { lx: r.W / 2, lz: 3, dx: 0, dz: 1, wait: 800 });
    a.setMode('paused');
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' }));
    await new Promise((res) => setTimeout(res, 6500));
    return true;`);
  await shot('14-visita-guiada');
  await evaluate(`
    dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    window.__imuseum.setSetting('tourSeconds', 5);
    return true;`);

  // ascensor: la misma muestra con 4 alas por piso → galería de varios pisos
  await evaluate(`
    window.__imuseum.setSetting('wingsPerFloor', 4);
    window.__imuseum = null;
    // más carpetas de primer nivel (una por año) para llenar varios pisos de la galería
    const base = window.__showcase.items.filter((i) => i.type === 'image').slice(0, 10);
    const years = [];
    for (let y = 2012; y < 2026; y++) for (let d = 0; d < 4; d++) for (const it of base) years.push({ ...it, url: it.url, dir: y + '/Álbum ' + (d + 1) });
    window.__imuseumBuild({ rootName: 'Mis recuerdos', items: years });
    while (!window.__imuseum) await new Promise((r) => setTimeout(r, 50));
    const a = window.__imuseum, m = a.museum;
    a.setMode('play');
    const stop = m.elevatorStop(m.floors[0]);
    a.teleport(stop.x, stop.z - 0.6, 0, stop.y);
    a.camera.rotation.x = 0.12;
    await new Promise((r) => setTimeout(r, 1500));
    a.teleport(stop.x, stop.z, stop.yaw, stop.y);
    await new Promise((r) => setTimeout(r, 400));
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    await new Promise((r) => setTimeout(r, 800));
    return m.floors.length;`);
  await shot('15-ascensor');
  await evaluate(`
    dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    window.__imuseum.setSetting('wingsPerFloor', 16);
    return true;`);

  // ajustes
  await evaluate(`
    window.__imuseum.setMode('paused');
    document.getElementById('pauseSettings').click();
    await new Promise((r) => setTimeout(r, 800));
    return true;`);
  await shot('13-ajustes');
} catch (e) {
  console.error('FALLO:', e);
  process.exitCode = 1;
} finally {
  await app.close();
}
