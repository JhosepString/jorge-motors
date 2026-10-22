import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, beforeEach, after, test } from 'node:test';
import request from 'supertest';
import { connectSql, SqlPoolSingleton, type SqlConnection } from '../../src/infrastructure/database/sql-pool.js';
import { parseSqlSettings } from '../../src/infrastructure/database/sql-settings.js';
import { migrateInventory } from '../../src/infrastructure/database/migrate.js';
import { SqlCatalogUnitOfWork } from '../../src/infrastructure/database/sql-catalog.js';
import { SqlInventoryUnitOfWork } from '../../src/infrastructure/database/sql-inventory.js';
import { CatalogoFacade } from '../../src/modules/catalogo/application/catalogo.facade.js';
import { InventarioFacade } from '../../src/modules/inventario/application/inventario.facade.js';
import { inventoryEvents } from '../../src/infrastructure/inventory-events.js';
import { createApp } from '../../src/app.js';
import { runtimeServices } from '../../src/infrastructure/runtime-services.js';
import { parseEnvironment } from '../../src/config/env.js';
import { tenantId, apiId, clientId, testVerifier, signTestToken } from '../helpers/entra-fixture.js';
import { NotificationWorker } from '../../src/modules/alertas/application/notification-worker.js';
import { SqlNotificationDispatch } from '../../src/infrastructure/database/sql-notification-dispatch.js';
import ExcelJS from 'exceljs';

test('Reportes HTTP: acceso exclusivo Administrador y consulta auditada sin cambiar stock', async () => {
  await request(app).get('/api/v1/reportes/inventario').expect(401);
  await request(app).get('/api/v1/reportes/inventario').auth(mechanicToken, { type: 'bearer' }).expect(403);
  const p = await product('9999999999999999.99');
  const result = await request(app).get(`/api/v1/reportes/inventario?categoriaId=${p.categoriaId}`).set(auth()).expect(200);
  assert.equal(result.body.data.length, 1); assert.equal(result.body.data[0].precioCompra, '9999999999999999.99');
  assert.equal(result.body.data[0].estado, 'AGOTADO'); assert.equal(result.body.resumen.bajoMinimo, 1);
  assert.equal(result.headers['cache-control'], 'no-store');
  const audit = await connection.pool.request().input('rid', connection.driver.UniqueIdentifier, result.headers['x-request-id'])
    .query<{ accion: string }>('SELECT accion FROM jm.auditoria WHERE request_id=@rid;');
  assert.equal(audit.recordset[0]!.accion, 'REPORTE_INVENTARIO_CONSULTADO');
  assert.equal((await catalog.obtenerProducto(p.id, administrator, randomUUID())).version, p.version);
});

test('Reportes SQL: mínimo inclusivo y filtros distinguen inactivos de reposición requerida', async () => {
  const p = await product();
  await connection.pool.request().input('id', connection.driver.Int, p.id).query('UPDATE jm.producto SET activo=0 WHERE id=@id;');
  const base = `/api/v1/reportes/inventario?categoriaId=${p.categoriaId}`;
  const active = await request(app).get(base).set(auth()).expect(200); assert.equal(active.body.data.length, 0);
  const all = await request(app).get(base + '&incluirInactivos=true').set(auth()).expect(200);
  assert.equal(all.body.data[0].estado, 'INACTIVO'); assert.equal(all.body.resumen.bajoMinimo, 0);
  const low = await request(app).get(base + '&incluirInactivos=true&soloBajoMinimo=true').set(auth()).expect(200);
  assert.equal(low.body.data.length, 0);
});

test('Reportes HTTP: consulta JSON rechaza filtros desconocidos y formato reservado a exportar', async () => {
  for (const query of ['categoriaId=1x', 'incluirInactivos=1', 'formato=pdf', 'limite=2000']) {
    await request(app).get('/api/v1/reportes/inventario?' + query).set(auth()).expect(400);
  }
});

