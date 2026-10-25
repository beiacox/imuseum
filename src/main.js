import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  native, supportsPicker, scanNative, rescanNative, scanDirectoryHandle, scanFileList, buildCollections, loadDemo,
} from './scanner.js';
import { Museum } from './museum.js';
import { Player } from './player.js';
import { Minimap } from './minimap.js';
import { ArtLights } from './lighting.js';
import { GamepadInput, BTN } from './gamepad.js';
import { GuidedTour } from './tour.js';
import { EYE_H } from './config.js';
import { SCHEMA, settings, setSetting, resetSettings, onSettingsChange, REBUILD_KEYS } from './settings.js';
import { countsLabel, formatSize, formatDate, plural } from './util.js';
import { displayURL, readExif, conversionKind } from './convert.js';
import { exifSummary } from './exif.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ escena

const renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0c0b);
scene.fog = new THREE.Fog(0x0d0c0b, 24, 60);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
const hemi = new THREE.HemisphereLight(0xfff4e5, 0x2a241e, 1.3);
scene.add(hemi);

const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.1, 160);
const listener = new THREE.AudioListener();
camera.add(listener);
scene.add(camera);

const player = new Player(camera, renderer.domElement);
const artLights = new ArtLights(scene);
const gamepad = new GamepadInput();
let tour = null;

// ------------------------------------------------------------------ ajustes aplicados en vivo

function applySettings(key) {
  const all = !key;
  if (all || key === 'renderScale') {
    renderer.setPixelRatio(Math.min(settings.renderScale, devicePixelRatio * 1.25));
    renderer.setSize(innerWidth, innerHeight);
  }
  if (all || key === 'viewDist') {
    scene.fog.near = settings.viewDist * 0.4;
    scene.fog.far = settings.viewDist;
    camera.far = settings.viewDist + 30;
    camera.updateProjectionMatrix();
  }
  if (all || key === 'fov') { camera.fov = settings.fov; camera.updateProjectionMatrix(); }
  if (all || key === 'mouseSpeed') player.controls.pointerSpeed = settings.mouseSpeed;
  if (all || key === 'volume') listener.setMasterVolume(settings.volume / 100);
  if (all || key === 'showMinimap') $('minimap').hidden = !settings.showMinimap;
  if (all || key === 'showFps') $('fps').hidden = !settings.showFps;
  if (all || key === 'ambient') {
    const a = settings.ambient / 100;
    hemi.intensity = 0.03 + 1.27 * a;
    scene.environmentIntensity = 0.02 + 0.58 * a;
    museum?.applyAmbient();
  }
  if (all || key === 'realLights') artLights.setCount(settings.realLights);
  if (museum && key === 'glow') museum.refreshGlow();
  if (museum && ['videoDist', 'maxVideos', 'imageDist', 'viewDist', 'mutedVideos'].includes(key)) museum.poke();
  if (museum && key === 'textureMax') museum.reloadImages();
  if (museum && REBUILD_KEYS.has(key)) $('rebuildBar').hidden = false;
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ estado / UI

let museum = null;
let minimap = null;
let mode = 'start'; // start | paused | play | directory | lightbox
let focus = null;
let currentRoom = null;

applySettings();
onSettingsChange((key) => applySettings(key));

function setMode(m) {
  mode = m;
  $('start').hidden = m !== 'start';
  $('pause').hidden = m !== 'paused';
  $('directory').hidden = m !== 'directory';
  $('lightbox').hidden = m !== 'lightbox';
  $('settingsPanel').hidden = m !== 'settings';
  $('elevatorPanel').hidden = m !== 'elevator';
  $('ride').hidden = m !== 'ride';
  $('tourBar').hidden = m !== 'tour';
  $('hud').classList.toggle('touring', m === 'tour');
  $('hud').hidden = m === 'start';
  if (m !== 'play') setFocus(null);
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

player.controls.addEventListener('lock', () => {
  player.padMode = false;
  listener.context.resume();
  player.keys.clear();
  setMode('play');
});
player.controls.addEventListener('unlock', () => {
  player.keys.clear();
  if (mode === 'play') setMode('paused');
});
document.addEventListener('pointerlockerror', () => {
  if (mode === 'play' || mode === 'directory') setMode('paused');
});

/** Volver a caminar: con el mando si se está usando, si no capturando el ratón. */
function enter() {
  if (player.padMode && gamepad.recent) { enterPad(); return; }
  try { player.controls.lock(); } catch { /* el overlay de pausa sigue visible */ }
}

function enterPad() {
  player.padMode = true;
  listener.context.resume();
  setMode('play');
}

function teleport(x, z, yaw, y = 0) {
  player.teleport(x, z, yaw, y);
  museum.poke();
}

$('pause').addEventListener('click', (e) => { if (!e.target.closest('button')) enter(); });
$('openDir').addEventListener('click', () => openDirectory());
$('startTour').addEventListener('click', () => startTour());
$('pauseSettings').addEventListener('click', () => openSettings());
$('startSettings').addEventListener('click', () => openSettings());
$('changeFolder').addEventListener('click', () => location.reload());

// ------------------------------------------------------------------ carga de carpeta

function setBusy(busy, msg = '', dir = '') {
  $('pick').disabled = $('demo').disabled = busy;
  $('progress').textContent = msg;
  $('progressDir').textContent = dir;
  $('recent').hidden = busy || !$('recentList').children.length;
}

const onProgress = ({ seen, found, dirs, current }) => setBusy(true,
  `Escaneando… ${dirs ? `${dirs.toLocaleString('es')} carpetas · ` : `${seen.toLocaleString('es')} archivos · `}${found.toLocaleString('es')} obras`,
  current || '');

async function openNativeFolder(root) {
  setBusy(true, settings.scanCache ? 'Abriendo…' : 'Escaneando…');
  $('cancelScan').hidden = false;
  try {
    const result = await scanNative(root, onProgress, { useCache: settings.scanCache });
    build(result);
    if (result.fromCache) checkForChanges(root, result.scannedAt);
  } catch (e) {
    console.error(e);
    setBusy(false, /cancelad/i.test(e.message) ? 'Escaneo cancelado.' : `No se pudo leer la carpeta: ${e.message}`);
  } finally {
    $('cancelScan').hidden = true;
  }
}

$('pick').addEventListener('click', async () => {
  if (native) {
    const root = await native.pickFolder();
    if (root) openNativeFolder(root);
    return;
  }
  if (!supportsPicker()) { $('dirInput').click(); return; }
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: 'imuseum', mode: 'read' });
  } catch (e) {
    if (e.name !== 'AbortError') $('dirInput').click();
    return;
  }
  setBusy(true, 'Escaneando…');
  try { build(await scanDirectoryHandle(handle, onProgress)); }
  catch (e) { console.error(e); setBusy(false, `No se pudo leer la carpeta: ${e.message}`); }
});

