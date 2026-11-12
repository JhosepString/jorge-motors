import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { importSPKI, jwtVerify } from 'jose';

export async function verifyOfflineGrant(token, publicKeyPem, deviceId, now = Date.now()) {
  const key = await importSPKI(publicKeyPem.replaceAll('\\n', '\n'), 'RS256');
  const { payload } = await jwtVerify(token, key, { algorithms: ['RS256'],
    issuer: 'jorge-motors-api', audience: 'jorge-motors-desktop-offline', currentDate: new Date(now) });
  if (payload.device_id !== deviceId || !Number.isInteger(payload.user_id) || payload.user_id <= 0 ||
    !['ADMINISTRADOR', 'MECANICO'].includes(payload.role) || typeof payload.name !== 'string' ||
    typeof payload.tenant_id !== 'string' || typeof payload.object_id !== 'string' ||
    payload.sub !== `${payload.tenant_id}:${payload.object_id}` ||
    payload.offline_policy !== 'UNTIL_RECONNECT' || !Number.isInteger(payload.iat) ||
    payload.iat * 1000 > now + 60_000 || payload.exp !== undefined) {
    throw new Error('La autorización local no corresponde a este usuario o equipo.');
  }
  return { id: payload.user_id, nombres: payload.name, rol: payload.role,
    tenantId: payload.tenant_id, objectId: payload.object_id, issuedAt: payload.iat * 1000 };
}

export class ProtectedGrantStore {
  constructor(filePath, safeStorage, publicKeyPem, deviceId) {
    this.filePath = filePath; this.safeStorage = safeStorage;
    this.publicKeyPem = publicKeyPem; this.deviceId = deviceId;
  }
  async save(token) {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Windows no ofrece almacenamiento protegido.');
    const profile = await verifyOfflineGrant(token, this.publicKeyPem, this.deviceId);
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, this.safeStorage.encryptString(token));
    return profile;
  }
  async load() {
    if (!this.safeStorage.isEncryptionAvailable()) return null;
    try {
      const token = this.safeStorage.decryptString(await readFile(this.filePath));
      return await verifyOfflineGrant(token, this.publicKeyPem, this.deviceId);
    } catch { return null; }
  }
  async clear() { await rm(this.filePath, { force: true }); }
}
