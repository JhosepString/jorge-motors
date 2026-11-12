import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { PublicClientApplication } from '@azure/msal-node';
import open from 'open';
import { parseEntraSettings } from '../modules/auth/infrastructure/entra.js';
import { deviceProofHeaders } from '../modules/auth/application/device-proof.js';
import { acquireBrowserToken } from './browser-auth.js';

// Equipo efímero de prueba: no usa ni modifica la identidad de ninguna instalación.
const base = 'https://jorge-motors-api-dev-josen.azurewebsites.net/api/v1';
const timeout = setTimeout(() => { console.error('Tiempo de acceso agotado.'); process.exit(1); }, 300_000);
timeout.unref();

async function main() {
  const settings = parseEntraSettings(process.env);
  const clientId = process.env.ENTRA_TEST_CLIENT_ID;
  if (!settings || !clientId || !settings.clientIds.includes(clientId.toLowerCase())) {
    throw new Error('Configuración Entra de pruebas incompleta.');
  }
  console.info('Abriendo Microsoft. Seleccione la cuenta Administrador Demo autorizada.');
  const client = new PublicClientApplication({ auth: {
    clientId, authority: `https://login.microsoftonline.com/${settings.tenantId}`,
  } });
  const token = await acquireBrowserToken(client, settings.audience, async (url) => {
    await open(url, { wait: false });
  });
  if (!token?.accessToken) throw new Error('No se obtuvo token.');
  const bearer = { Authorization: `Bearer ${token.accessToken}` };
  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(`${base}${path}`, {
      ...options, headers: { ...bearer, ...options.headers }, signal: AbortSignal.timeout(30_000),
      cache: 'no-store', redirect: 'error',
    });
    let body: any = null;
    try { body = await response.json(); } catch { /* Respuesta inesperada. */ }
    return { status: response.status, body };
  }
  const existingId = process.argv[2];
  if (existingId && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(existingId)) {
    throw new Error('Id. de equipo de prueba inválido.');
  }
  const deviceId = existingId?.toLowerCase() ?? randomUUID();
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const registration = { deviceId, publicKey: keys.publicKey };
  const query = `/sync/bootstrap?deviceId=${deviceId}&after=0&limit=100`;
  const path = `/api/v1${query}`;
  if (!existingId) {
    const registered = await request('/sync/devices', { method: 'POST',
      headers: { 'Content-Type': 'application/json',
        ...deviceProofHeaders(deviceId, keys.privateKey, 'POST', '/api/v1/sync/devices', registration) },
      body: JSON.stringify(registration) });
    if (registered.status !== 200 || registered.body?.data?.deviceId?.toLowerCase() !== deviceId) {
      throw new Error(`Registro de equipo falló: HTTP ${registered.status}, ${registered.body?.error?.code ?? 'UNKNOWN'}`);
    }
    console.info(`Equipo ficticio registrado: ${deviceId}`);
    const before = await request(query, { headers: deviceProofHeaders(deviceId, keys.privateKey, 'GET', path) });
    if (before.status !== 200) throw new Error(`Descarga antes de revocar: HTTP ${before.status}`);
    console.info('Descarga inicial autorizada antes de revocar.');
    const revoked = await request(`/sync/devices/${deviceId}/revoke`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Prueba controlada de revocacion de equipo ficticio' }) });
    if (revoked.status !== 200) throw new Error(`Revocación falló: HTTP ${revoked.status}`);
    console.info('Equipo ficticio revocado.');
  }
  const listed = await request('/sync/devices');
  const row = listed.body?.data?.find?.((item: { deviceId: string }) => item.deviceId.toLowerCase() === deviceId);
  if (listed.status !== 200 || !row || row.active !== false || Number(row.quotaRemaining) !== 0) {
    throw new Error('La lista no confirma el equipo revocado sin cupo.');
  }
  const after = await request(query, { headers: deviceProofHeaders(deviceId, keys.privateKey, 'GET', path) });
  if (after.status !== 403 || after.body?.error?.code !== 'DEVICE_NOT_REGISTERED') {
    throw new Error(`Descarga posterior no fue bloqueada como se esperaba: HTTP ${after.status}, ${after.body?.error?.code ?? 'UNKNOWN'}`);
  }
  console.info('Descarga posterior bloqueada con HTTP 403 DEVICE_NOT_REGISTERED.');
  const replay = await request('/sync/devices', { method: 'POST',
    headers: { 'Content-Type': 'application/json',
      ...deviceProofHeaders(deviceId, keys.privateKey, 'POST', '/api/v1/sync/devices', registration) },
    body: JSON.stringify(registration) });
  if (replay.status !== 403 || replay.body?.error?.code !== 'DEVICE_ALREADY_REGISTERED') {
    throw new Error(`Re-registro de equipo revocado no fue bloqueado: HTTP ${replay.status}, ${replay.body?.error?.code ?? 'UNKNOWN'}`);
  }
  console.info('Re-registro bloqueado con HTTP 403 DEVICE_ALREADY_REGISTERED.');
}

try { await main(); } catch (error) {
  console.error(`Prueba de revocación no completada: ${error instanceof Error ? error.message : 'error'}`);
  process.exitCode = 1;
} finally { clearTimeout(timeout); }
