import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
const target = fileURLToPath(new URL('../frontend/', import.meta.url));
await readFile(new URL('../../frontend/dist/index.html', import.meta.url));
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
console.info('Frontend compiled files copied into desktop package.');