$('cancelScan').addEventListener('click', () => native?.cancelScan());

$('dirInput').addEventListener('change', (e) => {
  if (!e.target.files.length) return;
  setBusy(true, 'Escaneando…');
  build(scanFileList(e.target.files));
});

$('demo').addEventListener('click', async () => {
  setBusy(true, 'Cargando demo…');
  try { build(await loadDemo()); }
  catch (e) { console.error(e); setBusy(false, 'No se pudo cargar la demo.'); }
});
fetch('demo/manifest.json', { method: 'HEAD' }).then((r) => { if (r.ok) $('demo').hidden = false; }).catch(() => {});

async function initNative() {
  if (!native) return;
  renderRecent(await native.recentFolders());
  showCacheInfo(await native.cacheInfo());
  const info = await native.appInfo();
  const line = $('versionLine');
  line.hidden = false;
  line.innerHTML = `iMuseum ${info.version} — <a>buscar actualizaciones</a>`;
  line.querySelector('a').addEventListener('click', () => checkUpdates(true));
  if (settings.autoUpdate && info.packaged) checkUpdates(false);
}

// ------------------------------------------------------------------ actualizaciones

/** Consulta la última versión publicada en GitHub y ofrece instalarla. */
async function checkUpdates(manual) {
  const box = $('updateBox'), text = $('updateText'), btn = $('updateAction');
  if (manual) { box.hidden = false; text.textContent = 'Buscando actualizaciones…'; btn.hidden = true; }
  const r = await native.checkUpdate();
  btn.hidden = false;
  btn.onclick = null;
  if (r.status === 'available') {
    box.hidden = false;
    text.textContent = `Hay una versión nueva: ${r.latest} (tienes ${r.current}).`;
    if (r.selfUpdate) {
      btn.textContent = 'Descargar e instalar';
      btn.onclick = async () => {
        btn.disabled = true;
        const off = native.onUpdateProgress((p) => { btn.textContent = `Descargando… ${Math.round(p)} %`; });
        try {
          await native.downloadUpdate();
          btn.disabled = false;
          btn.textContent = 'Reiniciar e instalar';
          btn.onclick = () => native.installUpdate();
        } catch (e) {
          text.textContent = `No se pudo descargar: ${e.message}`;
          btn.disabled = false;
          btn.textContent = 'Abrir en GitHub';
          btn.onclick = () => native.openReleases();
        } finally { off(); }
      };
    } else {
      // .deb: la actualiza el gestor de paquetes
      btn.textContent = 'Descargar desde GitHub';
      btn.onclick = () => native.openReleases();
    }
  } else if (manual) {
    btn.hidden = true;
    if (r.status === 'current') text.textContent = `Tienes la última versión (${r.current}).`;
    else if (r.status === 'dev') text.textContent = 'Las actualizaciones solo funcionan en la app instalada.';
    else {
      // sin conexión, o la última versión publicada no trae los archivos de actualización
      text.textContent = /latest.*\.yml/i.test(r.error ?? '')
        ? 'La última versión publicada no admite la actualización automática: descárgala desde GitHub.'
        : 'No se pudo comprobar (¿sin conexión?).';
      btn.hidden = false;
      btn.textContent = 'Abrir GitHub';
      btn.onclick = () => native.openReleases();
    }
  }
}

