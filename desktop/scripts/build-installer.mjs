import { cp, copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const stage = await mkdtemp(join(tmpdir(), 'jm-nsis-'));
const run = (args) => new Promise((resolveRun, reject) => {
  const child = spawn('pnpm', args, { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`pnpm ${args.join(' ')} falló (${code}).`)));
});
try {
  for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'main.mjs', 'auth.mjs',
    'offline-grant.mjs', 'device-identity.mjs', 'api-proxy.mjs', 'uninstall-review.mjs',
    'local-runtime.mjs', 'preload.cjs', 'static-server.mjs', 'auth-config.json'])
    await copyFile(join(desktop, name), join(stage, name));
  await cp(join(desktop, 'build'), join(stage, 'build'), { recursive: true });
  await cp(join(desktop, 'frontend'), join(stage, 'frontend'), { recursive: true });
  await run(['install', '--frozen-lockfile', '--prefer-offline']);
  await run(['exec', 'electron-builder', '--win', 'nsis']);
  const output = join(stage, 'release');
  const setup = (await readdir(output)).find((name) => /^Jorge Motors Setup .*\.exe$/.test(name));
  if (!setup) throw new Error('NSIS no produjo el instalador.');
  const release = join(desktop, 'release');
  await mkdir(release, { recursive: true });
  await copyFile(join(output, setup), join(release, setup));
  await copyFile(join(output, `${setup}.blockmap`), join(release, `${setup}.blockmap`));
  const digest = createHash('sha256').update(await readFile(join(release, setup))).digest('hex');
  await writeFile(join(release, `${setup}.sha256.txt`), `${digest}  ${setup}\n`);
  console.info(`Instalador generado: ${join(release, setup)}`);
} finally {
  const temp = resolve(tmpdir());
  const target = resolve(stage);
  if (!target.startsWith(temp + sep) || !basename(target).startsWith('jm-nsis-'))
    throw new Error('La carpeta temporal de construcción no es segura para limpiar.');
  await rm(target, { recursive: true, force: true });
}
