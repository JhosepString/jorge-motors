import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startStaticServer } from '../static-server.mjs';

test('serves bundled SPA, rejects missing assets and non-GET methods', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jm-desktop-'));
  writeFileSync(join(dir, 'index.html'), '<h1>Jorge Motors</h1>');
  const { server, origin } = await startStaticServer(dir);
  try {
    const home = await fetch(origin);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Jorge Motors/);
    assert.equal((await fetch(origin + '/inventario')).status, 200);
    assert.equal((await fetch(origin + '/assets/missing.js')).status, 404);
    assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
  } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
});
