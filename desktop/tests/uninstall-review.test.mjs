import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { exportLocalData, localUninstallSummary, reviewUninstall } from '../uninstall-review.mjs';

test('uninstall review counts all users pending/rejected and keeps data unless deletion is confirmed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jm-uninstall-'));
  const data = join(dir, 'Jorge Motors');
  const backup = join(dir, 'copias');
  try {
    await Promise.all([mkdir(data), mkdir(backup)]);
    const db = new DatabaseSync(join(data, 'inventory.sqlite'));
    db.exec("CREATE TABLE sync_operation(status TEXT NOT NULL); INSERT INTO sync_operation VALUES ('PENDING'),('REJECTED'),('CONFIRMED');");
    db.close();
    await writeFile(join(data, 'device-id'), 'sample-device');
    assert.deepEqual(localUninstallSummary(data), { pending: 1, rejected: 1, known: true });
    assert.equal(await reviewUninstall(data, { showMessageBoxSync: () => 0 }), 0);
    assert.equal(await readFile(join(data, 'device-id'), 'utf8'), 'sample-device');
    let shown = 0;
    const deleteDecision = await reviewUninstall(data, { showMessageBoxSync: (options) => {
      shown++;
      assert.match(options.detail, /1 operaciones pendientes y 1 rechazadas/);
      return shown === 1 ? 2 : 1;
    } });
    assert.equal(deleteDecision, 2);
    assert.equal(await reviewUninstall(data, { showMessageBoxSync: () => 3 }), 1);
    const copy = await exportLocalData(data, backup);
    assert.equal(await readFile(join(copy, 'device-id'), 'utf8'), 'sample-device');
    await assert.rejects(exportLocalData(data, data), /fuera/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
