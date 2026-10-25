// Arranca la app de escritorio y la controla por el protocolo de DevTools (CDP).
// Lo usan scripts/selftest.mjs y scripts/screenshots.mjs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import electron from 'electron';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ bin?: string, userData?: string, port?: number }} opts
 *   bin: binario empaquetado (p. ej. release/linux-unpacked/imuseum); por defecto `electron .`
 */
export async function launchApp({ bin = process.env.IMUSEUM_BIN, userData, port = 9333 } = {}) {
  userData ??= fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'imuseum-'));
  let child, ws, seq = 0;
  const pending = new Map();

  function start() {
    child = spawn(bin ?? electron, [...(bin ? [] : ['.']), `--remote-debugging-port=${port}`, '--no-sandbox'], {
      env: { ...process.env, IMUSEUM_USER_DATA: userData },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  }

  async function connect() {
    for (let i = 0; i < 60; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((t) => t.type === 'page');
        if (page) {
          ws = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
          ws.onmessage = (m) => {
            const msg = JSON.parse(m.data);
            pending.get(msg.id)?.(msg);
            pending.delete(msg.id);
          };
          await sleep(1500);
          return;
        }
      } catch { /* todavía arrancando */ }
      await sleep(500);
    }
    throw new Error('No se pudo conectar con Electron');
  }

  function send(method, params = {}) {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((r) => pending.set(id, r));
  }

  async function evaluate(expr) {
    const res = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (res.result.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
    return res.result.result.value;
  }

  async function screenshot(file, quality = 82) {
    const res = await send('Page.captureScreenshot', { format: 'jpeg', quality });
    fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'));
    return file;
  }

  async function close() {
    ws?.close();
    if (child.exitCode !== null) return;
    const exited = new Promise((r) => child.once('exit', r));
    child.kill();
    await exited;
  }

  async function relaunch() {
    await close();
    start();
    await connect();
  }

  start();
  await connect();
  return { userData, send, evaluate, screenshot, close, relaunch };
}
