import { readFile, stat } from 'node:fs/promises';
import { PublicClientApplication } from '@azure/msal-node';
import open from 'open';
import { parseEntraSettings } from '../modules/auth/infrastructure/entra.js';
import { parseEnvironment } from '../config/env.js';
import { acquireBrowserToken } from './browser-auth.js';
import { invoiceCommand } from './invoice-command.js';
import { calculateInvoice, invoiceCreateSchema, invoiceEditSchema } from '../modules/compras/domain/invoice.js';

const timeout = setTimeout(() => { console.error('Tiempo de inicio de sesión agotado.'); process.exit(1); }, 300_000);
timeout.unref();
try {
  const command = invoiceCommand(process.argv.slice(2));
  let body = command.body;
  if (command.file) {
    if ((await stat(command.file)).size > 65_536) throw new Error('Archivo excesivo.');
    const contents = await readFile(command.file);
    if (contents.length > 65_536) throw new Error('Archivo excesivo.');
    const schema = command.method === 'PUT' ? invoiceEditSchema : invoiceCreateSchema;
    const parsed = schema.parse(JSON.parse(contents.toString('utf8').replace(/^\uFEFF/, '')));
    calculateInvoice(parsed.lineas); body = parsed;
  }
  const settings = parseEntraSettings(process.env); const clientId = process.env.ENTRA_TEST_CLIENT_ID;
  if (!settings || !clientId || !settings.clientIds.includes(clientId.toLowerCase())) throw new Error('Configuración incompleta.');
  console.info(command.path.endsWith('/confirmar') ? 'Recepción REAL LOCAL: confirmará la factura y aumentará stock. Conserve UUID y versión original para reintentar.'
    : 'Registro de compras: solo confirmar recepción modifica existencias. No se envían correos.');
  console.info('Se abrirá Microsoft en el navegador. Selecciona el usuario Demo.');
  const client = new PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${settings.tenantId}` } });
  const token = await acquireBrowserToken(client, settings.audience, async (url) => { await open(url, { wait: false }); });
  if (!token) throw new Error('No se obtuvo token.');
  const config = parseEnvironment(process.env);
  const response = await fetch(`http://127.0.0.1:${config.PORT}/api/v1/compras/facturas${command.path}`, {
    method: command.method, headers: { Authorization: `Bearer ${token.accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(command.version ? { 'If-Match': `"${command.version}"` } : {}),
      ...(command.key ? { 'Idempotency-Key': command.key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000),
  });
  console.info(`HTTP ${response.status}`);
  if (response.headers.has('etag')) console.info(`ETag: ${response.headers.get('etag')}`);
  console.info(JSON.stringify(await response.json(), null, 2));
  if (!response.ok) process.exitCode = 1;
} catch {
  console.error('No se completó la prueba. Revise la guía de facturas, argumentos, JSON y API local.'); process.exitCode = 1;
} finally { clearTimeout(timeout); }