/** Historial de carpetas: quitar una entrada o vaciarlo no toca nada en el disco. */
function renderRecent(recent) {
  const list = $('recentList');
  list.innerHTML = '';
  for (const p of recent) {
    const li = document.createElement('li');
    const name = p.split(/[\\/]/).filter(Boolean).pop() || p;
    li.innerHTML = '<div class="info"><b></b><span></span></div><button class="remove" title="Quitar del historial (no borra la carpeta)">✕</button>';
    li.querySelector('b').textContent = name;
    li.querySelector('span').textContent = p;
    li.title = p;
    li.addEventListener('click', () => openNativeFolder(p));
    li.querySelector('.remove').addEventListener('click', async (e) => {
      e.stopPropagation();
      renderRecent(await native.removeRecent(p));
    });
    list.append(li);
  }
  $('recent').hidden = !recent.length;
}

let clearArmed = null;
$('clearRecent').addEventListener('click', async () => {
  const btn = $('clearRecent');
  if (!clearArmed) {
    // segundo clic para confirmar
    btn.textContent = '¿Seguro? Pulsa otra vez';
    clearArmed = setTimeout(() => { clearArmed = null; btn.textContent = 'Borrar historial'; }, 3000);
    return;
  }
  clearTimeout(clearArmed);
  clearArmed = null;
  btn.textContent = 'Borrar historial';
  renderRecent(await native.clearRecent());
});

function showCacheInfo(info) {
  const el = $('cacheInfo');
  el.hidden = false;
  el.innerHTML = `Caché de miniaturas: ${info.count.toLocaleString('es')} archivos · ${formatSize(info.bytes)}`
    + (info.scans?.count ? ` · escaneos guardados: ${info.scans.count} (${formatSize(info.scans.bytes)}) ` : ' ');
  if (info.count) {
    const a = document.createElement('a');
    a.textContent = 'vaciar';
    a.addEventListener('click', async () => showCacheInfo(await native.clearCache()));
    el.append('— ', a);
  }
}
initNative();
window.__imuseumOpen = openNativeFolder; // usados por las pruebas (scripts/selftest.mjs)
window.__imuseumBuild = (result) => build(result);

let lastResult = null;

/**
 * Construye el museo. Con `restore` (al actualizar o reconstruir) vuelve a la sala en la
 * que estaba el visitante si sigue existiendo.
 */
function build(result, { restore = null } = {}) {
  if (!result.items.length) {
    setBusy(false, 'No se encontraron imágenes, videos ni audios en esa carpeta.');
    return;
  }
  lastResult = result;
  if (!restore) setBusy(true, `Construyendo el museo con ${result.items.length.toLocaleString('es')} obras…`);
  setTimeout(() => {
    const collections = buildCollections(result);
    museum?.dispose();
    museum = new Museum(scene, collections, result.rootName, { saveThumb: native?.saveThumb, listener });
    player.world = museum;
    const back = restore && museum.rooms.find((r) => r.path === restore.path && r.title === restore.title);
    const at = back ? back.entry : museum.spawn;
    teleport(at.x, at.z, at.yaw, at.y);
    $('rebuildBar').hidden = true;
    minimap = new Minimap($('minimap'), museum);
    window.__imuseum = { museum, player, camera, scene, renderer, setMode, teleport, setSetting, settings };
    document.title = `${result.rootName} — iMuseum`;

    $('pauseEyebrow').textContent = 'Bienvenido a';
    $('pauseTitle').textContent = result.rootName;
    $('pauseStats').textContent = [
      plural(museum.wings.length, 'ala', 'alas'), plural(museum.rooms.length, 'sala', 'salas'), countsLabel(museum.totals),
    ].join(' · ');
    setBusy(false);
    if (restore && player.locked) setMode('play');
    else setMode('paused');
  }, 50);
}

/** Reconstruye el museo con la misma carpeta (ajustes de arquitectura o carpeta actualizada). */
function rebuild(result = lastResult) {
  if (!result) return;
  const here = currentRoom ? { path: currentRoom.path, title: currentRoom.title } : null;
  build(result, { restore: here ?? { path: '', title: '' } });
}

