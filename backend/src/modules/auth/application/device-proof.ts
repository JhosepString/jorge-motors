import { createHash, createPublicKey, randomUUID, sign, verify } from 'node:crypto';

export interface DeviceProof { deviceId: string; time: string; nonce: string; signature: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function canonicalDeviceMessage(method: string, path: string, body: unknown, time: string, nonce: string): string {
  const hash = createHash('sha256').update(body === undefined ? '' : JSON.stringify(body)).digest('hex');
  return `${method.toUpperCase()}\n${path}\n${hash}\n${time}\n${nonce}`;
}

export function deviceProofHeaders(deviceId: string, privateKeyPem: string, method: string,
  path: string, body?: unknown, now = Date.now()): Record<string, string> {
  const time = String(now); const nonce = randomUUID();
  const message = canonicalDeviceMessage(method, path, body, time, nonce);
  const signature = sign('sha256', Buffer.from(message), { key: privateKeyPem, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return { 'X-Device-Id': deviceId, 'X-Device-Time': time, 'X-Device-Nonce': nonce,
    'X-Device-Signature': signature };
}

export function normalizeDevicePublicKey(pem: string): string {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    throw new Error('Device key must use P-256.');
  return key.export({ format: 'pem', type: 'spki' }).toString();
}

export function verifyDeviceProof(publicKeyPem: string, proof: DeviceProof, method: string,
  path: string, body?: unknown, now = Date.now()): boolean {
  if (!uuid.test(proof.deviceId) || !uuid.test(proof.nonce) || !/^\d{13}$/.test(proof.time) ||
    !/^[A-Za-z0-9_-]{80,120}$/.test(proof.signature) || Math.abs(now - Number(proof.time)) > 120_000) return false;
  try {
    const message = canonicalDeviceMessage(method, path, body, proof.time, proof.nonce);
    return verify('sha256', Buffer.from(message), { key: normalizeDevicePublicKey(publicKeyPem), dsaEncoding: 'ieee-p1363' },
      Buffer.from(proof.signature, 'base64url'));
  } catch { return false; }
}
