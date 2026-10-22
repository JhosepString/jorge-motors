import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';
import { PublicClientApplication } from '@azure/msal-node';
import open from 'open';
import { parseEntraSettings } from '../modules/auth/infrastructure/entra.js';
import { parseEnvironment } from '../config/env.js';
import { acquireBrowserToken } from './browser-auth.js';
import { inspectAttachment, MAX_ATTACHMENT_BYTES } from '../modules/compras/domain/attachment.js';

const timeout = setTimeout(() => { console.error('Tiempo de inicio de sesión agotado.'); process.exit(1); }, 300_000);
timeout.unref();
try {
  const [kind, invoice, path, key, ...extra] = process.argv.slice(2);
  const id = z.coerce.number().int().positive().max(2_147_483_647).parse(invoice);
  let file: ReturnType<typeof inspectAttachment> | undefined;
  if (kind === 'subir' && path && key && extra.length === 0) {
    z.uuid().parse(key);
    if ((await stat(path)).size > MAX_ATTACHMENT_BYTES) throw new Error('Archivo excesivo.');
    const name = basename(path); const ext = name.split('.').at(-1)?.toLowerCase();
    file = inspectAttachment(name, ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg', await readFile(path));
  } else if (kind !== 'listar' || path || key || extra.length) throw new Error('Use listar ID o subir ID ARCHIVO UUID.');
  const settings = parseEntraSettings(process.env); const clientId = process.env.ENTRA_TEST_CLIENT_ID;
  if (!settings || !clientId || !settings.clientIds.includes(clientId.toLowerCase())) throw new Error('Configuración incompleta.');
  console.info(file ? 'Adjunta un documento privado local; no modifica stock ni envía correos. Conserve el UUID para reintentar.' : 'Consulta administrativa de adjuntos.');
  console.info('Se abrirá Microsoft. Selecciona el usuario Demo.');
  const client = new PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${settings.tenantId}` } });
  const token = await acquireBrowserToken(client, settings.audience, async (url) => { await open(url, { wait: false }); });
  if (!token) throw new Error('No se obtuvo token.');
  const config = parseEnvironment(process.env);
  const response = await fetch(`http://127.0.0.1:${config.PORT}/api/v1/compras/facturas/${id}/adjuntos${file ? `?nombre=${encodeURIComponent(file.nombre)}` : ''}`, {
    method: file ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token.accessToken}`,
      ...(file ? { 'Content-Type': file.contentType, 'Idempotency-Key': key! } : {}) },
    ...(file ? { body: new Uint8Array(file.contents) } : {}), signal: AbortSignal.timeout(30_000),
  });
  console.info(`HTTP ${response.status}`); console.info(JSON.stringify(await response.json(), null, 2));
  if (!response.ok) process.exitCode = 1;
} catch {
  console.error('No se completó la prueba. Revise guía 5.2c, argumentos, formato/tamaño y API local.'); process.exitCode = 1;
} finally { clearTimeout(timeout); }
