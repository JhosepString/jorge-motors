import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PublicClientApplication } from '@azure/msal-node';
import open from 'open';
import { parseEntraSettings } from '../modules/auth/infrastructure/entra.js';
import { parseEnvironment } from '../config/env.js';
import { acquireBrowserToken } from './browser-auth.js';
import { MAX_REPORT_BYTES } from '../modules/reportes/application/inventory-report.js';

const timeout = setTimeout(() => { console.error('Tiempo de inicio de sesión agotado.'); process.exit(1); }, 300_000);
timeout.unref();
try {
  const [formatInput, categoryInput, ...extra] = process.argv.slice(2);
  const formato = z.enum(['pdf', 'xlsx']).parse(formatInput);
  if (extra.length) throw new Error('Use pdf|xlsx [categoriaId].');
  const category = categoryInput === undefined ? undefined : z.coerce.number().int().positive().max(2_147_483_647).parse(categoryInput);
  const settings = parseEntraSettings(process.env); const clientId = process.env.ENTRA_TEST_CLIENT_ID;
  if (!settings || !clientId || !settings.clientIds.includes(clientId.toLowerCase())) throw new Error('Configuración incompleta.');
  console.info('Exporta el inventario a un archivo privado local; registra auditoría, no modifica stock ni envía correo.');
  console.info('Se abrirá Microsoft. Selecciona Administrador Demo.');
  const client = new PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${settings.tenantId}` } });
  const token = await acquireBrowserToken(client, settings.audience, async (url) => { await open(url, { wait: false }); });
  if (!token) throw new Error('No se obtuvo token.');
  const query = new URLSearchParams({ formato, ...(category === undefined ? {} : { categoriaId: String(category) }) });
  const response = await fetch(`http://127.0.0.1:${parseEnvironment(process.env).PORT}/api/v1/reportes/inventario/exportar?${query}`, {
    headers: { Authorization: `Bearer ${token.accessToken}` }, signal: AbortSignal.timeout(60_000),
  });
  console.info(`HTTP ${response.status}`);
  if (!response.ok) { console.info(JSON.stringify(await response.json(), null, 2)); process.exitCode = 1; }
  else {
    const contents = Buffer.from(await response.arrayBuffer());
    const mime = formato === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (contents.length > MAX_REPORT_BYTES || response.headers.get('content-type') !== mime) throw new Error('Respuesta incompatible.');
    const root = resolve('.local-data', 'reportes'); await mkdir(root, { recursive: true });
    const path = resolve(root, `inventario-${randomUUID()}.${formato}`);
    await writeFile(path, contents, { flag: 'wx' }); console.info(`Archivo guardado: ${path}`);
  }
} catch {
  console.error('No se completó la exportación. Use report:check pdf|xlsx [categoriaId]; revise API local y guía 5.3.'); process.exitCode = 1;
} finally { clearTimeout(timeout); }
