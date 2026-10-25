// Prueba de extremo a extremo de la app de escritorio:
//   node scripts/selftest.mjs [carpeta]
//   IMUSEUM_BIN=release/linux-unpacked/imuseum node scripts/selftest.mjs [carpeta]
// Abre Electron, escanea la carpeta desde disco, entra en las salas y comprueba
// streaming por rangos, miniaturas en caché y que las obras se cargan.
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, sleep } from './lib/electron-cdp.mjs';

const folder = path.resolve(process.argv[2] ?? 'public/demo');

let app;
try {
  app = await launchApp();
  const { evaluate, relaunch } = app;
  const screenshot = (name) => app.screenshot(path.join(app.userData, `${name}.jpg`));
  const out = {};
  out.location = await evaluate('return location.href');
  out.native = await evaluate('return !!window.imuseumNative');

  out.scan = await evaluate(`
    const t0 = performance.now();
    window.__imuseumOpen(${JSON.stringify(folder)});
    while (!window.__imuseum) await new Promise(r => setTimeout(r, 100));
    const m = window.__imuseum.museum;
    return { ms: Math.round(performance.now() - t0), rooms: m.rooms.length, wings: m.wings.length, totals: m.totals, types: m.types };
  `);

  out.range = await evaluate(`
    const item = window.__imuseum.museum.rooms.flatMap(r => r.col.wall).find(i => i.type === 'video');
    const res = await fetch(item.url, { headers: { Range: 'bytes=100-199' } });
    const buf = await res.arrayBuffer();
    return { url: item.url, status: res.status, bytes: buf.byteLength, range: res.headers.get('content-range') };
  `);

  out.rooms = await evaluate(`
    const a = window.__imuseum;
    a.setMode('play');
    const results = [];
    for (const r of a.museum.rooms) {
      a.teleport(r.entry.x, r.entry.z, r.entry.yaw, r.entry.y);
      for (let i = 0; i < 40; i++) {
        await new Promise(res => setTimeout(res, 100));
        const done = r.exhibits.length && r.exhibits.every(e => e.kind !== 'image' || e.state === 'loaded' || e.state === 'error')
          && r.exhibits.every(e => e.kind !== 'video' || e.texture || e.failed);
        if (done) break;
      }
      results.push({ room: r.title, states: r.exhibits.map(e => e.kind === 'image' ? e.state : e.kind === 'video' ? (e.texture ? 'video-ok' : e.failed ? 'video-fail' : 'video-pending') : (e.duration ? 'audio-ok' : 'audio-pending')) });
    }
    return results;
  `);
  out.shot1 = await evaluate(`
    const a = window.__imuseum; const r = a.museum.rooms.find(r => r.title === 'Fractales') ?? a.museum.rooms[0];
    a.teleport(r.entry.x, r.entry.z, r.entry.yaw, r.entry.y);
    await new Promise(res => setTimeout(res, 1500)); return r.title;`);
  out.screenshot = await screenshot('sala');

  await sleep(500);
  out.thumbCache = await evaluate('return window.imuseumNative.cacheInfo()');

  // segunda pasada: las imágenes deben salir de la caché de miniaturas
  out.cachedLoad = await evaluate(`
    const a = window.__imuseum; const m = a.museum;
    const r = m.rooms.find(r => r.title === 'Fractales') ?? m.rooms[0];
    a.teleport(r.entry.x + 500, r.entry.z + 500, 0, r.entry.y);
    for (let i = 0; i < 5; i++) { m.poke(); m.update(0.016, a.camera.position); await new Promise(res => setTimeout(res, 50)); }
    const wasBuilt = r.built;
    const t0 = performance.now();
    a.teleport(r.entry.x, r.entry.z, r.entry.yaw, r.entry.y);
    while (!(r.built && r.exhibits.filter(e => e.kind === 'image').every(e => e.state === 'loaded'))) await new Promise(res => setTimeout(res, 20));
    return { destroyedWhenFar: !wasBuilt, reloadMs: Math.round(performance.now() - t0) };
  `);
  // ajustes: se cambian, se cierra la app y se comprueba que persisten
  out.settingsBefore = await evaluate(`
    const a = window.__imuseum;
    a.setSetting('maxVideos', 17);
    a.setSetting('videoDist', 55);
    a.setSetting('textureMax', 2048);
    await new Promise(res => setTimeout(res, 3000));
    return { maxVideos: a.settings.maxVideos, videoDist: a.settings.videoDist, textureMax: a.settings.textureMax };
  `);
  out.thumbCacheAfter2048 = await evaluate('return window.imuseumNative.cacheInfo()');
  // segunda carpeta para que el historial tenga dos entradas
  const second = path.join(folder, fs.readdirSync(folder, { withFileTypes: true }).find((d) => d.isDirectory()).name);
  await evaluate(`await window.imuseumNative.scan(${JSON.stringify(second)}); return true;`);
  await relaunch();
  out.recentScreenshot = await screenshot('historial');
  out.recent = await evaluate(`
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const items = () => [...document.querySelectorAll('#recentList li')].map((li) => li.title);
    const before = items();
    document.querySelector('#recentList li .remove').click();
    await sleep(300);
    const afterRemove = items();
    const storedAfterRemove = await window.imuseumNative.recentFolders();
    const btn = document.getElementById('clearRecent');
    btn.click();
    const armed = btn.textContent;
    btn.click();
    await sleep(300);
    return { before, afterRemove, storedAfterRemove, armed, afterClear: items(),
             hidden: document.getElementById('recent').hidden,
             storedAfterClear: await window.imuseumNative.recentFolders() };
  `);
  out.foldersStillOnDisk = [folder, second].every((p) => fs.existsSync(p));
  out.settingsAfterRestart = await evaluate(`
    const s = JSON.parse(localStorage.getItem('imuseum.settings.v1') ?? 'null');
    document.getElementById('startSettings').click();
    await new Promise(res => setTimeout(res, 300));
    return { stored: s && { maxVideos: s.maxVideos, videoDist: s.videoDist, textureMax: s.textureMax },
             panelVisible: !document.getElementById('settingsPanel').hidden,
             sliderMaxVideos: document.getElementById('set-maxVideos')?.value };
  `);
  out.settingsScreenshot = await screenshot('ajustes');
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error('FALLO:', e);
  process.exitCode = 1;
} finally {
  await app?.close();
}