test('Reportes SQL: más de 1000 productos exige filtros, sin truncar silenciosamente', async () => {
  const cat = await category();
  await connection.pool.request().input('cat', connection.driver.Int, cat.id).query(`INSERT INTO jm.producto(sku,nombre,categoria_id)
    SELECT TOP (1001) CONVERT(varchar(36),NEWID()),N'Producto ficticio límite reporte',@cat
    FROM sys.all_objects a CROSS JOIN sys.all_objects b;
    INSERT INTO jm.stock(producto_id,cantidad_actual) SELECT id,0 FROM jm.producto WHERE categoria_id=@cat;`);
  const result = await request(app).get(`/api/v1/reportes/inventario?categoriaId=${cat.id}`).set(auth()).expect(413);
  assert.equal(result.body.error.code, 'REPORT_TOO_LARGE');
  await request(app).get(`/api/v1/reportes/inventario/exportar?formato=pdf&categoriaId=${cat.id}`).set(auth()).expect(413);
});

test('Reportes SQL+HTTP: dos Strategy concretas, descarga administrativa y auditoría sin cambiar producto', async () => {
  const p = await product('25.50');
  const path = `/api/v1/reportes/inventario/exportar?categoriaId=${p.categoriaId}`;
  await request(app).get(path + '&formato=pdf').expect(401);
  await request(app).get(path + '&formato=xlsx').auth(mechanicToken, { type: 'bearer' }).expect(403);
  for (const formato of ['pdf', 'xlsx']) {
    const response = await request(app).get(path + '&formato=' + formato).set(auth()).buffer(true).parse((res, callback) => {
      const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.once('end', () => callback(null, Buffer.concat(chunks))); res.once('error', callback);
    }).expect(200);
    assert.ok(Buffer.isBuffer(response.body)); assert.equal(response.headers['cache-control'], 'no-store');
    if (formato === 'pdf') assert.equal(response.body.subarray(0, 5).toString(), '%PDF-');
    else {
      const book = new ExcelJS.Workbook(); await book.xlsx.load(new Uint8Array(response.body) as never);
      assert.equal(book.getWorksheet('Inventario')!.getCell('G9').value, 25.5);
      assert.equal(book.getWorksheet('Inventario')!.getCell('E9').value, 0);
    }
    const audit = await connection.pool.request().input('rid', connection.driver.UniqueIdentifier, response.headers['x-request-id'])
      .query<{ accion: string; valores_nuevos: string }>('SELECT accion,valores_nuevos FROM jm.auditoria WHERE request_id=@rid;');
    assert.equal(audit.recordset[0]!.accion, 'REPORTE_INVENTARIO_GENERADO');
    assert.equal(JSON.parse(audit.recordset[0]!.valores_nuevos).formato, formato);
  }
  assert.equal((await catalog.obtenerProducto(p.id, administrator, randomUUID())).version, p.version);
});

test('Reportes SQL: precio incompatible con Excel no genera éxito; PDF sí conserva capacidad exacta', async () => {
  const p = await product('9999999999999999.99');
  const response = await request(app).get(`/api/v1/reportes/inventario/exportar?formato=xlsx&categoriaId=${p.categoriaId}`).set(auth()).expect(422);
  assert.equal(response.body.error.code, 'REPORT_EXCEL_PRECISION');
  const audit = await connection.pool.request().input('rid', connection.driver.UniqueIdentifier, response.headers['x-request-id'])
    .query<{ accion: string }>('SELECT accion FROM jm.auditoria WHERE request_id=@rid;');
  assert.equal(audit.recordset[0]!.accion, 'HTTP_RECHAZADA');
  await request(app).get(`/api/v1/reportes/inventario/exportar?formato=pdf&categoriaId=${p.categoriaId}`).set(auth()).expect(200);
});

