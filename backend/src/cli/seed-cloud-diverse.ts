import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PublicClientApplication } from '@azure/msal-node';
import open from 'open';
import { acquireBrowserToken } from './browser-auth.js';

const api = 'https://jorge-motors-api-dev-josen.azurewebsites.net/api/v1';
const tenantId = process.env.ENTRA_TENANT_ID;
const apiClientId = process.env.ENTRA_API_CLIENT_ID;
const clientId = process.env.ENTRA_TEST_CLIENT_ID;
if (!tenantId || !apiClientId || !clientId) throw new Error('Falta configuración Entra en backend/.env.');

type Fixture = {
  version: number;
  categories: { name: string }[];
  suppliers: { codigo: string; razonSocial: string; correo: string }[];
  products: { sku: string; nombre: string; categoria: string; tipo: string;
    stockMinimo: number; precioCompra: string; stockInicial: number }[];
};
const fixturePath = new URL('../../../deployment/fixtures/inventario-demo-diverso.preview.json', import.meta.url);
const fixture = JSON.parse(await readFile(fileURLToPath(fixturePath), 'utf8')) as Fixture;
if (fixture.version !== 2 || fixture.products.length !== 600 || fixture.categories.length !== 30
  || fixture.suppliers.length !== 12 || new Set(fixture.products.map((p) => p.sku)).size !== 600) {
  throw new Error('La vista previa diversa no coincide con la carga esperada.');
}
const expectedUnits = fixture.products.reduce((total, p) => total + p.stockInicial, 0);
if (expectedUnits !== 6644) throw new Error('Cambió el inventario inicial de la vista previa.');

const client = new PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` } });
console.log('Abriendo Microsoft. Selecciona una cuenta Administrador de Jorge Motors.');
const timeout = setTimeout(() => { console.error('Tiempo de acceso agotado.'); process.exit(1); }, 300_000);
const session = await acquireBrowserToken(client, apiClientId, async (url) => { await open(url, { wait: false }); });
clearTimeout(timeout);
if (!session?.accessToken) throw new Error('No se recibió un token de Microsoft.');

async function request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(`${api}${path}`, {
      method, headers: { Authorization: `Bearer ${session.accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45_000),
    });
    if ([429, 502, 503, 504].includes(response.status) && attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 8000)));
      continue;
    }
    const payload = await response.json() as T & { error?: { code?: string } };
    if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${payload.error?.code ?? ''}`);
    return payload;
  }
  throw new Error(`${method} ${path}: servicio no disponible tras reintentos.`);
}
type Profile = { data: { rol: string } };
type Page<T> = { data: T[]; siguiente: number | null };
type Category = { id: number; nombre: string };
type Product = { id: number; sku: string; nombre: string; stockActual: number };
type Supplier = { id: number; codigo: string };
async function all<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  let cursor = 0;
  while (true) {
    const page = await request<Page<T>>('GET', `${path}?despuesDe=${cursor}&limite=100`);
    rows.push(...page.data);
    if (page.siguiente === null) return rows;
    cursor = page.siguiente;
  }
}
function seedKey(sku: string): string {
  const value = createHash('sha256').update(`jorge-motors-diverse-seed-v2:${sku}`).digest('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
const profile = await request<Profile>('GET', '/auth/me');
if (profile.data.rol !== 'ADMINISTRADOR') throw new Error('La cuenta seleccionada no es Administrador. No se cargaron datos.');

const categoryRows = await all<Category>('/catalogo/categorias');
const categoryIds = new Map(categoryRows.map((row) => [row.nombre, row.id]));
let createdCategories = 0;
for (const category of fixture.categories) {
  if (categoryIds.has(category.name)) continue;
  const created = await request<{ data: Category }>('POST', '/catalogo/categorias', { nombre: category.name });
  categoryIds.set(category.name, created.data.id);
  createdCategories++;
}
console.log(`Categorías preparadas: ${fixture.categories.length}; nuevas: ${createdCategories}.`);

const existingProducts = await all<Product>('/catalogo/productos');
const productIds = new Map(existingProducts.map((row) => [row.sku, row]));
let createdProducts = 0;
let seededUnits = 0;
for (const [index, product] of fixture.products.entries()) {
  let row = productIds.get(product.sku);
  if (row && row.nombre !== product.nombre) throw new Error(`SKU ocupado con otro nombre: ${product.sku}`);
  if (!row) {
    const created = await request<{ data: Product }>('POST', '/catalogo/productos', {
      sku: product.sku, nombre: product.nombre, categoriaId: categoryIds.get(product.categoria),
      stockMinimo: product.stockMinimo, precioCompra: product.precioCompra,
    });
    row = created.data;
    createdProducts++;
  }
  if (product.stockInicial > 0) {
    await request('POST', '/inventario/entradas', {
      productoId: row.id, cantidad: product.stockInicial,
      motivo: 'Carga inicial ficticia de catálogo diverso', referencia: 'SIM-DIVERSO-2026-11',
    }, { 'Idempotency-Key': seedKey(product.sku) });
    seededUnits += product.stockInicial;
  }
  if ((index + 1) % 25 === 0) console.log(`Productos procesados: ${index + 1}/${fixture.products.length}.`);
}

const existingSuppliers = await all<Supplier>('/compras/proveedores');
const supplierCodes = new Set(existingSuppliers.map((row) => row.codigo));
let createdSuppliers = 0;
for (const supplier of fixture.suppliers) {
  if (supplierCodes.has(supplier.codigo)) continue;
  await request('POST', '/compras/proveedores', supplier);
  createdSuppliers++;
}

const actualProducts = await all<Product>('/catalogo/productos');
const actualBySku = new Map(actualProducts.map((row) => [row.sku, row]));
const missing = fixture.products.filter((p) => !actualBySku.has(p.sku));
const stockMismatches = fixture.products.filter((p) => actualBySku.get(p.sku)?.stockActual !== p.stockInicial)
  .map((p) => ({ sku: p.sku, expected: p.stockInicial, actual: actualBySku.get(p.sku)?.stockActual }));
const result = { expectedProducts: fixture.products.length, createdProducts, createdCategories, createdSuppliers,
  expectedUnits, seededUnits, missing: missing.length, stockMismatches: stockMismatches.slice(0, 10),
  stockMismatchCount: stockMismatches.length };
console.log(JSON.stringify(result));
if (missing.length || stockMismatches.length) process.exitCode = 1;
