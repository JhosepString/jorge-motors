import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({ entryPoints: [fileURLToPath(new URL('../../backend/src/infrastructure/local/desktop-entry.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../local-runtime.mjs', import.meta.url)), bundle: true,
  platform: 'node', format: 'esm', target: 'node22', packages: 'bundle', sourcemap: false });
console.info('Local SQLite runtime bundled for Electron.');
