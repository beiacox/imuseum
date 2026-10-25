import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173 },
  // workers como módulos ES: así libheif (LGPL) queda en su propio archivo y se carga
  // solo cuando aparece la primera foto HEIC
  worker: { format: 'es' },
});
