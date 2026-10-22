import { PublicClientApplication } from '@azure/msal-node';
import open from 'open';
import { parseEntraSettings } from '../modules/auth/infrastructure/entra.js';
import { parseEnvironment } from '../config/env.js';
import { acquireBrowserToken } from './browser-auth.js';
import { supplierCommand } from './supplier-command.js';

const timeout = setTimeout(() => { console.error('Tiempo de inicio de sesión agotado.'); process.exit(1); }, 300_000);
timeout.unref();
try {
  const command = supplierCommand(process.argv.slice(2));
  const settings = parseEntraSettings(process.env); const clientId = process.env.ENTRA_TEST_CLIENT_ID;
  if (!settings || !clientId || !settings.clientIds.includes(clientId.toLowerCase())) throw new Error('Configuración incompleta.');
  console.info(command.method === 'GET' ? 'Consulta administrativa de proveedores.' : 'Modifica un contacto de compra; no crea usuarios ni envía correos.');
  console.info('Se abrirá Microsoft en el navegador. Selecciona el usuario Demo que quieres probar.');
  const client = new PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${settings.tenantId}` } });
  const token = await acquireBrowserToken(client, settings.audience, async (url) => { await open(url, { wait: false }); });
  if (!token) throw new Error('No se obtuvo token.');
  const config = parseEnvironment(process.env);
  const response = await fetch(`http://127.0.0.1:${config.PORT}/api/v1/compras/proveedores${command.path}`, {
    method: command.method,
    headers: { Authorization: `Bearer ${token.accessToken}`,
      ...(command.body ? { 'Content-Type': 'application/json' } : {}),
      ...(command.version ? { 'If-Match': `"${command.version}"` } : {}) },
    ...(command.body ? { body: JSON.stringify(command.body) } : {}), signal: AbortSignal.timeout(20_000),
  });
  console.info(`HTTP ${response.status}`);
  if (response.headers.has('etag')) console.info(`ETag: ${response.headers.get('etag')}`);
  console.info(JSON.stringify(await response.json(), null, 2));
  if (!response.ok) process.exitCode = 1;
} catch {
  console.error('No se completó la prueba. Revise la guía Parte 5.2, los argumentos y la API local.'); process.exitCode = 1;
} finally { clearTimeout(timeout); }
