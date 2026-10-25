// Arranca Vite y abre la app de escritorio apuntando al servidor de desarrollo.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

const server = await createServer({ server: { port: 5174, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`Vite en ${url}`);

const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