// ------------------------------------------------------------------ cambios en la carpeta

let pendingUpdate = null;
let chipTimer;

function showChip(text, { update = false, hideAfter = 0 } = {}) {
  const el = $('scanChip');
  clearTimeout(chipTimer);
  el.textContent = text;
  el.classList.toggle('update', update);
  el.hidden = !text;
  if (hideAfter) chipTimer = setTimeout(() => { el.hidden = true; }, hideAfter);
}

/** Tras abrir desde el escaneo guardado, mira en segundo plano si la carpeta cambió. */
async function checkForChanges(root, scannedAt) {
  const when = new Date(scannedAt).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
  showChip(`Abierto desde el escaneo del ${when} · buscando cambios…`);
  try {
    const res = await rescanNative(root, ({ dirs }) => showChip(`Buscando cambios… ${dirs.toLocaleString('es')} carpetas`));
    if (lastResult?.root !== root) return; // ya se abrió otra carpeta
    const total = res.added + res.removed + res.changed;
    if (!total) {
      showChip(`Sin cambios desde el ${when}`, { hideAfter: 4000 });
      return;
    }
    pendingUpdate = { ...lastResult, items: res.items, fromCache: false };
    const parts = [res.added && `+${res.added}`, res.removed && `−${res.removed}`, res.changed && `${res.changed} modificadas`].filter(Boolean);
    showChip(`La carpeta cambió (${parts.join(', ')}) · pulsa U para actualizar el museo`, { update: true });
    $('updateMuseum').hidden = false;
    $('updateMuseum').textContent = `Actualizar museo (${parts.join(', ')})`;
  } catch (e) {
    console.warn('No se pudo comprobar la carpeta', e);
    showChip('');
  }
}

function applyPendingUpdate() {
  if (!pendingUpdate) return;
  const result = pendingUpdate;
  pendingUpdate = null;
  $('updateMuseum').hidden = true;
  showChip('Museo actualizado', { hideAfter: 2500 });
  rebuild(result);
}

$('updateMuseum').addEventListener('click', applyPendingUpdate);
$('rebuildNow').addEventListener('click', () => { closeSettings(); rebuild(); });

// ------------------------------------------------------------------ interacción

const raycaster = new THREE.Raycaster();
raycaster.far = 7;
const CENTER = new THREE.Vector2(0, 0);

function setFocus(ex) {
  focus = ex;
  $('hud').classList.toggle('focused', !!ex);
  if (ex) {
    $('focusTitle').textContent = ex.title;
    $('focusHint').textContent = hintFor(ex);
  }
}

const ELEVATOR_FOCUS = { kind: 'elevator', title: 'Ascensor' };

function hintFor(ex) {
  if (ex.kind === 'elevator') return 'E — elegir piso (o teclas 0–9)';
  if (ex.kind === 'image') return 'E / clic — ampliar';
  if (ex.kind === 'video') return `E — ${ex.soundOn ? 'silenciar' : 'activar sonido'} · F — ver en grande`;
  return `E — ${ex.playing ? 'pausar' : 'reproducir'}`;
}

function updateFocus() {
  raycaster.setFromCamera(CENTER, camera);
  const hit = raycaster.intersectObjects(museum.rayTargets, false)[0];
  let ex = hit?.object.userData.exhibit ?? null;
  if (!ex && museum.inElevator(camera.position, player.feet)) ex = ELEVATOR_FOCUS;
  if (ex !== focus) setFocus(ex);
  else if (ex) $('focusHint').textContent = hintFor(ex);
}

function interact() {
  const ex = focus;
  if (!ex) return;
  if (ex.kind === 'elevator') openElevator();
  else if (ex.kind === 'image') openViewer(ex);
  else if (ex.kind === 'video') {
    if (!ex.ready) { toast('Este video no se puede reproducir'); return; }
    toast(ex.toggleSound(listener) ? 'Sonido activado' : 'Sonido desactivado');
  } else if (ex.kind === 'audio') {
    if (ex.toggle(listener) === 'error') toast('Formato de audio no compatible');
  }
}

addEventListener('mousedown', (e) => {
  if (mode === 'play' && player.locked && e.button === 0) interact();
});

