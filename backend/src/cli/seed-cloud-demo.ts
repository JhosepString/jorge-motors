import { PublicClientApplication } from '@azure/msal-node';
import { createHash } from 'node:crypto';
import open from 'open';
import { acquireBrowserToken } from './browser-auth.js';

const api = 'https://jorge-motors-api-dev-josen.azurewebsites.net/api/v1';
const tenantId = process.env.ENTRA_TENANT_ID;
const apiClientId = process.env.ENTRA_API_CLIENT_ID;
const clientId = process.env.ENTRA_TEST_CLIENT_ID;
if (!tenantId || !apiClientId || !clientId) throw new Error('Falta configuración Entra en backend/.env.');

const categories = ['Filtros', 'Lubricantes', 'Frenos', 'Electricidad', 'Suspensión'];
const products = [
  { sku: 'SIM-FIL-ACE-001', nombre: 'Filtro de aceite compacto', categoria: 'Filtros', minimo: 4, precio: '28.50', inicial: 12 },
  { sku: 'SIM-FIL-AIR-001', nombre: 'Filtro de aire motor', categoria: 'Filtros', minimo: 3, precio: '36.00', inicial: 8 },
  { sku: 'SIM-FIL-CAB-001', nombre: 'Filtro de cabina', categoria: 'Filtros', minimo: 2, precio: '32.00', inicial: 2 },
  { sku: 'SIM-ACE-5W30-001', nombre: 'Aceite sintético 5W-30, 1 L', categoria: 'Lubricantes', minimo: 6, precio: '42.00', inicial: 18 },
  { sku: 'SIM-LIQ-FRE-001', nombre: 'Líquido de frenos DOT 4, 500 ml', categoria: 'Lubricantes', minimo: 3, precio: '24.00', inicial: 5 },
  { sku: 'SIM-PAS-FRE-001', nombre: 'Juego de pastillas de freno delanteras', categoria: 'Frenos', minimo: 3, precio: '115.00', inicial: 7 },
  { sku: 'SIM-DIS-FRE-001', nombre: 'Disco de freno delantero', categoria: 'Frenos', minimo: 2, precio: '149.00', inicial: 1 },
  { sku: 'SIM-BUJ-ENC-001', nombre: 'Bujía de encendido', categoria: 'Electricidad', minimo: 8, precio: '19.50', inicial: 24 },
  { sku: 'SIM-BAT-12V-001', nombre: 'Batería 12 V 45 Ah', categoria: 'Electricidad', minimo: 2, precio: '295.00', inicial: 0 },
  { sku: 'SIM-AMP-DEL-001', nombre: 'Amortiguador delantero', categoria: 'Suspensión', minimo: 2, precio: '189.00', inicial: 4 },
  { sku: 'SIM-ROT-DIR-001', nombre: 'Rótula de dirección', categoria: 'Suspensión', minimo: 2, precio: '68.00', inicial: 0 },
] as const;
const suppliers = [
  { codigo: 'SIM-PROV-FILTROS', razonSocial: 'Distribuidora Filtros Demo SAC', correo: 'filtros@example.invalid' },
  { codigo: 'SIM-PROV-REPUESTOS', razonSocial: 'Repuestos Andinos Demo SAC', correo: 'repuestos@example.invalid' },
  { codigo: 'SIM-PROV-LUBRICANTES', razonSocial: 'Lubricantes del Sur Demo SAC', correo: 'lubricantes@example.invalid' },
] as const;

const client = new PublicClientApplication({ auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` } });
console.log('Abriendo Microsoft. Selecciona una cuenta Administrador de Jorge Motors.');
const timeout = setTimeout(() => { console.error('Tiempo de acceso agotado.'); process.exit(1); }, 300_000);
const session = await acquireBrowserToken(client, apiClientId, async (url) => { await open(url, { wait: false }); });
clearTimeout(timeout);
if (!session?.accessToken) throw new Error('No se recibió un token de Microsoft.');

async function request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    method, headers: { Authorization: `Bearer ${session.accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json() as T & { error?: { code?: string } };
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${payload.error?.code ?? ''}`);
  return payload;
}

type Profile = { data: { id: number; rol: string } };
type Page<T> = { data: T[]; siguiente: number | null };
type Category = { id: number; nombre: string };
type Product = { id: number; sku: string; stockActual: number };
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
  const value = createHash('sha256').update(`jorge-motors-demo-seed-v1:${sku}`).digest('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}

const profile = await request<Profile>('GET', '/auth/me');
if (profile.data.rol !== 'ADMINISTRADOR') throw new Error('La sesión seleccionada no es Administrador. No se cargaron datos.');
const categoryRows = await all<Category>('/catalogo/categorias');
const categoryIds = new Map(categoryRows.map((row) => [row.nombre, row.id]));
for (const nombre of categories) {
  if (!categoryIds.has(nombre)) {
    const created = await request<{ data: Category }>('POST', '/catalogo/categorias', { nombre });
    categoryIds.set(nombre, created.data.id);
    console.log(`Categoría creada: ${nombre}`);
  }
}
const productRows = await all<Product>('/catalogo/productos');
const productIds = new Map(productRows.map((row) => [row.sku, row.id]));
for (const product of products) {
  if (productIds.has(product.sku)) {
    console.log(`Producto existente, sin modificar: ${product.sku}`);
    continue;
  }
  const created = await request<{ data: Product }>('POST', '/catalogo/productos', {
    sku: product.sku, nombre: product.nombre, categoriaId: categoryIds.get(product.categoria),
    stockMinimo: product.minimo, precioCompra: product.precio,
  });
  productIds.set(product.sku, created.data.id);
  console.log(`Producto creado: ${product.sku}`);
  if (product.inicial > 0) {
    await request('POST', '/inventario/entradas', {
      productoId: created.data.id, cantidad: product.inicial,
      motivo: 'Carga inicial ficticia para pruebas', referencia: 'SIM-SEED-2026-11',
    }, { 'Idempotency-Key': seedKey(product.sku) });
    console.log(`Entrada inicial: ${product.sku}, ${product.inicial} unidades`);
  }
}
const supplierRows = await all<Supplier>('/compras/proveedores');
const supplierCodes = new Set(supplierRows.map((row) => row.codigo));
for (const supplier of suppliers) {
  if (supplierCodes.has(supplier.codigo)) continue;
  await request('POST', '/compras/proveedores', supplier);
  console.log(`Proveedor creado: ${supplier.codigo}`);
}
console.log(JSON.stringify({ categories: categories.length, products: products.length, suppliers: suppliers.length,
  initialUnits: products.reduce((sum, product) => sum + product.inicial, 0) }));
