import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { deviceProofHeaders, verifyDeviceProof, normalizeDevicePublicKey } from '../src/modules/auth/application/device-proof.js';

test('device proof binds key, method, path and body to a short time window', () => {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1', publicKeyEncoding: { format: 'pem', type: 'spki' },
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' } });
  const wrong = generateKeyPairSync('ec', { namedCurve: 'prime256v1', publicKeyEncoding: { format: 'pem', type: 'spki' },
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' } });
  const deviceId = randomUUID();
  const body = { deviceId, operationId: randomUUID() };
  const now = Date.now();
  const headers = deviceProofHeaders(deviceId, pair.privateKey, 'POST', '/api/v1/sync/operations', body, now);
  const proof = { deviceId: headers['X-Device-Id']!, time: headers['X-Device-Time']!,
    nonce: headers['X-Device-Nonce']!, signature: headers['X-Device-Signature']! };
  assert.equal(normalizeDevicePublicKey(pair.publicKey), pair.publicKey);
  assert.equal(verifyDeviceProof(pair.publicKey, proof, 'POST', '/api/v1/sync/operations', body, now), true);
  assert.equal(verifyDeviceProof(wrong.publicKey, proof, 'POST', '/api/v1/sync/operations', body, now), false);
  assert.equal(verifyDeviceProof(pair.publicKey, proof, 'GET', '/api/v1/sync/operations', body, now), false);
  assert.equal(verifyDeviceProof(pair.publicKey, proof, 'POST', '/api/v1/sync/other', body, now), false);
  assert.equal(verifyDeviceProof(pair.publicKey, proof, 'POST', '/api/v1/sync/operations', { ...body, operationId: randomUUID() }, now), false);
  assert.equal(verifyDeviceProof(pair.publicKey, proof, 'POST', '/api/v1/sync/operations', body, now + 120_001), false);
});
