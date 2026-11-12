import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import { ProtectedGrantStore, verifyOfflineGrant } from '../offline-grant.mjs';

test('grant rejects other device and tampering, and stays usable after prolonged outage', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicPem = await exportSPKI(publicKey);
  const device = '8f464e16-bda2-4f41-9f9e-e8dbfb34fc71';
  const now = Date.now();
  const token = await new SignJWT({ device_id: device, user_id: 7, name: 'Ana', role: 'MECANICO',
    tenant_id: 'tenant', object_id: 'object', offline_policy: 'UNTIL_RECONNECT' }).setProtectedHeader({ alg: 'RS256' })
    .setIssuer('jorge-motors-api').setAudience('jorge-motors-desktop-offline')
    .setSubject('tenant:object').setIssuedAt(Math.floor(now / 1000))
    .sign(privateKey);
  assert.equal((await verifyOfflineGrant(token, publicPem, device, now)).rol, 'MECANICO');
  await assert.rejects(verifyOfflineGrant(token, publicPem, 'other', now));
  await assert.rejects(verifyOfflineGrant(token + 'x', publicPem, device, now));
  assert.equal((await verifyOfflineGrant(token, publicPem, device, now + 365 * 86_400_000)).id, 7);
  await assert.rejects(verifyOfflineGrant(token, publicPem, device, now - 120_000));
  const legacy = await new SignJWT({ device_id: device, user_id: 7, name: 'Ana', role: 'MECANICO',
    tenant_id: 'tenant', object_id: 'object' }).setProtectedHeader({ alg: 'RS256' })
    .setIssuer('jorge-motors-api').setAudience('jorge-motors-desktop-offline')
    .setSubject('tenant:object').setIssuedAt(Math.floor(now / 1000)).setExpirationTime(Math.floor(now / 1000) + 86_400)
    .sign(privateKey);
  await assert.rejects(verifyOfflineGrant(legacy, publicPem, device, now));
  const dir = mkdtempSync(join(tmpdir(), 'jm-grant-'));
  try {
    const storage = { isEncryptionAvailable: () => true,
      encryptString: (v) => Buffer.from(v.split('').reverse().join('')),
      decryptString: (v) => v.toString().split('').reverse().join('') };
    const file = join(dir, 'grant.bin');
    const store = new ProtectedGrantStore(file, storage, publicPem, device);
    await store.save(token);
    assert.equal((await new ProtectedGrantStore(file, storage, publicPem, device).load()).id, 7);
    await store.clear();
    assert.equal(await store.load(), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