addEventListener('keydown', (e) => {
  if (mode === 'play') {
    if (e.code === 'KeyE') interact();
    else if (e.code === 'KeyF' && focus?.kind === 'video') openViewer(focus);
    else if (e.code === 'KeyM') setSetting('showMinimap', !settings.showMinimap);
    else if (e.code === 'KeyU') applyPendingUpdate();
    else if (e.code === 'KeyG') startTour();
    else if (e.code === 'Tab') { e.preventDefault(); openDirectory(); }
    else if (/^Digit\d$/.test(e.code) && museum.inElevator(camera.position, player.feet)) rideTo(Number(e.code.slice(5)));
  } else if (mode === 'elevator') {
    if (e.code === 'Escape') setMode('paused');
    else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') { e.preventDefault(); moveSel($('elevatorList'), e.code === 'ArrowDown' ? 1 : -1); }
    else if (e.code === 'Enter') $('elevatorList').querySelector('li.sel')?.click();
    else if (/^Digit\d$/.test(e.code)) rideTo(Number(e.code.slice(5)));
  } else if (mode === 'paused' && e.code === 'KeyU') {
    applyPendingUpdate();
  } else if (mode === 'paused' && e.code === 'KeyG') {
    startTour();
  } else if (mode === 'tour') {
    if (e.code === 'Space') { e.preventDefault(); tour.togglePause(); }
    else if (e.code === 'ArrowRight') tour.next();
    else if (e.code === 'ArrowLeft') tour.prev();
    else if (e.code === 'Escape') stopTour();
  } else if (mode === 'paused' && e.code === 'Tab') {
    e.preventDefault();
    openDirectory();
  } else if (mode === 'settings') {
    if (e.code === 'Escape') closeSettings();
  } else if (mode === 'directory') {
    if (e.code === 'Escape' || e.code === 'Tab') { e.preventDefault(); setMode('paused'); }
    else if (e.code === 'ArrowDown' || e.code === 'ArrowUp') { e.preventDefault(); moveDirSel(e.code === 'ArrowDown' ? 1 : -1); }
    else if (e.code === 'Enter') $('dirList').querySelector('li.sel')?.click();
  } else if (mode === 'lightbox') {
    if (e.code === 'Escape') closeLightbox();
    else if (e.code === 'ArrowLeft') stepLightbox(-1);
    else if (e.code === 'ArrowRight') stepLightbox(1);
  }
});

// ------------------------------------------------------------------ ascensor

function openElevator() {
  setMode('elevator');
  player.controls.unlock();
  const list = $('elevatorList');
  list.innerHTML = '';
  const here = museum.floorAt(player.feet);
  for (const f of museum.floors) {
    const li = document.createElement('li');
    if (f === here) li.classList.add('here');
    li.innerHTML = '<span class="num"></span><div><div class="t"></div><div class="p"></div></div>';
    li.querySelector('.num').textContent = f.index;
    li.querySelector('.t').textContent = f.title || `Piso ${f.index}`;
    li.querySelector('.p').textContent = `${plural(f.wings.length, 'ala', 'alas')} · ${plural(f.roomCount, 'sala', 'salas')} · ${countsLabel(f.counts)}`
      + (f === here ? ' · estás aquí' : '');
    li.addEventListener('click', () => rideTo(f.index));
    list.append(li);
  }
  (list.querySelector('li.here') ?? list.firstElementChild)?.classList.add('sel');
}

function chime() {
  const ctx = listener.context;
  const now = ctx.currentTime;
  for (const [i, freq] of [[0, 880], [1, 1320]]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, now + i * 0.18);
    g.gain.exponentialRampToValueAtTime(0.18 * (settings.volume / 100), now + i * 0.18 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.9);
    o.connect(g).connect(ctx.destination);
    o.start(now + i * 0.18);
    o.stop(now + i * 0.18 + 1);
  }
}

let riding = false;
/** Viaje en ascensor: contador de pisos, llegada a la cabina del piso elegido y campanilla. */
async function rideTo(index) {
  const target = museum.floors[index];
  const from = museum.floorAt(player.feet);
  if (!target || riding) return;
  if (target === from) { setMode('paused'); enter(); return; }
  riding = true;
  setMode('ride');
  const up = target.index > from.index;
  $('rideArrow').textContent = up ? '▲' : '▼';
  $('rideText').textContent = `${up ? 'Subiendo' : 'Bajando'} · ${target.title || 'Piso ' + target.index}`;
  const steps = Math.abs(target.index - from.index);
  const per = Math.max(160, Math.min(450, 2200 / steps));
  for (let i = 0; i <= steps; i++) {
    $('rideFloor').textContent = from.index + (up ? i : -i);
    await new Promise((r) => setTimeout(r, per));
  }
  const stop = museum.elevatorStop(target);
  teleport(stop.x, stop.z, stop.yaw, stop.y);
  chime();
  await new Promise((r) => setTimeout(r, 450));
  riding = false;
  setMode('paused');
  enter();
}

// ------------------------------------------------------------------ visita guiada

