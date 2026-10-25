// Prueba de extremo a extremo de la app de escritorio:
//   node scripts/selftest.mjs
//   IMUSEUM_BIN=release/linux-unpacked/imuseum node scripts/selftest.mjs
// Copia la demo (y, si hay herramientas, archivos HEIC/RAW/EXIF de prueba) a una carpeta
// temporal, abre la app real y comprueba escaneo, streaming, carga de salas, cachés,
// formatos especiales, ascensores, visita guiada, mando, ajustes, historial y detección de
// cambios en la carpeta. Imprime ✓/✗ por comprobación y sale con código 1 si algo falla.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { launchApp, sleep } from './lib/electron-cdp.mjs';

const demo = path.resolve('public/demo');
if (!fs.existsSync(path.join(demo, 'manifest.json'))) {
  console.error('Falta public/demo: ejecuta antes `npm run demo`.');
  process.exit(1);
}
const work = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'imuseum-carpeta-'));
fs.cpSync(demo, work, { recursive: true });
fs.rmSync(path.join(work, 'manifest.json'));
const fixtures = spawnSync('bash', ['scripts/make-fixtures.sh', path.join(work, 'Formatos'), path.join(demo, 'Fractales/Mandelbrot 2.jpg')], { encoding: 'utf8' });
const haveFixtures = fixtures.status === 0;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

