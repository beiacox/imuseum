const { app, BrowserWindow, ipcMain, dialog, protocol, shell, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const { Readable } = require('node:stream');
const { scanFolder, entriesFromDirs } = require('./scan.cjs');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
if (process.env.IMUSEUM_USER_DATA) app.setPath('userData', process.env.IMUSEUM_USER_DATA);
const DIST = path.join(__dirname, '..', 'dist');
const APP_URL = 'imuseum://app/index.html';

// Todo (app, multimedia y miniaturas) se sirve por un protocolo propio con soporte
// de rangos HTTP: los videos se leen a trozos desde disco, nunca enteros en memoria.
protocol.registerSchemesAsPrivileged([{
  scheme: 'imuseum',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

const MIME = {
  html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
  flac: 'audio/flac', opus: 'audio/ogg', weba: 'audio/webm', woff2: 'font/woff2',
};
const mimeOf = (p) => MIME[path.extname(p).slice(1).toLowerCase()] ?? 'application/octet-stream';

// ------------------------------------------------------------------ estado

let win = null;
let files = [];          // índice id → { path, size, mtime } del último escaneo
let scanToken = 0;
const thumbDir = () => path.join(app.getPath('userData'), 'thumbs');
const configPath = () => path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { return {}; }
}
function writeConfig(cfg) {
  try { fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2)); } catch (e) { console.warn(e); }
}

// 512/1024/2048: cuadros según la resolución elegida · 400: fotograma de las pantallas de video
const THUMB_SIZES = new Set([400, 512, 1024, 2048]);

function thumbPath(id, size) {
  const f = files[id];
  if (!f || !THUMB_SIZES.has(size)) return null;
  const key = crypto.createHash('sha1').update(`${f.path}|${f.size}|${f.mtime}|${size}`).digest('hex');
  return path.join(thumbDir(), key.slice(0, 2), `${key}.webp`);
}

// ------------------------------------------------------------------ protocolo

const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range, content-length, accept-ranges' };

async function serveFile(file, request, extraHeaders = {}) {
  let st;
  try { st = await fs.promises.stat(file); } catch { return new Response('No encontrado', { status: 404, headers: CORS }); }
  const size = st.size;
  const headers = { ...CORS, 'content-type': mimeOf(file), 'accept-ranges': 'bytes', ...extraHeaders };
  const range = request.headers.get('range');
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m && (m[1] || m[2])) {
    let start, end;
    if (m[1]) { start = +m[1]; end = m[2] ? Math.min(+m[2], size - 1) : size - 1; }
    else { start = Math.max(0, size - +m[2]); end = size - 1; }
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
    }
    headers['content-range'] = `bytes ${start}-${end}/${size}`;
    headers['content-length'] = String(end - start + 1);
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: 206, headers });
  }
  headers['content-length'] = String(size);
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers });
}

function handleProtocol(request) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] === '__media' || parts[0] === '__thumb') {
    const id = Number(parts[1]);
    if (!Number.isInteger(id) || !files[id]) return new Response('No encontrado', { status: 404, headers: CORS });
    if (parts[0] === '__media') return serveFile(files[id].path, request);
    const thumb = thumbPath(id, Number(url.searchParams.get('s') ?? 1024));
    if (!thumb) return new Response('No encontrado', { status: 404, headers: CORS });
    return serveFile(thumb, request, { 'cache-control': 'no-store' });
  }

  // archivos de la app (dist/)
  const rel = decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST)) return new Response('Prohibido', { status: 403 });
  return serveFile(file, request);
}

// ------------------------------------------------------------------ IPC

