const { app, BrowserWindow, ipcMain, dialog, protocol, shell, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { scanFolder } = require('./scan.cjs');

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

const THUMB_SIZES = new Set([512, 1024, 2048]);

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

ipcMain.handle('scan', async (event, root) => {
  const token = ++scanToken;
  const result = await scanFolder(root, {
    isCancelled: () => token !== scanToken,
    onProgress: (p) => { if (!event.sender.isDestroyed()) event.sender.send('scan-progress', p); },
  });
  files = result.files;
  const cfg = readConfig();
  cfg.recent = [root, ...(cfg.recent ?? []).filter((r) => r !== root)].slice(0, 6);
  writeConfig(cfg);
  return { rootName: result.rootName, root, items: result.items };
});

ipcMain.on('scan-cancel', () => { scanToken++; });

const existingRecent = (cfg) => (cfg.recent ?? []).filter((p) => fs.existsSync(p));

ipcMain.handle('recent-folders', () => existingRecent(readConfig()));

// Solo quita la carpeta del historial: nunca toca la carpeta en disco.
ipcMain.handle('remove-recent', (_e, root) => {
  const cfg = readConfig();
  cfg.recent = (cfg.recent ?? []).filter((p) => p !== root);
  writeConfig(cfg);
  return existingRecent(cfg);
});

ipcMain.handle('clear-recent', () => {
  const cfg = readConfig();
  cfg.recent = [];
  writeConfig(cfg);
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

ipcMain.handle('cache-info', () => dirSize(thumbDir()));
ipcMain.handle('clear-cache', async () => {
  await fs.promises.rm(thumbDir(), { recursive: true, force: true });
  return dirSize(thumbDir());
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