function renderTourBar(i) {
  $('tourWhat').textContent = i.title;
  $('tourMeta').textContent = `${i.room.title} · sala ${i.roomNumber} de ${i.roomCount}`
    + (i.stop ? ` · obra ${i.stop} de ${i.artworks}` : ` · ${plural(i.artworks, 'obra', 'obras')}`)
    + (i.paused ? ' · en pausa' : '');
}

function startTour() {
  if (!museum || !museum.rooms.length) return;
  tour = new GuidedTour({
    museum, camera, listener,
    fade: (on) => $('tourFade').classList.toggle('on', on),
    onChange: renderTourBar,
  });
  setMode('tour');
  player.controls.unlock();
  listener.context.resume();
  tour.start(currentRoom);
}

function stopTour() {
  if (!tour) return;
  tour.stop();
  tour = null;
  // deja al visitante de pie donde terminó la visita
  const p = camera.position;
  const ground = museum.groundAt(p.x, p.z, p.y - EYE_H + 0.3);
  player.teleport(p.x, p.z, camera.rotation.y, Number.isFinite(ground) ? ground : p.y - EYE_H);
  setMode('paused');
}

// ------------------------------------------------------------------ mando

function handlePad(dt) {
  const s = gamepad.poll();
  const pad = player.pad;
  pad.lx = pad.ly = 0;
  pad.run = false;
  if (!s) return;
  const nav = (list) => { const d = gamepad.nav(s); if (d) moveSel(list, d); if (s.down(BTN.A)) list.querySelector('li.sel')?.click(); };
  switch (mode) {
    case 'play': {
      if (!player.padMode && (s.lx || s.ly || s.rx || s.ry)) player.padMode = true;
      pad.lx = s.lx;
      pad.ly = s.ly;
      pad.run = s.held(BTN.RT) || s.held(BTN.LS);
      const k = 2.6 * settings.padSpeed * dt;
      player.look(s.rx * k, (settings.padInvertY ? -1 : 1) * s.ry * k);
      if (s.down(BTN.A)) interact();
      else if (s.down(BTN.Y)) openDirectory();
      else if (s.down(BTN.X)) startTour();
      else if (s.down(BTN.RB) && focus?.kind === 'video') openViewer(focus);
      else if (s.down(BTN.BACK)) setSetting('showMinimap', !settings.showMinimap);
      else if (s.down(BTN.START) || s.down(BTN.B)) { player.controls.unlock(); setMode('paused'); }
      break;
    }
    case 'paused':
      if (s.down(BTN.A) || s.down(BTN.START)) enterPad();
      else if (s.down(BTN.Y)) openDirectory();
      else if (s.down(BTN.X)) startTour();
      break;
    case 'directory':
      player.padMode = true;
      nav($('dirList'));
      if (s.down(BTN.B)) setMode('paused');
      break;
    case 'elevator':
      player.padMode = true;
      nav($('elevatorList'));
      if (s.down(BTN.B)) setMode('paused');
      break;
    case 'lightbox':
      if (s.down(BTN.LB) || s.down(BTN.LEFT)) stepLightbox(-1);
      else if (s.down(BTN.RB) || s.down(BTN.RIGHT)) stepLightbox(1);
      else if (s.down(BTN.B)) closeLightbox();
      break;
    case 'settings':
      if (s.down(BTN.B)) closeSettings();
      break;
    case 'tour':
      if (s.down(BTN.A)) tour.togglePause();
      else if (s.down(BTN.RB) || s.down(BTN.RIGHT)) tour.next();
      else if (s.down(BTN.LB) || s.down(BTN.LEFT)) tour.prev();
      else if (s.down(BTN.B) || s.down(BTN.X)) stopTour();
      break;
  }
}

// ------------------------------------------------------------------ pantalla de ajustes

let settingsReturn = 'start';

function openSettings() {
  settingsReturn = mode === 'start' ? 'start' : 'paused';
  setMode('settings');
  player.controls.unlock();
  renderSettings();
}

function closeSettings() {
  setMode(settingsReturn);
}

function formatValue(f, v) {
  if (f.type === 'toggle') return '';
  if (f.type === 'select') return '';
  const n = f.step < 1 ? v.toFixed(1).replace('.', ',') : String(v);
  return f.unit ? `${n} ${f.unit}` : n;
}

function renderSettings() {
  const form = $('settingsForm');
  form.innerHTML = '';
  for (const f of SCHEMA) {
    if (f.section) {
      const h = document.createElement('div');
      h.className = 'setSection';
      h.textContent = f.section;
      form.append(h);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'setRow';
    const id = `set-${f.key}`;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = f.label;
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = formatValue(f, settings[f.key]);
    let input;
    if (f.type === 'range') {
      input = Object.assign(document.createElement('input'), { type: 'range', min: f.min, max: f.max, step: f.step });
      input.value = settings[f.key];
      input.addEventListener('input', () => {
        setSetting(f.key, Number(input.value));
        val.textContent = formatValue(f, settings[f.key]);
      });
    } else if (f.type === 'select') {
      input = document.createElement('select');
      for (const [v, text] of f.options) input.append(new Option(text, v, false, v === settings[f.key]));
      input.addEventListener('change', () => setSetting(f.key, Number(input.value)));
    } else {
      input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: settings[f.key] });
      input.addEventListener('change', () => setSetting(f.key, input.checked));
    }
    input.id = id;
    row.append(label, input, val);
    if (f.hint) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = f.hint;
      row.append(hint);
    }
    form.append(row);
  }
}