test('Reportes SQL: fallo real de auditoría revierte éxito y no entrega archivo', async () => {
  const p = await product();
  await connection.pool.request().batch(`CREATE TRIGGER jm.tr_report_audit_fail ON jm.auditoria AFTER INSERT AS
    IF EXISTS (SELECT 1 FROM inserted WHERE accion='REPORTE_INVENTARIO_GENERADO') THROW 51000, 'Fallo de prueba', 1;`);
  try {
    const response = await request(app).get(`/api/v1/reportes/inventario/exportar?formato=pdf&categoriaId=${p.categoriaId}`).set(auth()).expect(500);
    assert.equal(response.body.error.code, 'INTERNAL_ERROR'); assert.match(response.headers['content-type']!, /application\/json/);
    const audit = await connection.pool.request().input('rid', connection.driver.UniqueIdentifier, response.headers['x-request-id'])
      .query<{ accion: string }>('SELECT accion FROM jm.auditoria WHERE request_id=@rid;');
    assert.equal(audit.recordset[0]!.accion, 'HTTP_ERROR');
  } finally { await connection.pool.request().batch('DROP TRIGGER jm.tr_report_audit_fail;'); }
});

const database = `jm_test_${randomUUID().replaceAll('-', '')}`;
let admin: SqlConnection | undefined;
let connection: SqlConnection;
let created = false;
let catalog: CatalogoFacade;
let inventory: InventarioFacade;
let app: ReturnType<typeof createApp>;
let adminToken: string;
let mechanicToken: string;
let administrator: number;
let mechanic: number;
const settings = (databaseName: string) => parseSqlSettings({
  SQL_DRIVER: 'windows', SQL_SERVER: 'localhost', SQL_DATABASE: databaseName, SQL_TRUST_CERTIFICATE: 'true',
});
before(async () => {
  assert.match(database, /^jm_test_[a-f0-9]{32}$/);
  admin = await connectSql(settings('master'));
  await admin.pool.request().query(`CREATE DATABASE [${database}];`); created = true;
  await admin.pool.request().query(`ALTER DATABASE [${database}] SET READ_COMMITTED_SNAPSHOT ON;`);
  connection = await connectSql(settings(database)); await migrateInventory(connection);
  catalog = new CatalogoFacade(new SqlCatalogUnitOfWork(connection), inventoryEvents());
  inventory = new InventarioFacade(new SqlInventoryUnitOfWork(connection), inventoryEvents());
  for (const role of ['ADMINISTRADOR', 'MECANICO']) {
    const oid = randomUUID();
    const result = await connection.pool.request().input('oid', connection.driver.UniqueIdentifier, oid)
      .input('tenant', connection.driver.UniqueIdentifier, tenantId).input('role', connection.driver.VarChar(20), role)
      .query<{ id: number }>(`INSERT INTO jm.usuario(entra_tenant_id,entra_object_id,nombres,rol)
        VALUES (@tenant,@oid,N'Empleado ficticio catálogo',@role); SELECT CONVERT(int,SCOPE_IDENTITY()) AS id;`);
    const token = await signTestToken({ oid, roles: [role === 'ADMINISTRADOR' ? 'Administrador' : 'Mecanico'] });
    if (role === 'ADMINISTRADOR') { administrator = result.recordset[0]!.id; adminToken = token; }
    else { mechanicToken = token; mechanic = result.recordset[0]!.id; }
  }
  const services = runtimeServices({ ...settings(database), ENTRA_TENANT_ID: tenantId,
    ENTRA_API_CLIENT_ID: apiId, ENTRA_ALLOWED_CLIENT_IDS: clientId });
  services.verifyToken = testVerifier;
  app = createApp(parseEnvironment({ NODE_ENV: 'test' }), { info() {}, error() {} }, services);
});
beforeEach(async () => {
  // Aislar la cola entre escenarios solo en esta base aleatoria, nunca en .env.
  await connection.pool.request().query(`UPDATE jm.notificacion_outbox SET estado='CANCELADA',
    lease_token=NULL,lease_hasta=NULL WHERE estado<>'ENVIADA';`);
});
after(async () => {
  await SqlPoolSingleton.getInstance().close(); await connection?.pool.close();
  if (created && admin && /^jm_test_[a-f0-9]{32}$/.test(database)) {
    await admin.pool.request().query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}];`);
    console.info('Catálogo: base efímera eliminada; no se modificó el catálogo del usuario.');
  }
  await admin?.pool.close();
});
const auth = () => ({ Authorization: `Bearer ${adminToken}` });
test('Lecturas HTTP+SQL: stock accesible al Mecánico sin precio ni versión y búsqueda literal parametrizada', async () => {
  const p = await product('123456.78');
  const base = `/api/v1/inventario/stock?categoriaId=${p.categoriaId}`;
  await request(app).get(base).expect(401);
  const response = await request(app).get(base).auth(mechanicToken, { type: 'bearer' }).expect(200);
  assert.equal(response.body.data.length, 1);
  assert.deepEqual(Object.keys(response.body.data[0]).sort(), ['id', 'sku', 'nombre', 'categoriaId', 'categoria', 'stockActual', 'stockMinimo'].sort());
  assert.equal(response.headers['cache-control'], 'no-store');
  const literal = await request(app).get(base + '&buscar=' + encodeURIComponent("%' OR 1=1 --")).set(auth()).expect(200);
  assert.equal(literal.body.data.length, 0);
  for (const query of ['usuarioId=1', 'precioCompra=true', 'limite=101', 'categoriaId=0']) await request(app).get('/api/v1/inventario/stock?' + query).set(auth()).expect(400);
  const categoryResult = await request(app).get('/api/v1/inventario/categorias').auth(mechanicToken, { type: 'bearer' }).expect(200);
  assert.ok(categoryResult.body.data.length > 0); assert.deepEqual(Object.keys(categoryResult.body.data[0]).sort(), ['id', 'nombre']);
});
test('Lecturas SQL: historial propio impuesto en servidor y sin claves internas, consulta auditada', async () => {
  const p = await product(); await replenish(p.id);
  await inventory.registrarSalida({ productoId: p.id, cantidad: 1, motivo: 'Consumo prueba interfaz', claveIdempotencia: randomUUID() }, mechanic);
  const path = `/api/v1/inventario/movimientos?productoId=${p.id}`;
  const own = await request(app).get(path).auth(mechanicToken, { type: 'bearer' }).expect(200);
  assert.equal(own.body.data.length, 1); assert.equal(own.body.data[0].usuarioId, mechanic);
  assert.equal('claveIdempotencia' in own.body.data[0], false); assert.equal('requestHash' in own.body.data[0], false);
  const all = await request(app).get(path).set(auth()).expect(200); assert.equal(all.body.data.length, 2);
  await request(app).get(path + `&usuarioId=${administrator}`).auth(mechanicToken, { type: 'bearer' }).expect(400);
  const audit = await connection.pool.request().input('rid', connection.driver.UniqueIdentifier, own.headers['x-request-id'])
    .query<{ accion: string }>('SELECT accion FROM jm.auditoria WHERE request_id=@rid;');
  assert.equal(audit.recordset[0]!.accion, 'MOVIMIENTOS_CONSULTADOS');
});
async function category() {
  return catalog.crearCategoria({ nombre: `Demo-${randomUUID()}` }, administrator, randomUUID());
}
async function product(price = '25.00') {
  const cat = await category();
  return catalog.crearProducto({ sku: randomUUID(), nombre: 'Filtro ficticio', categoriaId: cat.id,
    stockMinimo: 2, precioCompra: price }, administrator, randomUUID());
}
async function replenish(id: number) {
  await inventory.registrarEntrada({ productoId: id, cantidad: 5, motivo: 'Reposición prueba catálogo', claveIdempotencia: randomUUID() }, administrator);
}
async function alerts(id: number) {
  return (await connection.pool.request().input('id', connection.driver.Int, id)
    .query<{ estado: string; envio: string; version: number; movimiento: number | null }>(`SELECT a.estado,o.estado AS envio,
      o.version_payload AS version,a.movimiento_origen_id AS movimiento FROM jm.alerta a
      JOIN jm.notificacion_outbox o ON o.alerta_id=a.id WHERE a.producto_id=@id ORDER BY a.id;`)).recordset;
}

test('Catálogo HTTP: sin sesión 401; Mecánico 403 en lecturas y escrituras antes de gestionar catálogo', async () => {
  await request(app).get('/api/v1/catalogo/productos').expect(401);
  for (const path of ['categorias', 'productos']) {
    await request(app).get(`/api/v1/catalogo/${path}`).auth(mechanicToken, { type: 'bearer' }).expect(403);
    const denied = await request(app).post(`/api/v1/catalogo/${path}`).auth(mechanicToken, { type: 'bearer' }).send({}).expect(403);
    const audit = await connection.pool.request().input('rid', connection.driver.UniqueIdentifier, denied.headers['x-request-id'])
      .query<{ accion: string; codigo: string }>('SELECT accion,codigo FROM jm.auditoria WHERE request_id=@rid;');
    assert.deepEqual(audit.recordset[0], { accion: 'HTTP_RECHAZADA', codigo: 'ROLE_FORBIDDEN' });
    await request(app).put(`/api/v1/catalogo/${path}/1`).auth(mechanicToken, { type: 'bearer' }).send({}).expect(403);
  }
});

test('Catálogo HTTP: alta y edición de categoría con ETag; versión anterior no sobrescribe', async () => {
  const name = `Categoría-${randomUUID()}`;
  const created = await request(app).post('/api/v1/catalogo/categorias').set(auth()).send({ nombre: name }).expect(201);
  assert.match(created.body.data.version, /^[0-9A-F]{16}$/);
  assert.equal(created.headers.etag, `"${created.body.data.version}"`);
  const path = `/api/v1/catalogo/categorias/${created.body.data.id}`;
  await request(app).put(path).set(auth()).send({ nombre: 'Sin versión' }).expect(428);
  await request(app).put(path).set(auth()).set('If-Match', '*').send({ nombre: 'Comodín' }).expect(400);
  await request(app).put(path).set(auth()).set('If-Match', '"00000000000000ab"').send({ nombre: 'Otra etiqueta' }).expect(412);
  const updated = await request(app).put(path).set(auth()).set('If-Match', created.headers.etag).send({ nombre: name + '-editada' }).expect(200);
  assert.notEqual(updated.headers.etag, created.headers.etag);
  await request(app).put(path).set(auth()).set('If-Match', created.headers.etag).send({ nombre: name + '-obsoleta' }).expect(412);
  const audit = await connection.pool.request().input('request', connection.driver.UniqueIdentifier, updated.headers['x-request-id'])
    .query<{ antes: string; despues: string }>('SELECT valores_anteriores AS antes,valores_nuevos AS despues FROM jm.auditoria WHERE request_id=@request;');
  assert.equal(JSON.parse(audit.recordset[0]!.antes).nombre, name);
  assert.equal(JSON.parse(audit.recordset[0]!.despues).nombre, name + '-editada');
});

test('Catálogo SQL: categoría duplicada devuelve conflicto y nombre parametrizado no ejecuta SQL', async () => {
  const cat = await category();
  await assert.rejects(catalog.crearCategoria({ nombre: cat.nombre }, administrator, randomUUID()), { code: 'CATALOG_DUPLICATE' });
  const name = `X'; DROP TABLE jm.producto; --${randomUUID()}`;
  const created = await catalog.crearCategoria({ nombre: name }, administrator, randomUUID());
  assert.equal(created.nombre, name);
});

