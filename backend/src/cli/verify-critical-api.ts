import { PublicClientApplication } from '@azure/msal-node';
import open from 'open';
import { acquireBrowserToken } from './browser-auth.js';

const tenantId = process.env.ENTRA_TENANT_ID;
const apiId = process.env.ENTRA_API_CLIENT_ID;
const clientId = process.env.ENTRA_TEST_CLIENT_ID;
if (!tenantId || !apiId || !clientId) throw new Error('Configuración Entra incompleta.');
const client = new PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` } });
console.log('Abriendo Microsoft para verificar la versión publicada.');
const token = await acquireBrowserToken(client, apiId, async (url) => { await open(url, { wait: false }); });
if (!token?.accessToken) throw new Error('Acceso Microsoft incompleto.');
const base = 'https://jorge-motors-api-dev-josen.azurewebsites.net/api/v1';
async function get(path: string) {
  const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token!.accessToken}` },
    cache: 'no-store', signal: AbortSignal.timeout(25_000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${body.error?.code ?? ''}`);
  return body;
}
const profile = await get('/auth/me');
const users = await get('/auth/users');
const tool = await get('/inventario/stock?buscar=SIM-HMA-002&limite=20');
if (profile.data.rol !== 'ADMINISTRADOR' || !Array.isArray(users.data) ||
  tool.data?.[0]?.tipo !== 'HERRAMIENTA') throw new Error('La API publicada no entregó perfiles o tipo de herramienta.');
console.log(JSON.stringify({ role: profile.data.rol, visibleUsers: users.data.length,
  toolSku: tool.data[0].sku, toolType: tool.data[0].tipo }));