$('settingsDone').addEventListener('click', closeSettings);
$('settingsReset').addEventListener('click', () => { resetSettings(); renderSettings(); });
$('settingsPanel').addEventListener('click', (e) => { if (e.target === $('settingsPanel')) closeSettings(); });

// ------------------------------------------------------------------ directorio

const DIR_LIMIT = 600;

function openDirectory() {
  if (!museum) return;
  setMode('directory');
  player.controls.unlock();
  $('dirSearch').value = '';
  renderDirectory();
  setTimeout(() => $('dirSearch').focus(), 0);
}

function dirItem(cls, title, sub, counts, color, go) {
  const li = document.createElement('li');
  li.className = cls;
  li.innerHTML = '<span class="swatch"></span><div><div class="t"></div><div class="p"></div></div><span class="c"></span>';
  li.querySelector('.swatch').style.background = color;
  li.querySelector('.t').textContent = title;
  li.querySelector('.p').textContent = sub;
  li.querySelector('.c').textContent = counts ? countsLabel(counts) : '';
  li.addEventListener('click', () => { go(); enter(); });
  return li;
}

function renderDirectory() {
  const q = $('dirSearch').value.trim().toLowerCase();
  const list = $('dirList');
  const frag = document.createDocumentFragment();
  let shown = 0, total = 0;
  if (!q) {
    frag.append(dirItem('', 'Entrada', 'Vestíbulo de la galería principal', null, '#a8894a',
      () => teleport(museum.spawn.x, museum.spawn.z, museum.spawn.yaw)));
  }
  for (const w of museum.wings) {
    const wingMatch = !q || w.title.toLowerCase().includes(q);
    const rooms = w.rooms.filter((r) => wingMatch || `${r.title} ${r.path}`.toLowerCase().includes(q));
    if (!rooms.length) continue;
    total += rooms.length;
    if (shown >= DIR_LIMIT) continue;
    const floorTxt = museum.floors.length > 1 ? `Piso ${w.layout.floor} · ` : '';
    frag.append(dirItem('wingHead', w.title, `${floorTxt}Ala ${w.side === 'E' ? 'este' : 'oeste'} · ${plural(w.rooms.length, 'sala', 'salas')}`,
      w.counts, '#a8894a', () => teleport(w.entry.x, w.entry.z, w.entry.yaw, w.entry.y)));
    for (const r of rooms) {
      if (shown++ >= DIR_LIMIT) break;
      const li = dirItem('room', r.title, `${r.typeLabel} · ${r.path}`, r.counts, r.color,
        () => teleport(r.entry.x, r.entry.z, r.entry.yaw, r.entry.y));
      if (r === currentRoom) li.classList.add('here');
      frag.append(li);
    }
  }
  if (total > DIR_LIMIT) {
    const li = document.createElement('li');
    li.className = 'more';
    li.textContent = `Mostrando ${DIR_LIMIT} de ${total.toLocaleString('es')} salas — escribe para filtrar.`;
    frag.append(li);
  }
  list.replaceChildren(frag);
  list.querySelector('li:not(.more)')?.classList.add('sel');
}

function moveDirSel(d) { moveSel($('dirList'), d); }

function moveSel(list, d) {
  const items = [...list.querySelectorAll('li:not(.more)')];
  if (!items.length) return;
  const i = items.findIndex((li) => li.classList.contains('sel'));
  items[i]?.classList.remove('sel');
  const next = items[(i + d + items.length) % items.length];
  next.classList.add('sel');
  next.scrollIntoView({ block: 'nearest' });
}

$('dirSearch').addEventListener('input', renderDirectory);
$('directory').addEventListener('click', (e) => { if (e.target === $('directory')) setMode('paused'); });

// ------------------------------------------------------------------ visor a pantalla completa

let lb = null; // { list, index, held }

function openViewer(ex) {
  const list = ex.room.exhibits.filter((e) => e.kind === ex.kind);
  lb = { list, index: list.indexOf(ex) };
  setMode('lightbox');
  player.controls.unlock();
  showLightboxItem();
}

