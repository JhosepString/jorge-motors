import { PublicClientApplication } from '@azure/msal-node';
import { randomUUID } from 'node:crypto';
import { parseEntraSettings } from '../modules/auth/infrastructure/entra.js';
import { parseEnvironment } from '../config/env.js';
import { z } from 'zod';
import open from 'open';
import { acquireBrowserToken } from './browser-auth.js';

// El límite termina este cliente de consola y su receptor local si se cierra el navegador.
const timeout = setTimeout(() => {
  console.error('Tiempo de inicio de sesión agotado (5 minutos). Vuelve a ejecutar auth:check.');
  process.exit(1);
}, 300_000);
timeout.unref();

try {
  const settings = parseEntraSettings(process.env);
  const clientId = process.env.ENTRA_TEST_CLIENT_ID;
  if (!settings || !clientId || !settings.clientIds.includes(clientId.toLowerCase())) {
    throw new Error('Complete ENTRA_TEST_CLIENT_ID y la configuración de Entra según la guía.');
  }
  const args = process.argv.slice(2);
  const kind = args[0];
  if (kind && !['salida', 'entrada'].includes(kind)) throw new Error('Uso: auth:check [salida|entrada productoId cantidad].');
  const values = kind ? z.object({ productoId: z.coerce.number().int().positive(), cantidad: z.coerce.number().int().positive() })
    .parse({ productoId: args[1], cantidad: args[2] }) : undefined;
  const client = new PublicClientApplication({
    auth: { clientId, authority: `https://login.microsoftonline.com/${settings.tenantId}` },
  });
  console.info('Se abrirá el navegador. Selecciona Administrador Demo o Mecánico Demo; completa allí el inicio de sesión y MFA si se solicita.');
  const token = await acquireBrowserToken(client, settings.audience, async (url) => {
    await open(url, { wait: false });
  });
  if (!token) throw new Error('No se obtuvo un token.');
  const config = parseEnvironment(process.env);
  const url = kind ? `/api/v1/inventario/${kind === 'salida' ? 'salidas' : 'entradas'}` : '/api/v1/auth/me';
  const response = await fetch(`http://127.0.0.1:${config.PORT}${url}`, {
    method: kind ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      ...(kind ? { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() } : {}),
    },
    ...(values ? { body: JSON.stringify({ ...values, motivo: 'Demostración local con identidad verificada' }) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  console.info(`HTTP ${response.status}`);
  console.info(JSON.stringify(await response.json(), null, 2));
  if (!response.ok) process.exitCode = 1;
  // La caché vive únicamente en memoria; nunca se imprime ni escribe el token.
} catch (error) {
  // Solo códigos acotados; no imprimir el error completo, URLs, respuestas OAuth ni tokens.
  const code = error && typeof error === 'object' && 'errorCode' in error ? error.errorCode : undefined;
  if (typeof code === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(code)) console.error(`Código de autenticación: ${code}`);
  console.error('No se completó la prueba. Revise la URI http://localhost en la plataforma móvil/escritorio del cliente, consentimiento, roles, perfil SQL y que la API esté activa.');
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
