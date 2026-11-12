import { generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { deviceProofHeaders } from './local-runtime.mjs';

export class ProtectedDeviceIdentity {
  constructor(path, safeStorage, deviceId) {
    this.path = path;
    this.safeStorage = safeStorage;
    this.deviceId = deviceId;
  }

  async initialize() {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Windows protected storage is unavailable.');
    try {
      const saved = JSON.parse(this.safeStorage.decryptString(await readFile(this.path)));
      if (saved.deviceId !== this.deviceId || typeof saved.privateKey !== 'string' || typeof saved.publicKey !== 'string')
        throw new Error('Stored device identity is invalid.');
      this.privateKey = saved.privateKey;
      this.publicKey = saved.publicKey;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1', publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
      this.privateKey = pair.privateKey;
      this.publicKey = pair.publicKey;
      await writeFile(this.path, this.safeStorage.encryptString(JSON.stringify({ deviceId: this.deviceId,
        privateKey: this.privateKey, publicKey: this.publicKey })), { flag: 'wx' });
    }
  }

  proofHeaders(method, path, body) {
    if (!this.privateKey) throw new Error('Device identity is not initialized.');
    return deviceProofHeaders(this.deviceId, this.privateKey, method, path, body);
  }
}
