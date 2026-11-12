import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportPKCS8, exportSPKI, generateKeyPair, jwtVerify } from 'jose';
import { createOfflineGrantSigner } from '../src/modules/auth/application/offline-grant.js';

test('API signs device-bound offline permission that stays valid until reconnect', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const sign = createOfflineGrantSigner(await exportPKCS8(privateKey));
  const device = '8f464e16-bda2-4f41-9f9e-e8dbfb34fc71';
  const actor = { id: 7, nombres: 'Ana', rol: 'MECANICO' as const, activo: true,
    entraTenantId: 'tenant', entraObjectId: 'object' };
  const token = await sign(device, actor, { tenantId: 'tenant', objectId: 'object', roles: ['Mecanico'] });
  const { payload } = await jwtVerify(token, publicKey, { issuer: 'jorge-motors-api', audience: 'jorge-motors-desktop-offline' });
  assert.equal(payload.device_id, device);
  assert.equal(payload.role, 'MECANICO');
  assert.equal(payload.exp, undefined);
  assert.equal(payload.offline_policy, 'UNTIL_RECONNECT');
  assert.match(await exportSPKI(publicKey), /BEGIN PUBLIC KEY/);
});
