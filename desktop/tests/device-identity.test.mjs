import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ProtectedDeviceIdentity } from '../device-identity.mjs';

test('device identity persists an encrypted private key and reloads the same public key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jm-device-'));
  const path = join(dir, 'device.bin');
  const storage = { isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value).toString('base64'),
    decryptString: (value) => Buffer.from(value.toString(), 'base64').toString() };
  try {
    const deviceId = randomUUID();
    const first = new ProtectedDeviceIdentity(path, storage, deviceId);
    await first.initialize();
    const disk = (await readFile(path)).toString();
    assert.equal(disk.includes('PRIVATE KEY'), false);
    const second = new ProtectedDeviceIdentity(path, storage, deviceId);
    await second.initialize();
    assert.equal(second.publicKey, first.publicKey);
    assert.ok(second.proofHeaders('GET', '/api/v1/sync/bootstrap').hasOwnProperty('X-Device-Signature'));
    await assert.rejects(new ProtectedDeviceIdentity(path, storage, randomUUID()).initialize(), /invalid/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
