import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  native, supportsPicker, scanNative, scanDirectoryHandle, scanFileList, buildCollections, loadDemo,
} from './scanner.js';
import { Museum } from './museum.js';
import { Player } from './player.js';
import { Minimap } from './minimap.js';
import { ArtLights } from './lighting.js';
import { SCHEMA, settings, setSetting, resetSettings, onSettingsChange } from './settings.js';
import { countsLabel, formatSize, formatDate, plural } from './util.js';

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

function enter() {
  try { player.controls.lock(); } catch { /* el overlay de pausa sigue visible */ }
}

function teleport(x, z, yaw, y = 0) {
  player.teleport(x, z, yaw, y);
  museum.poke();
}

$('pause').addEventListener('click', (e) => { if (!e.target.closest('button')) enter(); });
$('openDir').addEventListener('click', () => openDirectory());
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
  `Escaneando… ${seen.toLocaleString('es')} archivos${dirs ? ` en ${dirs.toLocaleString('es')} carpetas` : ''} · ${found.toLocaleString('es')} multimedia`,
  current || '');

async function openNativeFolder(root) {
  setBusy(true, 'Escaneando…');
  $('cancelScan').hidden = false;
  try {
    build(await scanNative(root, onProgress));
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
  el.innerHTML = `Caché de miniaturas: ${info.count.toLocaleString('es')} archivos · ${formatSize(info.bytes)} `;
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

function build(result) {
  if (!result.items.length) {
    setBusy(false, 'No se encontraron imágenes, videos ni audios en esa carpeta.');
    return;
  }
  setBusy(true, `Construyendo el museo con ${result.items.length.toLocaleString('es')} obras…`);
  setTimeout(() => {
    const collections = buildCollections(result);
    museum?.dispose();
    museum = new Museum(scene, collections, result.rootName, { saveThumb: native?.saveThumb, listener });
    player.world = museum;
    teleport(museum.spawn.x, museum.spawn.z, museum.spawn.yaw, museum.spawn.y);
    minimap = new Minimap($('minimap'), museum);
    window.__imuseum = { museum, player, camera, scene, renderer, setMode, teleport, setSetting, settings };
    document.title = `${result.rootName} — iMuseum`;

    $('pauseEyebrow').textContent = 'Bienvenido a';
    $('pauseTitle').textContent = result.rootName;
    $('pauseStats').textContent = [
      plural(museum.wings.length, 'ala', 'alas'), plural(museum.rooms.length, 'sala', 'salas'), countsLabel(museum.totals),
    ].join(' · ');
    setBusy(false);
    setMode('paused');
  }, 50);
}

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

function hintFor(ex) {
  if (ex.kind === 'image') return 'E / clic — ampliar';
  if (ex.kind === 'video') return `E — ${ex.soundOn ? 'silenciar' : 'activar sonido'} · F — ver en grande`;
  return `E — ${ex.playing ? 'pausar' : 'reproducir'}`;
}

function updateFocus() {
  raycaster.setFromCamera(CENTER, camera);
  const hit = raycaster.intersectObjects(museum.rayTargets, false)[0];
  const ex = hit?.object.userData.exhibit ?? null;
  if (ex !== focus) setFocus(ex);
  else if (ex) $('focusHint').textContent = hintFor(ex);
}

function interact() {
  const ex = focus;
  if (!ex) return;
  if (ex.kind === 'image') openViewer(ex);
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
    else if (e.code === 'Tab') { e.preventDefault(); openDirectory(); }
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
    frag.append(dirItem('wingHead', w.title, `Ala ${w.side === 'E' ? 'este' : 'oeste'} · ${plural(w.rooms.length, 'sala', 'salas')}`,
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

function moveDirSel(d) {
  const items = [...$('dirList').querySelectorAll('li:not(.more)')];
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
    el.src = ex.item.url;
    el.alt = ex.title;
  }
  media.append(el);
  const cap = $('lbCaption');
  cap.innerHTML = '<b></b><br><span></span>';
  cap.querySelector('b').textContent = ex.item.name;
  cap.querySelector('span').textContent = [
    ex.room.path, formatSize(ex.item.size), formatDate(ex.item.mtime), `${lb.index + 1} / ${lb.list.length}`,
  ].filter(Boolean).join(' · ');
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
    player.update(dt);
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
