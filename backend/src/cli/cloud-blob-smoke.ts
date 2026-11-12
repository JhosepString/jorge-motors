import { createHash, randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { PublicClientApplication } from '@azure/msal-node';
import open from 'open';
import { parseEntraSettings } from '../modules/auth/infrastructure/entra.js';
import { acquireBrowserToken } from './browser-auth.js';

// Prueba puntual del despliegue demo. Usa un documento ficticio en memoria y deja
// proveedor, factura borrador y adjunto marcados como prueba para su revisión.
const base = 'https://jorge-motors-api-dev-josen.azurewebsites.net/api/v1';
const timeout = setTimeout(() => { console.error('Tiempo de acceso agotado.'); process.exit(1); }, 300_000);
timeout.unref();

async function samplePdf(): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.fontSize(16).text('Jorge Motors - comprobante ficticio de prueba Blob');
  doc.fontSize(10).text('Sin valor comercial ni tributario.');
  doc.end();
  return finished;
}

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
      ...options, headers: { ...bearer, ...options.headers },
      signal: AbortSignal.timeout(30_000), redirect: 'error', cache: 'no-store',
    });
    if (!response.ok) {
      let code = 'UNKNOWN';
      try { code = (await response.json())?.error?.code ?? code; } catch { /* No imprimir cuerpo ajeno. */ }
      throw new Error(`HTTP ${response.status} ${String(code).slice(0, 80)}`);
    }
    return response;
  }
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const supplier = await (await request('/compras/proveedores', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: `TESTBLOB-${suffix}`, razonSocial: 'Proveedor ficticio para prueba Blob', correo: null }),
  })).json();
  console.info(`Proveedor ficticio creado: ${supplier.data.id}`);
  const invoice = await (await request('/compras/facturas', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proveedorId: supplier.data.id, numero: `TEST-BLOB-${suffix}`,
      moneda: 'PEN', fecha: new Date().toISOString().slice(0, 10),
      lineas: [{ productoId: 1, cantidad: 1, precioUnitario: '0.00' }] }),
  })).json();
  console.info(`Factura de prueba creada en borrador: ${invoice.data.id}`);
  const file = await samplePdf();
  const uploaded = await (await request(`/compras/facturas/${invoice.data.id}/adjuntos?nombre=prueba-blob.pdf`, {
    method: 'POST', headers: { 'Content-Type': 'application/pdf', 'Idempotency-Key': randomUUID() },
    body: new Uint8Array(file),
  })).json();
  console.info(`Adjunto creado: ${uploaded.data.id}, estado ${uploaded.data.estado}`);
  const listed = await (await request(`/compras/facturas/${invoice.data.id}/adjuntos`)).json();
  if (!listed.data?.some((item: { id: string; estado: string }) => item.id === uploaded.data.id && item.estado === 'LISTO')) {
    throw new Error('El adjunto no figura LISTO en la lista.');
  }
  const download = await request(`/compras/facturas/${invoice.data.id}/adjuntos/${uploaded.data.id}/contenido`);
  const downloaded = Buffer.from(await download.arrayBuffer());
  const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
  if (hash(downloaded) !== hash(file)) throw new Error('El SHA-256 descargado no coincide.');
  console.info(`Blob verificado: ${file.length} bytes, descarga idéntica, SHA-256 ${hash(file)}`);
  console.info('El stock no cambió: la factura permanece en borrador.');
}

try { await main(); } catch (error) {
  console.error(`Prueba Blob no completada: ${error instanceof Error ? error.message : 'error'}`);
  process.exitCode = 1;
} finally { clearTimeout(timeout); }