ipcMain.handle('pick-folder', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Elige la carpeta del museo',
    properties: ['openDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

// ---------------------------------------------------------- escaneos guardados

const scanDir = () => path.join(app.getPath('userData'), 'scans');
const scanCachePath = (root) => path.join(scanDir(), `${crypto.createHash('sha1').update(root).digest('hex')}.json.gz`);

async function loadScanCache(root) {
  try {
    const data = JSON.parse(await gunzip(await fs.promises.readFile(scanCachePath(root))));
    return data.v === 1 && data.root === root ? data : null;
  } catch { return null; }
}

async function saveScanCache(root, dirs) {
  try {
    await fs.promises.mkdir(scanDir(), { recursive: true });
    const tmp = `${scanCachePath(root)}.tmp`;
    await fs.promises.writeFile(tmp, await gzip(JSON.stringify({ v: 1, root, scannedAt: Date.now(), dirs })));
    await fs.promises.rename(tmp, scanCachePath(root));
  } catch (e) { console.warn('No se pudo guardar el escaneo', e.message); }
}

/**
 * Asigna ids estables por ruta: un archivo conserva su id entre escaneos, así el museo
 * abierto sigue funcionando mientras se busca si hay cambios.
 */
let pathToId = new Map();
function assignIds(entries) {
  const items = [];
  for (const e of entries) {
    let id = pathToId.get(e.path);
    if (id === undefined) {
      id = files.length;
      pathToId.set(e.path, id);
      files.push(null);
    }
    files[id] = { path: e.path, size: e.size, mtime: e.mtime };
    items.push({ id, type: e.type, name: e.name, dir: e.dir, size: e.size, mtime: e.mtime });
  }
  return items;
}

function rememberRecent(root) {
  const cfg = readConfig();
  cfg.recent = [root, ...(cfg.recent ?? []).filter((r) => r !== root)].slice(0, 8);
  writeConfig(cfg);
}

let currentRoot = null;
function resetIds(root) {
  if (root === currentRoot) return;
  currentRoot = root;
  files = [];
  pathToId = new Map();
}

/** Abre una carpeta: desde el escaneo guardado si existe (instantáneo) o escaneándola. */
ipcMain.handle('scan', async (event, root, { useCache = true } = {}) => {
  resetIds(root);
  rememberRecent(root);
  if (useCache) {
    const cached = await loadScanCache(root);
    if (cached) {
      return {
        rootName: path.basename(root) || root, root, fromCache: true, scannedAt: cached.scannedAt,
        items: assignIds(entriesFromDirs(root, cached.dirs)),
      };
    }
  }
  const token = ++scanToken;
  const result = await scanFolder(root, {
    isCancelled: () => token !== scanToken,
    onProgress: (p) => { if (!event.sender.isDestroyed()) event.sender.send('scan-progress', p); },
  });
  await saveScanCache(root, result.dirs);
  return { rootName: result.rootName, root, fromCache: false, scannedAt: Date.now(), items: assignIds(result.entries) };
});

/**
 * Comprueba en segundo plano si la carpeta cambió desde el escaneo guardado. Solo relee
 * las carpetas cuya fecha de modificación cambió.
 */
ipcMain.handle('rescan', async (event, root) => {
  const cached = await loadScanCache(root);
  const before = new Map(entriesFromDirs(root, cached?.dirs ?? {}).map((e) => [e.path, e]));
  const result = await scanFolder(root, {
    previous: cached?.dirs,
    onProgress: (p) => { if (!event.sender.isDestroyed()) event.sender.send('rescan-progress', p); },
  });
  let added = 0, changed = 0;
  for (const e of result.entries) {
    const old = before.get(e.path);
    if (!old) added++;
    else if (old.size !== e.size || old.mtime !== e.mtime) changed++;
    before.delete(e.path);
  }
  const removed = before.size;
  await saveScanCache(root, result.dirs);
  const items = root === currentRoot ? assignIds(result.entries) : [];
  return { root, added, removed, changed, foldersRead: result.read, foldersReused: result.reused, items };
});

async function forgetScan(root) {
  await fs.promises.rm(scanCachePath(root), { force: true });
}

ipcMain.on('scan-cancel', () => { scanToken++; });

const existingRecent = (cfg) => (cfg.recent ?? []).filter((p) => fs.existsSync(p));

ipcMain.handle('recent-folders', () => existingRecent(readConfig()));

// Solo quita la carpeta del historial: nunca toca la carpeta en disco.
ipcMain.handle('remove-recent', async (_e, root) => {
  const cfg = readConfig();
  cfg.recent = (cfg.recent ?? []).filter((p) => p !== root);
  writeConfig(cfg);
  await forgetScan(root); // el escaneo guardado es parte del historial
  return existingRecent(cfg);
});

ipcMain.handle('clear-recent', async () => {
  const cfg = readConfig();
  cfg.recent = [];
  writeConfig(cfg);
  await fs.promises.rm(scanDir(), { recursive: true, force: true });
  return [];
});

ipcMain.on('save-thumb', async (_e, id, data, size) => {
  const p = thumbPath(id, Number(size));
  if (!p || !data) return;
  try {
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, Buffer.from(data));
  } catch (e) { console.warn('No se pudo guardar la miniatura', e.message); }
});

ipcMain.on('reveal', (_e, id) => { if (files[id]) shell.showItemInFolder(files[id].path); });

// ---------------------------------------------------------- actualizaciones automáticas

const RELEASES_URL = 'https://github.com/beiacox/imuseum/releases/latest';
let updater = null;
function getUpdater() {
  if (updater !== null) return updater;
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    updater.logger = null;
  } catch {
    updater = false;
  }
  return updater;
}
// AppImage, Windows (NSIS) y macOS se actualizan solos; el .deb lo gestiona el sistema (apt)
const canSelfUpdate = () => app.isPackaged && (process.platform !== 'linux' || !!process.env.APPIMAGE);