test('Catálogo HTTP+SQL: producto nace en cero, dinero exacto y alerta V2 sin movimiento ficticio', async () => {
  const cat = await category();
  const response = await request(app).post('/api/v1/catalogo/productos').set(auth()).send({
    sku: `fil-${randomUUID()}`, nombre: 'Ñ'.repeat(150), categoriaId: cat.id,
    stockMinimo: 2, precioCompra: '9999999999999999.99',
  }).expect(201);
  const p = response.body.data;
  assert.match(p.version, /^[0-9A-F]{32}$/);
  assert.equal(p.stockActual, 0); assert.equal(p.precioCompra, '9999999999999999.99');
  assert.equal(p.sku, p.sku.toUpperCase()); assert.equal(p.nombre.length, 150);
  const movements = await connection.pool.request().input('id', connection.driver.Int, p.id)
    .query<{ cantidad: number }>('SELECT COUNT(*) AS cantidad FROM jm.movimiento WHERE producto_id=@id;');
  assert.equal(movements.recordset[0]!.cantidad, 0);
  assert.deepEqual(await alerts(p.id), [{ estado: 'PENDIENTE', envio: 'PENDIENTE', version: 2, movimiento: null }]);
  const get = await request(app).get(`/api/v1/catalogo/productos/${p.id}`).set(auth()).expect(200);
  assert.equal(get.headers.etag, response.headers.etag); assert.equal(get.headers['cache-control'], 'no-store');
});

