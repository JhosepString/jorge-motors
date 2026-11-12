import { readFile } from 'node:fs/promises';
import { createPublicKey } from 'node:crypto';
import { validateAuthConfig } from '../auth.mjs';

let config;
try { config = JSON.parse(await readFile(new URL('../auth-config.json', import.meta.url), 'utf8')); }
catch { throw new Error('Falta desktop/auth-config.json con la configuración pública real de Entra y la API.'); }
validateAuthConfig(config);
const icon = await readFile(new URL('../build/icon.ico', import.meta.url));
if (icon.length < 38 || icon.readUInt16LE(0) !== 0 || icon.readUInt16LE(2) !== 1 ||
  icon.readUInt16LE(4) < 2) throw new Error('Falta el icono Windows de Jorge Motors.');
const iconSizes = new Set();
for (let index = 0; index < icon.readUInt16LE(4); index++) {
  const size = icon.readUInt8(6 + index * 16);
  iconSizes.add(size === 0 ? 256 : size);
}
if (!iconSizes.has(16) || !iconSizes.has(256))
  throw new Error('El icono Windows necesita tamaños de 16 y 256 píxeles.');
for (const field of ['tenantId', 'desktopClientId', 'apiClientId']) {
  if (config[field] === '00000000-0000-0000-0000-000000000000')
    throw new Error(`${field} sigue usando el valor de ejemplo.`);
}
if (new URL(config.apiBaseUrl).hostname.includes('your-api') || new URL(config.apiBaseUrl).hostname.endsWith('.example.com'))
  throw new Error('La URL de API sigue usando el valor de ejemplo.');
try {
  const key = createPublicKey(config.offlineGrantPublicKeyPem.replaceAll('\\n', '\n'));
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error();
} catch { throw new Error('La clave pública del permiso offline no es RSA válida de al menos 2048 bits.'); }
console.info('Configuración pública de release validada.');