ipcMain.handle('app-info', () => ({ version: app.getVersion(), packaged: app.isPackaged, selfUpdate: canSelfUpdate() }));

ipcMain.handle('update-check', async () => {
  if (!app.isPackaged) return { status: 'dev', current: app.getVersion() };
  const u = getUpdater();
  if (!u) return { status: 'unsupported', current: app.getVersion() };
  try {
    const r = await u.checkForUpdates();
    const latest = r?.updateInfo?.version;
    return {
      status: r?.isUpdateAvailable ? 'available' : 'current',
      current: app.getVersion(), latest, selfUpdate: canSelfUpdate(), url: RELEASES_URL,
    };
  } catch (e) {
    return { status: 'error', current: app.getVersion(), error: e.message, url: RELEASES_URL };
  }
});

ipcMain.handle('update-download', async (event) => {
  const u = getUpdater();
  if (!u || !canSelfUpdate()) return false;
  const onProgress = (p) => { if (!event.sender.isDestroyed()) event.sender.send('update-progress', p.percent); };
  u.on('download-progress', onProgress);
  try { await u.downloadUpdate(); return true; } finally { u.off('download-progress', onProgress); }
});

ipcMain.on('update-install', () => { getUpdater()?.quitAndInstall?.(); });

// solo se abren enlaces del propio proyecto
ipcMain.on('open-releases', () => shell.openExternal(RELEASES_URL));

async function dirSize(dir) {
  let total = 0, count = 0;
  try {
    for (const ent of await fs.promises.readdir(dir, { withFileTypes: true, recursive: true })) {
      if (!ent.isFile()) continue;
      try { total += (await fs.promises.stat(path.join(ent.parentPath, ent.name))).size; count++; } catch {}
    }
  } catch {}
  return { bytes: total, count };
}

ipcMain.handle('cache-info', async () => ({ ...(await dirSize(thumbDir())), scans: await dirSize(scanDir()) }));
ipcMain.handle('clear-cache', async () => {
  await fs.promises.rm(thumbDir(), { recursive: true, force: true });
  return { ...(await dirSize(thumbDir())), scans: await dirSize(scanDir()) };
});

// ------------------------------------------------------------------ ventana

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0c0b',
    title: 'iMuseum',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.loadURL(DEV_URL || APP_URL);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.type === 'keyDown' && input.key === 'F12' && DEV_URL) win.webContents.toggleDevTools();
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('imuseum', handleProtocol);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