test('Catálogo SQL: dos altas concurrentes de un SKU dejan un solo producto/stock/alerta', async () => {
  const cat = await category();
  const input = { sku: randomUUID(), nombre: 'Ficticio concurrente', categoriaId: cat.id, stockMinimo: 1, precioCompra: '1.00' };
  const results = await Promise.allSettled([catalog.crearProducto(input, administrator, randomUUID()), catalog.crearProducto(input, administrator, randomUUID())]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const failed = results.find((result) => result.status === 'rejected');
  assert.equal(failed?.status === 'rejected' && failed.reason.code, 'CATALOG_DUPLICATE');
  const rows = await connection.pool.request().input('sku', connection.driver.VarChar(40), input.sku.toUpperCase())
    .query<{ cantidad: number }>('SELECT COUNT(*) AS cantidad FROM jm.producto WHERE sku=@sku;');
  assert.equal(rows.recordset[0]!.cantidad, 1);
});

test('Catálogo HTTP: no se acepta modificar stock, identidad, SKU o dinero numérico', async () => {
  const p = await product();
  const body = { nombre: p.nombre, categoriaId: p.categoriaId, stockMinimo: p.stockMinimo, precioCompra: p.precioCompra };
  for (const extra of [{ stockActual: 20 }, { usuarioId: 2 }, { activo: false }, { sku: 'OTRO' }, { precioCompra: 25 }]) {
    await request(app).put(`/api/v1/catalogo/productos/${p.id}`).set(auth()).set('If-Match', `"${p.version}"`)
      .send({ ...body, ...extra }).expect(400);
  }
  assert.equal((await catalog.obtenerProducto(p.id, administrator, randomUUID())).stockActual, 0);
});

test('Catálogo SQL: cambios del mínimo abren/atienden alertas sin alterar stock ni movimientos', async () => {
  const p = await product(); await replenish(p.id); // Stock 5, primera alerta atendida.
  const stocked = await catalog.obtenerProducto(p.id, administrator, randomUUID());
  assert.notEqual(stocked.version, p.version, 'El ETag del producto también debe cambiar con el stock que muestra.');
  const body = { nombre: p.nombre, categoriaId: p.categoriaId, stockMinimo: 10, precioCompra: p.precioCompra };
  const raised = await catalog.actualizarProducto(p.id, body, stocked.version, administrator, randomUUID());
  assert.equal(raised.stockActual, 5); assert.notEqual(raised.version, p.version);
  let rows = await alerts(p.id);
  assert.equal(rows.length, 2); assert.equal(rows[1]!.estado, 'PENDIENTE'); assert.equal(rows[1]!.movimiento, null);
  await catalog.actualizarProducto(p.id, { ...body, stockMinimo: 0 }, raised.version, administrator, randomUUID());
  rows = await alerts(p.id); assert.equal(rows[1]!.estado, 'ATENDIDA'); assert.equal(rows[1]!.envio, 'CANCELADA');
  const count = await connection.pool.request().input('id', connection.driver.Int, p.id)
    .query<{ cantidad: number }>('SELECT COUNT(*) AS cantidad FROM jm.movimiento WHERE producto_id=@id;');
  assert.equal(count.recordset[0]!.cantidad, 1);
});

test('Catálogo SQL: dos ediciones con la misma versión aceptan solo una', async () => {
  const p = await product();
  const body = { nombre: 'Nombre A', categoriaId: p.categoriaId, stockMinimo: 2, precioCompra: '2.00' };
  const result = await Promise.allSettled([
    catalog.actualizarProducto(p.id, body, p.version, administrator, randomUUID()),
    catalog.actualizarProducto(p.id, { ...body, nombre: 'Nombre B' }, p.version, administrator, randomUUID()),
  ]);
  assert.equal(result.filter((row) => row.status === 'fulfilled').length, 1);
  const rejected = result.find((row) => row.status === 'rejected');
  assert.equal(rejected?.status === 'rejected' && rejected.reason.code, 'STALE_VERSION');
});

test('Catálogo SQL: inexistentes e inactivos se rechazan sin alta parcial', async () => {
  await assert.rejects(catalog.crearProducto({ sku: randomUUID(), nombre: 'Ficticio', categoriaId: 2_000_000_000,
    stockMinimo: 0, precioCompra: '0.00' }, administrator, randomUUID()), { code: 'CATEGORY_NOT_FOUND' });
  const p = await product();
  await connection.pool.request().input('id', connection.driver.Int, p.id).query('UPDATE jm.producto SET activo=0 WHERE id=@id;');
  await assert.rejects(catalog.actualizarProducto(p.id, { nombre: 'No permitido', categoriaId: p.categoriaId, stockMinimo: 0,
    precioCompra: '0.00' }, p.version, administrator, randomUUID()), { code: 'CATALOG_PRODUCT_INACTIVE' });
  await request(app).get('/api/v1/catalogo/productos/2000000000').set(auth()).expect(404);
  await request(app).get('/api/v1/catalogo/productos/1x').set(auth()).expect(400);
});

test('Catálogo SQL: fallo de Outbox revierte producto, stock, alerta y auditoría', async () => {
  const cat = await category(); const sku = `F-${randomUUID()}`.toUpperCase(); const rid = randomUUID();
  await connection.pool.request().batch(`CREATE TRIGGER jm.tr_catalog_outbox_fallo ON jm.notificacion_outbox AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE JSON_VALUE(payload,'$.sku')='${sku}')
      THROW 51988,'Fallo simulado catálogo Outbox.',1; END;`);
  await assert.rejects(catalog.crearProducto({ sku, nombre: 'Ficticio', categoriaId: cat.id, stockMinimo: 2, precioCompra: '1.00' }, administrator, rid));
  const result = await connection.pool.request().input('sku', connection.driver.VarChar(40), sku)
    .input('request', connection.driver.UniqueIdentifier, rid)
    .query<{ productos: number; auditorias: number }>(`SELECT (SELECT COUNT(*) FROM jm.producto WHERE sku=@sku) AS productos,
      (SELECT COUNT(*) FROM jm.auditoria WHERE request_id=@request) AS auditorias;`);
  assert.deepEqual(result.recordset[0], { productos: 0, auditorias: 0 });
});

test('Catálogo SQL: fallo de auditoría revierte metadatos, versión y alertas', async () => {
  const p = await product(); await replenish(p.id); const rid = randomUUID();
  const stocked = await catalog.obtenerProducto(p.id, administrator, randomUUID());
  await connection.pool.request().batch(`CREATE TRIGGER jm.tr_catalog_auditoria_fallo ON jm.auditoria AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE accion='PRODUCTO_ACTUALIZADO' AND entidad_id='${p.id}')
      THROW 51987,'Fallo simulado catálogo auditoría.',1; END;`);
  await assert.rejects(catalog.actualizarProducto(p.id, { nombre: 'Cambio revertido', categoriaId: p.categoriaId,
    stockMinimo: 10, precioCompra: '99.99' }, stocked.version, administrator, rid), { code: 'EREQUEST' });
  const after = await catalog.obtenerProducto(p.id, administrator, randomUUID());
  assert.equal(after.nombre, p.nombre); assert.equal(after.version, stocked.version);
  assert.equal(after.stockMinimo, 2); assert.equal((await alerts(p.id)).length, 1);
});

test('Catálogo HTTP: paginación por ID acotada, sin duplicar ni aceptar filtros desconocidos', async () => {
  const first = await category(); const second = await category(); const third = await category();
  const page = await request(app).get(`/api/v1/catalogo/categorias?despuesDe=${first.id}&limite=1`).set(auth()).expect(200);
  assert.equal(page.body.data[0].id, second.id); assert.equal(page.body.siguiente, second.id);
  const next = await request(app).get(`/api/v1/catalogo/categorias?despuesDe=${second.id}&limite=1`).set(auth()).expect(200);
  assert.equal(next.body.data[0].id, third.id); assert.equal(next.body.siguiente, null);
  await request(app).get('/api/v1/catalogo/productos?limite=101').set(auth()).expect(400);
  await request(app).get('/api/v1/catalogo/productos?foo=1').set(auth()).expect(400);
});

test('Catálogo+worker SQL: payload V2 se procesa con transporte ficticio sin inventar movimiento', async () => {
  const p = await product(); let calls = 0;
  const worker = new NotificationWorker(new SqlNotificationDispatch(connection), { enviar: async (message) => {
    assert.equal(message.movimientoId, null); assert.ok('origen' in message && message.origen === 'CATALOGO');
    calls++; return { providerId: 'FICTICIO-CATALOGO' };
  } });
  assert.equal(await worker.procesarUna(), 'ACEPTADA'); assert.equal(calls, 1);
  assert.equal((await alerts(p.id))[0]!.estado, 'ENVIADA');
});

test('Catálogo HTTP: cambiar stock invalida también el ETag de la representación del producto', async () => {
  const p = await product(); await replenish(p.id);
  const path = `/api/v1/catalogo/productos/${p.id}`;
  const current = await request(app).get(path).set(auth()).expect(200);
  assert.notEqual(current.headers.etag, `"${p.version}"`);
  await request(app).put(path).set(auth()).set('If-Match', `"${p.version}"`).send({
    nombre: 'Edición con lectura anterior', categoriaId: p.categoriaId, stockMinimo: 2, precioCompra: p.precioCompra,
  }).expect(412);
});

test('Catálogo SQL: fallo de Outbox al subir mínimo revierte metadatos y el nuevo ciclo de alerta', async () => {
  const p = await product(); await replenish(p.id);
  const previous = await catalog.obtenerProducto(p.id, administrator, randomUUID());
  await connection.pool.request().batch(`CREATE TRIGGER jm.tr_catalog_umbral_outbox_fallo ON jm.notificacion_outbox AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE JSON_VALUE(payload,'$.sku')='${p.sku}')
      THROW 51986,'Fallo simulado mínimo Outbox.',1; END;`);
  await assert.rejects(catalog.actualizarProducto(p.id, { nombre: 'No confirmado', categoriaId: p.categoriaId,
    stockMinimo: 10, precioCompra: '9.00' }, previous.version, administrator, randomUUID()), { code: 'EREQUEST' });
  const current = await catalog.obtenerProducto(p.id, administrator, randomUUID());
  assert.equal(current.version, previous.version); assert.equal(current.stockMinimo, previous.stockMinimo);
  assert.equal(current.stockActual, 5); assert.equal((await alerts(p.id)).length, 1);
});
