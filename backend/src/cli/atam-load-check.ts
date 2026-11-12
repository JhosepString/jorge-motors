import { PublicClientApplication } from '@azure/msal-node';
import open from 'open';
import { parseEnvironment } from '../config/env.js';
import { parseEntraSettings } from '../modules/auth/infrastructure/entra.js';
import { acquireBrowserToken } from './browser-auth.js';

// Una identidad real, 20 solicitudes simultáneas de solo lectura.
// No imprime ni conserva el token; no modifica cantidades del inventario.
const timeout = setTimeout(() => {
  console.error('Tiempo de inicio de sesión agotado (5 minutos).');
  process.exit(1);
}, 300_000);
timeout.unref();

try {
  const settings = parseEntraSettings(process.env);
  const clientId = process.env.ENTRA_TEST_CLIENT_ID;
  if (!settings || !clientId || !settings.clientIds.includes(clientId.toLowerCase())) {
    throw new Error('Falta la configuración de Entra para esta prueba.');
  }
  const config = parseEnvironment(process.env);
  const client = new PublicClientApplication({
    auth: { clientId, authority: `https://login.microsoftonline.com/${settings.tenantId}` },
  });
  console.info('Inicia sesión en el navegador con un perfil activo y completa MFA si se solicita.');
  const token = await acquireBrowserToken(client, settings.audience, async (url) => {
    await open(url, { wait: false });
  });
  if (!token) throw new Error('No se obtuvo un token.');

  const url = `http://127.0.0.1:${config.PORT}/api/v1/inventario/stock?limite=25`;
  async function readStock(): Promise<{ status: number; ms: number }> {
    const start = performance.now();
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token!.accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    await response.arrayBuffer();
    return { status: response.status, ms: performance.now() - start };
  }

  const warmup = await readStock();
  if (warmup.status !== 200) throw new Error(`La lectura inicial devolvió HTTP ${warmup.status}.`);
  const settled = await Promise.allSettled(Array.from({ length: 20 }, () => readStock()));
  const successes = settled.flatMap((item) => item.status === 'fulfilled' && item.value.status === 200 ? [item.value.ms] : []);
  const failures = settled.length - successes.length;
  successes.sort((a, b) => a - b);
  const p95 = successes.length ? successes[Math.ceil(successes.length * 0.95) - 1]! : null;
  console.info(JSON.stringify({ solicitudes: 20, correctas: successes.length, fallidas: failures,
    p95Ms: p95 === null ? null : Math.round(p95), objetivoMs: 2000,
    cumple: failures === 0 && p95 !== null && p95 <= 2000 }, null, 2));
  if (failures || p95 === null || p95 > 2000) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : 'Error desconocido';
  // Nunca imprimir respuestas OAuth, URLs completas ni tokens.
  if (/^La lectura inicial devolvió HTTP \d{3}\.$/.test(message)) console.error(message);
  else console.error('No se completó la medición. Comprueba API local, Entra, perfil SQL y conectividad.');
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