let app;
try {
  app = await launchApp();
  const { evaluate, relaunch } = app;
  const shotDir = path.join(app.userData, 'capturas');
  fs.mkdirSync(shotDir, { recursive: true });
  const shot = (name) => app.screenshot(path.join(shotDir, `${name}.jpg`));
  const open = (dir) => evaluate(`
    window.__imuseum = null;
    const t0 = performance.now();
    window.__imuseumOpen(${JSON.stringify(dir)});
    while (!window.__imuseum) await new Promise((r) => setTimeout(r, 50));
    const m = window.__imuseum.museum;
    return { ms: Math.round(performance.now() - t0), rooms: m.rooms.length, items: m.rooms.reduce((n, r) => n + r.col.wall.length + r.col.audio.length, 0) };
  `);

  check('App de escritorio con puente nativo', await evaluate('return location.href.startsWith("imuseum://") && !!window.imuseumNative'));
  const info = await evaluate('return window.imuseumNative.appInfo()');
  check('Versión de la app', info.version, info.version);

  // ---------------------------------------------------------------- escaneo y carga
  const first = await open(work);
  check('Escaneo completo de la carpeta', first.rooms > 0, `${first.items} obras en ${first.rooms} salas, ${first.ms} ms`);

  const range = await evaluate(`
    const item = window.__imuseum.museum.rooms.flatMap((r) => r.col.wall).find((i) => i.type === 'video');
    const res = await fetch(item.url, { headers: { Range: 'bytes=100-199' } });
    return { status: res.status, bytes: (await res.arrayBuffer()).byteLength };
  `);
  check('Streaming por rangos (206)', range.status === 206 && range.bytes === 100);

  const rooms = await evaluate(`
    const a = window.__imuseum;
    a.setMode('play');
    const out = [];
    for (const r of a.museum.rooms) {
      a.teleport(r.entry.x, r.entry.z, r.entry.yaw, r.entry.y);
      for (let i = 0; i < 80; i++) {
        await new Promise((res) => setTimeout(res, 100));
        const done = r.exhibits.length && r.exhibits.every((e) => e.kind !== 'image' || e.state === 'loaded' || e.state === 'error')
          && r.exhibits.every((e) => e.kind !== 'video' || e.texture || e.failed);
        if (done) break;
      }
      await new Promise((res) => setTimeout(res, 1500)); // deja tiempo a EXIF y fotogramas de video
      out.push({ room: r.title, ex: r.exhibits.map((e) => ({ name: e.item.name, kind: e.kind, state: e.state ?? (e.texture ? 'ok' : e.duration ? 'ok' : 'pendiente'), exif: e.item.exif ?? null, aspect: e.aspect, poster: !!e.item.posterSaved })) });
    }
    return out;
  `);
  const all = rooms.flatMap((r) => r.ex);
  check('Todas las obras cargan', all.every((e) => e.state === 'loaded' || e.state === 'ok'), `${all.length} obras`);
  check('Fotogramas de video guardados', all.filter((e) => e.kind === 'video').every((e) => e.poster));
  const exifOf = (n) => all.find((e) => e.name === n)?.exif;
  check('EXIF de JPEG', exifOf('Mandelbrot 1.jpg')?.camera === 'Canon EOS R6', exifOf('Mandelbrot 1.jpg') && `${exifOf('Mandelbrot 1.jpg').camera} ${exifOf('Mandelbrot 1.jpg').fNumber}`);
  check('HEIC convertido y con EXIF', all.find((e) => e.name.endsWith('.heic'))?.state === 'loaded' && exifOf('Mandelbrot 3 (HEIC).heic')?.camera?.includes('iPhone'));
  if (haveFixtures) {
    const nef = all.find((e) => e.name === 'prueba.nef');
    check('RAW: vista previa incrustada, orientación y EXIF', nef?.state === 'loaded' && nef.aspect < 1 && nef.exif?.camera === 'NIKON Z 6II',
      nef && `aspecto ${nef.aspect?.toFixed(2)}, ${nef.exif?.camera}`);
  } else {
    console.log('– Sin magick/exiftool/heif-enc: se omiten las pruebas de RAW');
  }
  await evaluate(`
    const a = window.__imuseum, r = a.museum.rooms.find((r) => r.title === 'Fractales');
    const p = r.placed.find((p) => p.item.name === 'Mandelbrot 1.jpg');
    const nx = Math.sin(p.rotY), nz = Math.cos(p.rotY), s = r.t.flip ? -1 : 1;
    const [x, z] = r.t.flip ? [r.t.px - p.x - nx * 1.2, r.t.pz - p.z - nz * 1.2] : [r.t.px + p.x + nx * 1.2, r.t.pz + p.z + nz * 1.2];
    a.teleport(x, z, Math.atan2(nx * s, nz * s), r.t.py + p.y - 1.8);
    a.camera.rotation.x = -0.35;
    await new Promise((res) => setTimeout(res, 1200));
    return true;`);
  await shot('cartela-exif');

  const cache = await evaluate('return window.imuseumNative.cacheInfo()');
  check('Caché de miniaturas y escaneo guardado', cache.count > 0 && cache.scans.count === 1, `${cache.count} miniaturas, ${cache.scans.count} escaneo`);

  // ---------------------------------------------------------------- ascensores
  const elevator = await evaluate(`
    const a = window.__imuseum;
    a.setSetting('wingsPerFloor', 4);
    const base = a.museum.rooms.flatMap((r) => r.col.wall).filter((i) => i.type === 'image').slice(0, 6);
    const items = [];
    for (let t = 0; t < 12; t++) for (let d = 0; d < 4; d++) for (const it of base) items.push({ ...it, url: it.url, dir: 'Tema ' + t + '/Sala ' + d });
    window.__imuseum = null;
    window.__imuseumBuild({ rootName: 'Pisos', items });
    while (!window.__imuseum) await new Promise((r) => setTimeout(r, 50));
    const m = window.__imuseum.museum;
    a.setMode('play');
    const stop = m.elevatorStop(m.floors[0]);
    window.__imuseum.teleport(stop.x, stop.z, stop.yaw, stop.y);
    await new Promise((r) => setTimeout(r, 500));
    const hint = document.getElementById('focusTitle').textContent;
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    await new Promise((r) => setTimeout(r, 300));
    const listed = document.querySelectorAll('#elevatorList li').length;
    dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2' }));
    await new Promise((r) => setTimeout(r, 900));
    return { floors: m.floors.length, hint, listed, riding: !document.getElementById('ride').hidden };
  `);
  await shot('ascensor');
  await sleep(2500);
  const arrived = await evaluate('return { feet: window.__imuseum.player.feet, floor: window.__imuseum.museum.floorAt(window.__imuseum.player.feet).index }');
  check('Galería en pisos con ascensor', elevator.floors === 3 && elevator.hint === 'Ascensor' && elevator.listed === 3 && elevator.riding && arrived.floor === 2,
    `${elevator.floors} pisos, llegada al piso ${arrived.floor} (y=${arrived.feet})`);
  await evaluate("window.__imuseum.setSetting('wingsPerFloor', 16); return true;");

  // ---------------------------------------------------------------- visita guiada y mando
  await open(work);
  const tour = await evaluate(`
    const a = window.__imuseum;
    a.setSetting('tourSeconds', 2);
    a.setMode('paused');
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' }));
    const seen = new Set();
    for (let i = 0; i < 16; i++) { await new Promise((r) => setTimeout(r, 500)); seen.add(document.getElementById('tourWhat').textContent); }
    return { stops: seen.size, bar: !document.getElementById('tourBar').hidden };
  `);
  await shot('visita-guiada');
  const tourEnd = await evaluate(`
    dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    await new Promise((r) => setTimeout(r, 500));
    window.__imuseum.setSetting('tourSeconds', 5);
    return { paused: !document.getElementById('pause').hidden, feet: window.__imuseum.player.feet };
  `);
  check('Visita guiada avanza sola y se puede salir', tour.bar && tour.stops >= 3 && tourEnd.paused && Number.isFinite(tourEnd.feet), `${tour.stops} paradas en 8 s`);

  const pad = await evaluate(`
    const pad = { connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad], configurable: true });
    const a = window.__imuseum;
    a.setMode('paused');
    await new Promise((r) => setTimeout(r, 200));
    pad.buttons[0].pressed = true; await new Promise((r) => setTimeout(r, 150)); pad.buttons[0].pressed = false;
    await new Promise((r) => setTimeout(r, 200));
    const p0 = a.camera.position.clone();
    pad.axes[1] = -1; await new Promise((r) => setTimeout(r, 1000)); pad.axes[1] = 0;
    return { padMode: a.player.padMode, moved: a.camera.position.distanceTo(p0) };
  `);
  check('Mando: entrar con A y caminar con el stick', pad.padMode && pad.moved > 1, `${pad.moved.toFixed(2)} m`);

  // ---------------------------------------------------------------- actualizaciones
  const upd = await evaluate('return window.imuseumNative.checkUpdate()');
  check('Comprobación de actualizaciones sin errores de la app', ['current', 'available', 'error', 'dev'].includes(upd.status),
    `${upd.status}${upd.latest ? ` (última ${upd.latest})` : ''}${upd.error ? `: ${upd.error.split('\n')[0].slice(0, 90)}` : ''}`);

  // ---------------------------------------------------------------- ajustes que persisten
  await evaluate(`
    const a = window.__imuseum;
    a.setSetting('maxVideos', 17); a.setSetting('videoDist', 55); a.setSetting('hallSlopes', 80);
    return true;`);

  // ---------------------------------------------------------------- reabrir desde el escaneo guardado
  await relaunch();
  const reopen = await open(work);
  const fromCache = await evaluate(`
    for (let i = 0; i < 60 && !/Sin cambios|cambió/.test(document.getElementById('scanChip').textContent); i++) await new Promise((r) => setTimeout(r, 100));
    return { chip: document.getElementById('scanChip').textContent };
  `);
  check('Reabrir desde el escaneo guardado', /Sin cambios/.test(fromCache.chip), `${reopen.ms} ms (el primero tardó ${first.ms} ms) · «${fromCache.chip}»`);

  const persisted = await evaluate(`
    const s = JSON.parse(localStorage.getItem('imuseum.settings.v1') ?? 'null');
    return s && { maxVideos: s.maxVideos, videoDist: s.videoDist, hallSlopes: s.hallSlopes };`);
  check('Ajustes persisten tras reiniciar', persisted?.maxVideos === 17 && persisted.videoDist === 55 && persisted.hallSlopes === 80);

  const posters = await evaluate(`
    const a = window.__imuseum, m = a.museum, r = m.rooms.find((r) => r.title === 'Videos');
    // distancia de reproducción mínima: desde la entrada la sala se construye pero sus pantallas no se activan
    a.setSetting('videoDist', 8);
    a.setMode('play');
    a.teleport(m.spawn.x, m.spawn.z, m.spawn.yaw, m.spawn.y);
    for (let i = 0; i < 40 && !(r.built && r.exhibits.every((e) => e.poster)); i++) { m.poke(); await new Promise((res) => setTimeout(res, 150)); }
    const out = { built: r.built, active: r.exhibits.some((e) => e.active), shown: r.exhibits.filter((e) => e.poster && e.screen.material.map === e.poster).length, total: r.exhibits.length };
    a.setSetting('videoDist', 55);
    return out;
  `);
  check('Pantallas lejanas muestran su fotograma (desde la caché)', posters.built && !posters.active && posters.shown === posters.total && posters.total > 0,
    `${posters.shown}/${posters.total} pantallas`);

  // ---------------------------------------------------------------- cambios en la carpeta
  fs.copyFileSync(path.join(work, 'Bienvenida.jpg'), path.join(work, 'Fractales', 'Nueva.jpg'));
  fs.mkdirSync(path.join(work, 'Recién llegada'));
  fs.copyFileSync(path.join(work, 'Retrato.jpg'), path.join(work, 'Recién llegada', 'Otra.jpg'));
  fs.rmSync(path.join(work, 'Retrato.jpg'));
  await sleep(200);
  await open(work);
  const change = await evaluate(`
    for (let i = 0; i < 80 && !/cambió/.test(document.getElementById('scanChip').textContent); i++) await new Promise((r) => setTimeout(r, 100));
    const chip = document.getElementById('scanChip').textContent;
    const before = window.__imuseum.museum.rooms.reduce((n, r) => n + r.col.wall.length, 0);
    window.__imuseum.setMode('paused');
    dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyU' }));
    await new Promise((r) => setTimeout(r, 1200));
    const m = window.__imuseum.museum;
    return { chip, before, after: m.rooms.reduce((n, r) => n + r.col.wall.length, 0), newRoom: m.rooms.some((r) => r.title === 'Recién llegada') };
  `);
  check('Detecta cambios y actualiza el museo con U', /\+2/.test(change.chip) && /−1/.test(change.chip) && change.after === change.before + 1 && change.newRoom,
    `«${change.chip}» · ${change.before} → ${change.after} obras`);

  // ---------------------------------------------------------------- historial
  await evaluate('setTimeout(() => location.reload(), 50); return true;');
  await sleep(2500);
  const hist = await evaluate(`
    const items = () => [...document.querySelectorAll('#recentList li')].map((li) => li.title);
    const before = items();
    const btn = document.getElementById('clearRecent');
    btn.click(); btn.click();
    await new Promise((r) => setTimeout(r, 400));
    return { before, after: items(), cache: await window.imuseumNative.cacheInfo() };
  `);
  check('Borrar historial también olvida los escaneos', hist.before.length >= 1 && hist.after.length === 0 && hist.cache.scans.count === 0 && fs.existsSync(work),
    `${hist.before.length} → ${hist.after.length}; la carpeta sigue en disco`);
} catch (e) {
  console.error('FALLO:', e);
  results.push({ name: 'excepción', ok: false });
} finally {
  await app?.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
if (app) console.log(`capturas en ${path.join(app.userData, 'capturas')}`);
process.exitCode = failed.length ? 1 : 0;