function showLightboxItem() {
  releaseHeld();
  const ex = lb.list[lb.index];
  const media = $('lbMedia');
  media.innerHTML = '';
  let el;
  if (ex.kind === 'video') {
    el = document.createElement('video');
    el.controls = true;
    el.autoplay = true;
    el.src = ex.item.url;
    const t = ex.video?.currentTime;
    if (t) el.addEventListener('loadedmetadata', () => { el.currentTime = t; }, { once: true });
    // pausa la pantalla del museo mientras se ve en grande
    if (ex.soundOn) ex.toggleSound(listener);
    ex.held = true;
    ex.setPlaying(false);
    lb.held = ex;
  } else {
    el = document.createElement('img');
    el.alt = ex.title;
    const item = ex.item;
    if (conversionKind(item.name)) {
      // HEIC y RAW se convierten a JPEG en el worker antes de mostrarse
      media.dataset.loading = 'Convirtiendo…';
      displayURL(item).then((url) => { if (lb && lb.list[lb.index] === ex) { el.src = url; delete media.dataset.loading; } })
        .catch(() => { media.dataset.loading = 'No se pudo convertir este archivo'; });
    } else {
      el.src = item.url;
    }
  }
  media.append(el);
  const cap = $('lbCaption');
  cap.innerHTML = '<b></b><br><span></span><br><span class="exif"></span>';
  cap.querySelector('b').textContent = ex.item.name;
  const caption = (exif) => {
    const taken = exif?.date ? `tomada el ${formatDate(exif.date.getTime())}` : formatDate(ex.item.mtime);
    cap.querySelector('span').textContent = [
      ex.room.path, formatSize(ex.item.size), taken, `${lb.index + 1} / ${lb.list.length}`,
    ].filter(Boolean).join(' · ');
    cap.querySelector('.exif').textContent = [exifSummary(exif), exif?.lens].filter(Boolean).join(' · ');
  };
  caption(ex.item.exif);
  if (ex.kind === 'image' && settings.readExif && ex.item.exif === undefined) {
    readExif(ex.item).then((x) => { if (lb && lb.list[lb.index] === ex) caption(x); });
  }
  $('lbPrev').hidden = $('lbNext').hidden = lb.list.length < 2;
  $('lbReveal').hidden = !(native && ex.item.id != null);
}

function releaseHeld() {
  if (lb?.held) { lb.held.held = false; lb.held = null; }
}

function stepLightbox(d) {
  if (!lb || lb.list.length < 2) return;
  lb.index = (lb.index + d + lb.list.length) % lb.list.length;
  showLightboxItem();
}

function closeLightbox() {
  if (!lb) return;
  releaseHeld();
  $('lbMedia').innerHTML = '';
  lb = null;
  setMode('paused');
}

$('lbClose').addEventListener('click', () => { closeLightbox(); enter(); });
$('lbPrev').addEventListener('click', () => stepLightbox(-1));
$('lbNext').addEventListener('click', () => stepLightbox(1));
$('lbReveal').addEventListener('click', () => { if (lb) native.reveal(lb.list[lb.index].item.id); });

// ------------------------------------------------------------------ bucle principal

function locationLabel(room) {
  if (room) {
    const base = room.wing.title === room.title ? room.title : `${room.wing.title} › ${room.title}`;
    const level = museum.levelName(room, player.feet);
    return level ? `${base} · ${level}` : base;
  }
  return museum.wingAt(camera.position)?.title ?? 'Galería principal';
}

let fpsFrames = 0, fpsSince = performance.now();
function updateFps(now) {
  fpsFrames++;
  if (now - fpsSince < 500) return;
  const fps = Math.round((fpsFrames * 1000) / (now - fpsSince));
  fpsFrames = 0;
  fpsSince = now;
  const st = museum?.stats;
  const built = museum ? museum.rooms.filter((r) => r.built).length : 0;
  $('fps').textContent = `${fps} FPS` + (st ? `\nVideos: ${st.videosPlaying} reproduciendo / ${st.videosReady} listos\nSalas en memoria: ${built}` : '');
}

let last = performance.now();
let mapTimer = 0;
let lastLabel = '';

renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (museum) {
    handlePad(dt);
    if (mode === 'tour') tour.update(dt);
    else player.update(dt);
    museum.update(dt, camera.position);
    artLights.update(dt, camera, museum);
    if (mode === 'play') updateFocus();

    mapTimer -= dt;
    if (mapTimer <= 0) {
      mapTimer = 0.1;
      currentRoom = museum.roomAt(camera.position);
      const label = locationLabel(currentRoom);
      if (label !== lastLabel) $('roomName').textContent = lastLabel = label;
      if (settings.showMinimap) minimap.draw(camera.position, player.yaw, currentRoom);
    }
  }
  renderer.render(scene, camera);
  if (settings.showFps) updateFps(now);
});
