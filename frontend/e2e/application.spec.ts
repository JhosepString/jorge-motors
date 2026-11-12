import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const stock = [
  {
    id: 1,
    sku: 'DEMO-FIL-001',
    nombre: 'Filtro de aceite',
    categoriaId: 1,
    categoria: 'Filtros',
    stockActual: 4,
    stockMinimo: 2,
  },
  {
    id: 2,
    sku: 'DEMO-FRE-002',
    nombre: 'Pastillas de freno',
    categoriaId: 2,
    categoria: 'Frenos',
    stockActual: 2,
    stockMinimo: 3,
  },
];
async function fixture(
  page: Page,
  role = 'ADMINISTRADOR',
  options: { failMovementOnce?: boolean; staleProduct?: boolean; failReceiptOnce?: boolean } = {},
) {
  const calls: { path: string; query: string; method: string; key: string | undefined; body: unknown }[] = [];
  let movementCalls = 0;
  let receiptCalls = 0;
  let invoiceCreated = false;
  let invoice = {
    id: 4,
    numero: 'F001-123',
    proveedorId: 1,
    proveedorNombre: 'Proveedor ficticio',
    fecha: '2026-10-21',
    moneda: 'PEN',
    total: '51.00',
    estado: 'BORRADOR',
    version: '0000000000000001',
    lineas: [
      {
        productoId: 1,
        sku: 'DEMO-FIL-001',
        nombre: 'Filtro de aceite',
        cantidad: 2,
        precioUnitario: '25.50',
        importe: '51.00',
        movimientoId: null as number | null,
      },
    ],
  };
  await page.route('http://localhost:5174/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/api/v1', '');
    calls.push({
      path,
      query: url.search,
      method: req.method(),
      key: req.headers()['idempotency-key'],
      body: req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : null,
    });
    const send = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        json: body,
        headers: {
          'Access-Control-Allow-Origin': 'http://localhost:5174',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
        },
      });
    if (req.method() === 'OPTIONS') return send({});
    if (path === '/auth/me')
      return send({
        data: {
          id: role === 'ADMINISTRADOR' ? 1 : 2,
          nombres: role === 'ADMINISTRADOR' ? 'Administrador Demo' : 'Mecánico Demo',
          rol: role,
        },
      });
    if (path === '/auth/users') {
      if (req.method() === 'POST') return send({ data: { id: 3, ...req.postDataJSON() } }, 201);
      return send({ data: [{ id: 1, objectId: '11111111-1111-4111-8111-111111111111',
        nombres: 'Administrador Demo', rol: 'ADMINISTRADOR', activo: true },
      { id: 2, objectId: '22222222-2222-4222-8222-222222222222',
        nombres: 'Mecánico Demo', rol: 'MECANICO', activo: true }] });
    }
    if (path === '/sync/devices') return send({ data: [{ deviceId: '33333333-3333-4333-8333-333333333333',
      active: true, createdAt: '2026-11-12T00:00:00Z', revokedAt: null,
      quotaRemaining: '0', productsWithQuota: 0 }] });
    if (path === '/sync/quotas' && req.method() === 'POST') return send({ data: { remaining: 3 } }, 201);
    if (path === '/inventario/stock')
      return send({
        data: stock.filter((p) =>
          `${p.nombre} ${p.sku}`.toLowerCase().includes((url.searchParams.get('buscar') ?? '').toLowerCase()),
        ),
        siguiente: null,
      });
    if (path === '/inventario/categorias')
      return send({
        data: [
          { id: 1, nombre: 'Filtros' },
          { id: 2, nombre: 'Frenos' },
        ],
        siguiente: null,
      });
    if (path === '/inventario/movimientos')
      return send({
        data: [
          {
            id: 1,
            productoId: 1,
            sku: stock[0]!.sku,
            nombre: stock[0]!.nombre,
            usuarioId: role === 'ADMINISTRADOR' ? 1 : 2,
            tipo: 'SALIDA',
            cantidad: 1,
            stockAnterior: 5,
            stockResultante: 4,
            motivo: 'Prueba aislada',
            referencia: null,
            fecha: '2026-10-21T19:00:00Z',
          },
        ],
        siguiente: null,
      });
    if (path === '/reportes/inventario')
      return send({
        moneda: 'PEN',
        filtros: { incluirInactivos: false, soloBajoMinimo: false },
        resumen: { productos: 2, agotados: 0, bajoMinimo: 1, inactivos: 0 },
        data: stock.map((p) => ({
          ...p,
          activo: true,
          precioCompra: '25.50',
          estado: p.stockActual <= p.stockMinimo ? 'BAJO_MINIMO' : 'NORMAL',
        })),
      });
    if (path === '/reportes/inventario/exportar')
      return route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: Buffer.from('%PDF-1.7\nFICTICIO_SOLO_PRUEBA'),
        headers: { 'Access-Control-Allow-Origin': 'http://localhost:5174' },
      });
    if (path === '/inventario/salidas' || path === '/inventario/entradas') {
      if (options.failMovementOnce && ++movementCalls === 1) return route.abort('failed');
      const body = req.postDataJSON() as { cantidad: number; motivo: string; referencia?: string };
      return send({
        data: {
          id: 7,
          productoId: 1,
          usuarioId: 2,
          tipo: path.endsWith('salidas') ? 'SALIDA' : 'ENTRADA',
          cantidad: body.cantidad,
          stockAnterior: 4,
          stockResultante: 4 - body.cantidad,
          motivo: body.motivo,
          referencia: body.referencia ?? null,
          fecha: '2026-10-21T19:00:00Z',
        },
        repetido: !!options.failMovementOnce,
      });
    }
    if (path === '/catalogo/productos/1') {
      if (req.method() === 'PUT')
        return options.staleProduct
          ? send(
              {
                error: {
                  code: 'STALE_VERSION',
                  message: 'Otro cambio modificó el registro.',
                  requestId: 'ficticio',
                },
              },
              412,
            )
          : send({ data: {} });
      return send({
        data: {
          ...stock[0],
          precioCompra: '25.50',
          activo: true,
          version: '00000000000000010000000000000002',
        },
      });
    }
    if (path === '/compras/proveedores')
      return send({
        data: [
          {
            id: 1,
            codigo: 'PROV-001',
            razonSocial: 'Proveedor ficticio',
            correo: 'demo@example.test',
            activo: true,
            version: '0000000000000001',
          },
        ],
        siguiente: null,
      });
    if (path === '/compras/facturas') {
      if (req.method() === 'POST') {
        invoiceCreated = true;
        return send({ data: invoice }, 201);
      }
      return send({ data: invoiceCreated ? [invoice] : [], siguiente: null });
    }
    if (path === '/compras/facturas/4') return send({ data: invoice });
    if (path === '/compras/facturas/4/adjuntos') return send({ data: [] });
    if (path === '/compras/facturas/4/confirmar') {
      if (options.failReceiptOnce && ++receiptCalls === 1) return route.abort('failed');
      invoice = {
        ...invoice,
        estado: 'RECIBIDA',
        version: '0000000000000002',
        lineas: invoice.lineas.map((l) => ({ ...l, movimientoId: 8 })),
      };
      return send({ data: invoice, repetido: !!options.failReceiptOnce }, 201);
    }
    return send({ error: { code: 'NOT_MOCKED', message: 'Ruta no simulada.' } }, 404);
  });
  await page.goto('/e2e/fixture.html');
  return calls;
}
test('Acceso real sin configuración: no pide contraseñas ni ofrece bypass', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuar con Microsoft' })).toBeDisabled();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/acceso.png', fullPage: true });
});
test('Administrador registra perfil y muestra los pasos de Entra', async ({ page }) => {
  const calls = await fixture(page);
  await page.getByRole('link', { name: 'Usuarios' }).click();
  await expect(page.getByRole('heading', { name: 'Usuarios' })).toBeVisible();
  await expect(page.getByText('Primero crea la cuenta en Microsoft Entra')).toBeVisible();
  await page.getByLabel('Id. de objeto de Microsoft Entra').fill('22222222-2222-4222-8222-222222222222');
  await page.getByLabel('Nombre para mostrar').fill('Mecánico Prueba');
  await page.getByRole('button', { name: 'Guardar perfil' }).click();
  await expect(page.getByText('Perfil registrado.')).toBeVisible();
  expect(calls.some((call) => call.path === '/auth/users' && call.method === 'POST')).toBe(true);
});
test('Equipos: el administrador asigna cupo de producto a un mecánico concreto', async ({ page }) => {
  const calls = await fixture(page);
  await page.getByRole('link', { name: 'Equipos' }).click();
  await page.getByRole('button', { name: 'Asignar cupo local' }).click();
  await page.getByLabel('Destino del cupo').selectOption('2');
  await page.getByLabel('Buscar producto').fill('DEMO-FIL-001');
  await page.getByRole('combobox', { name: 'Producto', exact: true }).selectOption('1');
  await page.getByLabel('Unidades a reservar').fill('3');
  await page.getByRole('button', { name: 'Confirmar cupo' }).click();
  await expect(page.getByText(/Cupo asignado/)).toBeVisible();
  const sent = calls.find((call) => call.path === '/sync/quotas' && call.method === 'POST');
  expect(sent?.body).toMatchObject({ userId: 2, productId: 1, quantity: 3 });
});
test('Historial: fecha única o rango se envía al servidor y reinicia la paginación', async ({ page }) => {
  const calls = await fixture(page);
  await page.getByRole('link', { name: 'Movimientos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Historial de movimientos' })).toBeVisible();
  await page.getByLabel('Desde').fill('2026-11-10');
  await page.getByLabel('Hasta').fill('2026-11-12');
  await page.getByRole('button', { name: 'Aplicar fechas' }).click();
  await expect.poll(() => calls.filter((call) => call.path === '/inventario/movimientos').length).toBe(2);
  const query = new URLSearchParams(calls.at(-1)!.query);
  expect(query.get('despuesDe')).toBe('0');
  expect(query.get('fechaDesde')).toBe(new Date('2026-11-10T00:00:00').toISOString());
  const exclusiveEnd = new Date('2026-11-12T00:00:00');
  exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
  expect(query.get('fechaHasta')).toBe(exclusiveEnd.toISOString());
  await page.getByLabel('Hasta').fill('2026-11-09');
  await expect(page.getByRole('button', { name: 'Aplicar fechas' })).toBeDisabled();
  await page.getByRole('button', { name: 'Limpiar fechas' }).click();
  await expect.poll(() => calls.filter((call) => call.path === '/inventario/movimientos').length).toBe(3);
  expect(new URLSearchParams(calls.at(-1)!.query).has('fechaDesde')).toBe(false);
});
test('Modo local: explica por qué una salida sin cupo está bloqueada y permite entradas', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { jorgeDesktop: unknown }).jorgeDesktop = {
      state: async () => ({ configured: true, signedIn: true, offlineAuthorized: true,
        offlineProfile: { id: 1, nombres: 'Administrador Demo', rol: 'ADMINISTRADOR' }, apiBaseUrl: null }),
      localStatus: async () => ({ ready: true, online: false, pending: 0,
        profile: { id: 1, nombres: 'Administrador Demo', rol: 'ADMINISTRADOR' } }),
      localInventory: async () => [{ id: 1, sku: 'SIM-FIL-001', name: 'Filtro',
        confirmedStock: 4, offlineQuota: 0, stockMinimum: 1 }],
      localOperations: async () => [],
      localMove: async () => { throw new Error('No debe registrar la salida sin cupo.'); },
    };
  });
  await fixture(page);
  await page.getByRole('link', { name: 'Modo local' }).click();
  await page.getByLabel('Buscar repuesto por SKU o nombre').fill('SIM-FIL');
  await page.getByRole('button', { name: 'Filtro' }).click();
  await expect(page.getByRole('alert')).toContainText('0 unidades de cupo');
  await expect(page.getByRole('button', { name: 'Guardar en este equipo' })).toBeDisabled();
  await page.getByLabel('Tipo').selectOption('ENTRADA');
  await expect(page.getByRole('button', { name: 'Guardar en este equipo' })).toBeEnabled();
});
test('Modo local: mecánico no supera 20 salidas pendientes del mismo producto', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { jorgeDesktop: unknown }).jorgeDesktop = {
      state: async () => ({ configured: true, signedIn: true, offlineAuthorized: true,
        offlineProfile: { id: 2, nombres: 'Mecánico Demo', rol: 'MECANICO' }, apiBaseUrl: null }),
      localStatus: async () => ({ ready: true, online: false, pending: 1,
        profile: { id: 2, nombres: 'Mecánico Demo', rol: 'MECANICO' } }),
      localInventory: async () => [{ id: 1, sku: 'SIM-FIL-001', name: 'Filtro',
        confirmedStock: 40, offlineQuota: 30, stockMinimum: 1, unsettledExits: 19 }],
      localOperations: async () => [],
    };
  });
  await fixture(page, 'MECANICO');
  await page.getByRole('link', { name: 'Modo local' }).click();
  await page.getByLabel('Buscar repuesto por SKU o nombre').fill('SIM-FIL');
  await page.getByRole('button', { name: 'Filtro' }).click();
  await expect(page.getByText('te quedan 1 de 20 unidades')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar en este equipo' })).toBeEnabled();
  await page.getByLabel('Cantidad').fill('2');
  await expect(page.getByRole('alert')).toContainText('Superas el máximo de 20');
  await expect(page.getByRole('button', { name: 'Guardar en este equipo' })).toBeDisabled();
});
test('Administrador: navegación, inventario, formulario versionado y error 412 visible', async ({ page }) => {
  const calls = await fixture(page, 'ADMINISTRADOR', { staleProduct: true });
  await page.getByRole('link', { name: 'Inventario', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Productos y existencias' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Filtro de aceite' })).toBeVisible();
  await page.screenshot({ path: 'test-results/inventario-admin.png', fullPage: true });
  await page.getByRole('button', { name: 'Editar →' }).first().click();
  await page.getByLabel('Nombre', { exact: true }).fill('Filtro actualizado');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Otro cambio modificó el registro');
  expect(calls.find((r) => r.path === '/catalogo/productos/1' && r.method === 'PUT')).toBeTruthy();
});
test('Mecánico: sin precios/reportes/entradas; salida conserva clave al reintentar', async ({ page }) => {
  const calls = await fixture(page, 'MECANICO', { failMovementOnce: true });
  await page.getByRole('link', { name: 'Consultar stock' }).click();
  await expect(page.getByRole('heading', { name: 'Consulta de stock' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reportes', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Registrar salida', exact: true }).click();
  await page.getByLabel('Buscar repuesto por SKU o nombre').fill('FIL-001');
  await page.getByRole('button', { name: /Filtro de aceite.*FIL-001/ }).click();
  await page.getByLabel('Cantidad', { exact: true }).fill('1');
  await page.getByLabel('Motivo', { exact: true }).fill('Uso en prueba aislada');
  await page.getByRole('button', { name: 'Confirmar salida' }).click();
  await expect(page.getByRole('alert')).toContainText('No se pudo confirmar');
  await page.getByRole('button', { name: 'Reintentar la misma operación' }).click();
  await expect(page.getByRole('heading', { name: 'Movimiento guardado' })).toBeVisible();
  const sent = calls.filter((r) => r.path === '/inventario/salidas' && r.method === 'POST');
  expect(sent).toHaveLength(2);
  expect(sent[0]!.key).toBe(sent[1]!.key);
  expect(sent[0]!.body).not.toHaveProperty('usuarioId');
  expect(sent[0]!.body).not.toHaveProperty('referencia');
  expect(calls.some((r) => r.path === '/inventario/entradas')).toBe(false);
});
test('Movimiento: busca en el servidor sin cargar un desplegable completo', async ({ page }) => {
  const calls = await fixture(page, 'MECANICO');
  await page.getByRole('link', { name: 'Registrar salida', exact: true }).click();
  expect(calls.filter((r) => r.path === '/inventario/stock')).toHaveLength(0);
  await page.getByLabel('Buscar repuesto por SKU o nombre').fill('FIL-001');
  await expect(page.getByRole('button', { name: /Filtro de aceite.*FIL-001/ })).toBeVisible();
  const searches = calls.filter((r) => r.path === '/inventario/stock');
  expect(searches).toHaveLength(1);
  expect(new URLSearchParams(searches[0]!.query).get('limite')).toBe('20');
  expect(new URLSearchParams(searches[0]!.query).get('buscar')).toBe('FIL-001');
  await page.getByRole('button', { name: /Filtro de aceite.*FIL-001/ }).click();
  await expect(page.getByText('Producto seleccionado:')).toContainText('DEMO-FIL-001');
});
test('Salida: cantidad mayor al saldo bloquea confirmación sin tocar API', async ({ page }) => {
  const calls = await fixture(page, 'MECANICO');
  await page.getByRole('link', { name: 'Registrar salida', exact: true }).click();
  await page.getByLabel('Buscar repuesto por SKU o nombre').fill('FIL-001');
  await page.getByRole('button', { name: /Filtro de aceite.*FIL-001/ }).click();
  await page.getByLabel('Cantidad', { exact: true }).fill('5');
  await page.getByLabel('Motivo', { exact: true }).fill('Demostración');
  await expect(page.getByRole('button', { name: 'Confirmar salida' })).toBeDisabled();
  expect(calls.some((r) => r.method === 'POST')).toBe(false);
});
test('Reportes: PDF usa endpoint real de contrato y descarga, sin imprimir token', async ({ page }) => {
  await fixture(page);
  await page.getByRole('link', { name: 'Reportes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reportes', exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar PDF' }).click();
  expect((await download).suggestedFilename()).toBe('inventario.pdf');
  await expect(page.getByRole('status').filter({ hasText: 'Archivo generado' })).toBeVisible();
});
test('Móvil: menú accesible, tarjetas sin desbordamiento horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, 'MECANICO');
  await page.getByRole('button', { name: 'Abrir navegación' }).click();
  await page.getByRole('link', { name: 'Consultar stock' }).click();
  await expect(page.getByRole('heading', { name: 'Consulta de stock' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/stock-mobile.png', fullPage: true });
});
test('Proveedores y compras: listas reales de contrato, sin canales ficticios ni cifras inventadas', async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole('link', { name: 'Proveedores', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Proveedor ficticio' })).toBeVisible();
  await page.getByRole('link', { name: 'Compras', exact: true }).click();
  await expect(page.getByText('No hay facturas registradas.')).toBeVisible();
  await page.getByRole('button', { name: 'Nueva factura' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar borrador' })).toBeVisible();
});
test('Accesibilidad: acceso y consulta de stock sin infracciones WCAG A/AA detectadas', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bienvenido de nuevo' })).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations,
  ).toEqual([]);
  await fixture(page, 'MECANICO');
  await page.getByRole('link', { name: 'Consultar stock' }).click();
  await expect(page.getByRole('heading', { name: 'Consulta de stock' })).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations,
  ).toEqual([]);
});
test('Compras: crear borrador PEN, revisar y reintentar recepción con la misma clave', async ({ page }) => {
  const calls = await fixture(page, 'ADMINISTRADOR', { failReceiptOnce: true });
  await page.getByRole('link', { name: 'Compras', exact: true }).click();
  await page.getByRole('button', { name: 'Nueva factura' }).click();
  await page.getByRole('combobox', { name: 'Proveedor', exact: true }).selectOption('1');
  await page.getByLabel('Número de documento', { exact: true }).fill('F001-123');
  await page.getByLabel('Fecha', { exact: true }).fill('2026-10-21');
  await page.getByLabel('Buscar producto para la línea 1 por SKU o nombre').fill('FIL-001');
  await page.getByRole('button', { name: /Filtro de aceite.*FIL-001/ }).click();
  await page.getByLabel('Cantidad', { exact: true }).fill('2');
  await page.getByLabel('Precio final PEN', { exact: true }).fill('25.50');
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(page.getByRole('heading', { name: 'F001-123' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar recepción completa' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirmar recepción completa' }).click();
  await expect(page.getByRole('alert')).toContainText('No se pudo confirmar');
  await page.getByRole('button', { name: 'Confirmar recepción completa' }).click();
  await expect(page.getByRole('dialog').getByText('Recibida', { exact: true })).toBeVisible();
  const receipts = calls.filter((c) => c.path.endsWith('/confirmar') && c.method === 'POST');
  expect(receipts).toHaveLength(2);
  expect(receipts[0]!.key).toBe(receipts[1]!.key);
  const creation = calls.find((c) => c.path === '/compras/facturas' && c.method === 'POST');
  expect(creation?.body).toMatchObject({
    moneda: 'PEN',
    lineas: [{ productoId: 1, cantidad: 2, precioUnitario: '25.50' }],
  });
});
