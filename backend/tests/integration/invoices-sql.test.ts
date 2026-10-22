import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import request from 'supertest';
import { connectSql, SqlPoolSingleton, type SqlConnection } from '../../src/infrastructure/database/sql-pool.js';
import { parseSqlSettings } from '../../src/infrastructure/database/sql-settings.js';
import { migrateInventory } from '../../src/infrastructure/database/migrate.js';
import { SqlInvoiceUnitOfWork } from '../../src/infrastructure/database/sql-invoices.js';
import { SqlSupplierUnitOfWork } from '../../src/infrastructure/database/sql-suppliers.js';
import { SqlCatalogUnitOfWork } from '../../src/infrastructure/database/sql-catalog.js';
import { SqlInventoryUnitOfWork } from '../../src/infrastructure/database/sql-inventory.js';
import { FacturasFacade } from '../../src/modules/compras/application/facturas.facade.js';
import { ProveedoresFacade } from '../../src/modules/compras/application/proveedores.facade.js';
import { CatalogoFacade } from '../../src/modules/catalogo/application/catalogo.facade.js';
import { InventarioFacade } from '../../src/modules/inventario/application/inventario.facade.js';
import { inventoryEvents } from '../../src/infrastructure/inventory-events.js';
import { createApp } from '../../src/app.js';
import { runtimeServices } from '../../src/infrastructure/runtime-services.js';
import { parseEnvironment } from '../../src/config/env.js';
import { tenantId, apiId, clientId, testVerifier, signTestToken } from '../helpers/entra-fixture.js';

const database = `jm_test_${randomUUID().replaceAll('-', '')}`;
let master: SqlConnection | undefined;
let connection: SqlConnection;
let created = false;
let facade: FacturasFacade;
let suppliers: ProveedoresFacade;
let catalog: CatalogoFacade;
let inventory: InventarioFacade;
let app: ReturnType<typeof createApp>;
let adminId: number;
let otherAdmin: number;
let mechanicId: number;
let inactiveId: number;
let adminToken: string;
let mechanicToken: string;
let inactiveToken: string;
const settings = (databaseName: string) => parseSqlSettings({
  SQL_DRIVER: 'windows', SQL_SERVER: 'localhost', SQL_DATABASE: databaseName, SQL_TRUST_CERTIFICATE: 'true',
});
before(async () => {
  assert.match(database, /^jm_test_[a-f0-9]{32}$/);
  master = await connectSql(settings('master'));
  await master.pool.request().query(`CREATE DATABASE [${database}];`); created = true;
  await master.pool.request().query(`ALTER DATABASE [${database}] SET READ_COMMITTED_SNAPSHOT ON;`);
  connection = await connectSql(settings(database)); await migrateInventory(connection); await migrateInventory(connection);
  facade = new FacturasFacade(new SqlInvoiceUnitOfWork(connection), inventoryEvents());
  suppliers = new ProveedoresFacade(new SqlSupplierUnitOfWork(connection));
  catalog = new CatalogoFacade(new SqlCatalogUnitOfWork(connection), inventoryEvents());
  inventory = new InventarioFacade(new SqlInventoryUnitOfWork(connection), inventoryEvents());
  for (const kind of ['admin', 'otherAdmin', 'mechanic', 'inactive']) {
    const oid = randomUUID(); const role = kind === 'mechanic' ? 'MECANICO' : 'ADMINISTRADOR';
    const result = await connection.pool.request().input('oid', connection.driver.UniqueIdentifier, oid)
      .input('tenant', connection.driver.UniqueIdentifier, tenantId).input('role', connection.driver.VarChar(20), role)
      .input('active', connection.driver.Bit, kind !== 'inactive')
      .query<{ id: number }>(`INSERT INTO jm.usuario(entra_tenant_id,entra_object_id,nombres,rol,activo)
        VALUES (@tenant,@oid,N'Empleado ficticio compras',@role,@active); SELECT CONVERT(int,SCOPE_IDENTITY()) AS id;`);
    const token = await signTestToken({ oid, roles: [role === 'ADMINISTRADOR' ? 'Administrador' : 'Mecanico'] });
    const id = result.recordset[0]!.id;
    if (kind === 'admin') { adminId = id; adminToken = token; }
    else if (kind === 'otherAdmin') otherAdmin = id;
    else if (kind === 'mechanic') { mechanicId = id; mechanicToken = token; }
    else { inactiveId = id; inactiveToken = token; }
  }
  const services = runtimeServices({ ...settings(database), ENTRA_TENANT_ID: tenantId, ENTRA_API_CLIENT_ID: apiId, ENTRA_ALLOWED_CLIENT_IDS: clientId });
  services.verifyToken = testVerifier;
  app = createApp(parseEnvironment({ NODE_ENV: 'test' }), { info() {}, error() {} }, services);
});
after(async () => {
  await SqlPoolSingleton.getInstance().close(); await connection?.pool.close();
  if (created && master && /^jm_test_[a-f0-9]{32}$/.test(database)) {
    await master.pool.request().query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}];`);
    console.info('Compras: base efímera eliminada; no se alteró inventario del usuario ni se enviaron correos.');
  }
  await master?.pool.close();
});
const base = '/api/v1/compras/facturas';
const auth = () => ({ Authorization: `Bearer ${adminToken}` });
async function fixture() {
  const supplier = await suppliers.crear({ codigo: randomUUID(), razonSocial: 'Proveedor Ñ de prueba', correo: null }, adminId, randomUUID());
  const category = await catalog.crearCategoria({ nombre: randomUUID() }, adminId, randomUUID());
  const p1 = await catalog.crearProducto({ sku: randomUUID(), nombre: 'Primer repuesto', categoriaId: category.id, stockMinimo: 2, precioCompra: '7.00' }, adminId, randomUUID());
  const p2 = await catalog.crearProducto({ sku: randomUUID(), nombre: 'Segundo repuesto', categoriaId: category.id, stockMinimo: 2, precioCompra: '8.00' }, adminId, randomUUID());
  const input = { proveedorId: supplier.id, numero: `F-${randomUUID()}`, fecha: '2026-10-21', moneda: 'PEN',
    lineas: [{ productoId: p2.id, cantidad: 4, precioUnitario: '0.20' }, { productoId: p1.id, cantidad: 3, precioUnitario: '0.10' }] };
  return { supplier, p1, p2, input };
}
async function draft() { const f = await fixture(); return { ...f, invoice: await facade.crear(f.input, adminId, randomUUID()) }; }
async function state(productId: number) {
  return (await connection.pool.request().input('id', connection.driver.Int, productId)
    .query<{ stock: number; movimientos: number; alerta: string; tarea: string }>(`SELECT s.cantidad_actual AS stock,
      (SELECT COUNT(*) FROM jm.movimiento WHERE producto_id=@id) AS movimientos,a.estado AS alerta,o.estado AS tarea
      FROM jm.stock s JOIN jm.alerta a ON a.producto_id=s.producto_id JOIN jm.notificacion_outbox o ON o.alerta_id=a.id
      WHERE s.producto_id=@id ORDER BY a.id;`)).recordset[0]!;
}
async function read(id: number) { return facade.obtener(id, adminId, randomUUID()); }
async function confirm(invoice: { id: number; version: string }, key: string = randomUUID(), userId = adminId) {
  return facade.confirmar(invoice.id, {}, invoice.version, key, userId, randomUUID());
}
test('Facturas HTTP: 401 sin token y 403 Mecánico/inactivo en todas las operaciones', async () => {
  const denied = await request(app).get(base).expect(401);
  const audit = await connection.pool.request().input('rid', connection.driver.UniqueIdentifier, denied.headers['x-request-id'])
    .query(`SELECT usuario_id FROM jm.auditoria WHERE request_id=@rid;`);
  assert.equal(audit.recordset[0].usuario_id, null);
  for (const [method, path] of [['get', ''], ['post', ''], ['put', '/1'], ['post', '/1/confirmar'], ['post', '/1/anular']] as const) {
    await request(app)[method](base + path).auth(mechanicToken, { type: 'bearer' }).send({}).expect(403);
  }
  await request(app).get(base).auth(inactiveToken, { type: 'bearer' }).expect(403);
  const f = await fixture();
  for (const actor of [mechanicId, inactiveId, 2_000_000_000]) {
    await assert.rejects(facade.crear(f.input, actor, randomUUID()), { code: 'INVOICE_FORBIDDEN' });
  }
});
test('Facturas HTTP+SQL: borrador PEN exacto sin stock, movimientos ni claves internas expuestas', async () => {
  const f = await fixture();
  const response = await request(app).post(base).set(auth()).send(f.input).expect(201);
  const row = response.body.data;
  assert.equal(row.total, '1.10'); assert.equal(row.estado, 'BORRADOR'); assert.equal(row.moneda, 'PEN');
  assert.match(row.version, /^[0-9A-F]{16}$/); assert.equal(response.headers.etag, `"${row.version}"`);
  assert.equal('claveRecepcion' in row, false); assert.equal('claveMovimiento' in row.lineas[0], false);
  assert.equal(row.lineas[0].productoId, f.p1.id); assert.equal(row.lineas[0].movimientoId, null);
  assert.deepEqual(await state(f.p1.id), { stock: 0, movimientos: 0, alerta: 'PENDIENTE', tarea: 'PENDIENTE' });
  const detail = await request(app).get(`${base}/${row.id}`).set(auth()).expect(200);
  assert.equal(detail.headers['cache-control'], 'no-store'); assert.deepEqual(detail.body.data, row);
});
test('Facturas SQL: proveedor y número únicos; mismo número permitido para otro proveedor', async () => {
  const f = await fixture();
  const result = await Promise.allSettled([facade.crear(f.input, adminId, randomUUID()), facade.crear(f.input, adminId, randomUUID())]);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
  const failed = result.find((r) => r.status === 'rejected');
  assert.equal(failed?.status === 'rejected' && failed.reason.code, 'INVOICE_DUPLICATE');
  await request(app).post(base).set(auth()).send(f.input).expect(409);
  const other = await suppliers.crear({ codigo: randomUUID(), razonSocial: 'Otro', correo: null }, adminId, randomUUID());
  const row = await facade.crear({ ...f.input, proveedorId: other.id }, adminId, randomUUID()); assert.equal(row.numero, f.input.numero.toUpperCase());
});
test('Facturas HTTP: edición solo del borrador y auditoría de líneas sin cambiar stock', async () => {
  const f = await draft();
  const body = { fecha: '2026-10-20', lineas: [{ productoId: f.p1.id, cantidad: 2, precioUnitario: '1.25' }] };
  const path = `${base}/${f.invoice.id}`;
  await request(app).put(path).set(auth()).send(body).expect(428);
  const response = await request(app).put(path).set(auth()).set('If-Match', `"${f.invoice.version}"`).send(body).expect(200);
  assert.equal(response.body.data.total, '2.50'); assert.equal(response.body.data.lineas.length, 1);
  await request(app).put(path).set(auth()).set('If-Match', `"${f.invoice.version}"`).send(body).expect(412);
  const rows = await connection.pool.request().input('rid', connection.driver.UniqueIdentifier, response.headers['x-request-id'])
    .query(`SELECT accion,valores_anteriores,valores_nuevos FROM jm.auditoria WHERE request_id=@rid ORDER BY id;`);
  assert.equal(rows.recordset.filter((r) => r.accion === 'FACTURA_DETALLE_CAMBIADO').length, 2);
  assert.equal((await state(f.p1.id)).stock, 0);
});
test('Facturas HTTP+SQL: recepción completa y replay devuelven mismos movimientos sin duplicar stock', async () => {
  const f = await draft(); const key = randomUUID(); const rid = randomUUID();
  const path = `${base}/${f.invoice.id}/confirmar`;
  const response = await request(app).post(path).set(auth()).set('X-Request-Id', rid)
    .set('If-Match', `"${f.invoice.version}"`).set('Idempotency-Key', key).send({}).expect(201);
  assert.equal(response.body.repetido, false); assert.equal(response.body.data.estado, 'RECIBIDA');
  assert.equal(response.body.data.usuarioRecepcionId, adminId); assert.ok(response.body.data.recibidaEn);
  assert.deepEqual(await state(f.p1.id), { stock: 3, movimientos: 1, alerta: 'ATENDIDA', tarea: 'CANCELADA' });
  assert.deepEqual(await state(f.p2.id), { stock: 4, movimientos: 1, alerta: 'ATENDIDA', tarea: 'CANCELADA' });
  const replay = await request(app).post(path).set(auth()).set('If-Match', `"${f.invoice.version}"`).set('Idempotency-Key', key).send({}).expect(200);
  assert.equal(replay.body.repetido, true); assert.deepEqual(replay.body.data, response.body.data);
  assert.equal((await state(f.p1.id)).movimientos, 1);
  const audit = await connection.pool.request().input('rid', connection.driver.UniqueIdentifier, response.headers['x-request-id'])
    .query(`SELECT accion,usuario_id FROM jm.auditoria WHERE request_id=@rid;`);
  for (const action of ['INVENTARIO_ENTRADA', 'ALERTA_ATENDIDA', 'FACTURA_RECIBIDA']) assert.ok(audit.recordset.some((r) => r.accion === action && r.usuario_id === adminId));
  const product = await catalog.obtenerProducto(f.p1.id, adminId, randomUUID()); assert.equal(product.precioCompra, '7.00');
});
test('Facturas SQL: confirmaciones simultáneas con misma clave confirman una y repiten otra', async () => {
  const f = await draft(); const key = randomUUID();
  const results = await Promise.all([confirm(f.invoice, key), confirm(f.invoice, key)]);
  assert.equal(results.filter((r) => r.repetido).length, 1); assert.equal((await state(f.p1.id)).stock, 3);
});
test('Facturas SQL: distinta clave/actor no recibe dos veces; clave usada no sirve en otra factura', async () => {
  const f = await draft(); const key = randomUUID();
  const result = await Promise.allSettled([confirm(f.invoice, key), confirm(f.invoice, randomUUID())]);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
  const row = await read(f.invoice.id); assert.equal(row.estado, 'RECIBIDA');
  await assert.rejects(confirm(f.invoice, key, otherAdmin), { code: 'INVOICE_ALREADY_RECEIVED' });
  // Usar la clave ganadora exacta, consultada solo desde esta base de pruebas.
  const internal = await connection.pool.request().input('id', connection.driver.Int, f.invoice.id)
    .query<{ clave: string }>('SELECT CONVERT(varchar(36),clave_recepcion) AS clave FROM jm.factura_compra WHERE id=@id;');
  const actualKey = internal.recordset[0]!.clave;
  const other = await facade.crear({ ...f.input, numero: `OTRA-${randomUUID().slice(0, 8)}` }, adminId, randomUUID());
  await assert.rejects(confirm(other, actualKey), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(confirm({ ...f.invoice, version: row.version }, actualKey), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal((await state(f.p1.id)).movimientos, 1);
});
test('Facturas SQL: dos documentos con productos en orden inverso encadenan entradas correctamente', async () => {
  const f = await draft();
  const supplier = await suppliers.crear({ codigo: randomUUID(), razonSocial: 'Segundo proveedor', correo: null }, adminId, randomUUID());
  const second = await facade.crear({ ...f.input, proveedorId: supplier.id, lineas: [...f.input.lineas].reverse() }, adminId, randomUUID());
  await Promise.all([confirm(f.invoice), confirm(second)]);
  assert.equal((await state(f.p1.id)).stock, 6); assert.equal((await state(f.p1.id)).movimientos, 2);
  assert.equal((await state(f.p2.id)).stock, 8);
});
test('Facturas SQL: producto inactivo en segunda línea revierte primera entrada, alerta y recepción', async () => {
  const f = await draft();
  await connection.pool.request().input('id', connection.driver.Int, f.p2.id).query('UPDATE jm.producto SET activo=0 WHERE id=@id;');
  await assert.rejects(confirm(f.invoice), { code: 'PRODUCT_NOT_ACTIVE' });
  assert.deepEqual(await state(f.p1.id), { stock: 0, movimientos: 0, alerta: 'PENDIENTE', tarea: 'PENDIENTE' });
  const row = await read(f.invoice.id); assert.equal(row.estado, 'BORRADOR'); assert.equal(row.version, f.invoice.version);
  assert.ok(row.lineas.every((line) => line.movimientoId === null));
});
test('Facturas SQL: desbordamiento de stock en segunda línea revierte todas las líneas', async () => {
  const f = await draft();
  await connection.pool.request().input('id', connection.driver.Int, f.p2.id).query('UPDATE jm.stock SET cantidad_actual=2147483647 WHERE producto_id=@id;');
  await assert.rejects(confirm(f.invoice), { code: 'STOCK_LIMIT_EXCEEDED' });
  assert.equal((await state(f.p1.id)).stock, 0); assert.equal((await state(f.p1.id)).movimientos, 0);
  assert.equal((await read(f.invoice.id)).estado, 'BORRADOR');
});
test('Facturas SQL: fallo de auditoría final revierte movimientos, enlaces, alertas y estado', async () => {
  const f = await draft(); const rid = randomUUID();
  await connection.pool.request().batch(`CREATE TRIGGER jm.tr_invoice_audit_fail ON jm.auditoria AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE request_id='${rid}' AND accion='FACTURA_RECIBIDA')
      THROW 51971,'Fallo simulado recepción.',1; END;`);
  await assert.rejects(facade.confirmar(f.invoice.id, {}, f.invoice.version, randomUUID(), adminId, rid));
  assert.deepEqual(await state(f.p1.id), { stock: 0, movimientos: 0, alerta: 'PENDIENTE', tarea: 'PENDIENTE' });
  assert.deepEqual(await read(f.invoice.id), f.invoice);
  const count = await connection.pool.request().input('rid', connection.driver.UniqueIdentifier, rid)
    .query<{ n: number }>('SELECT COUNT(*) AS n FROM jm.auditoria WHERE request_id=@rid;');
  assert.equal(count.recordset[0]!.n, 0);
});
test('Facturas SQL: fallo al cancelar Outbox impide confirmar la compra', async () => {
  const f = await draft();
  await connection.pool.request().batch(`CREATE TRIGGER jm.tr_invoice_outbox_fail ON jm.notificacion_outbox AFTER UPDATE AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted o JOIN jm.alerta a ON a.id=o.alerta_id
      WHERE a.producto_id=${f.p1.id} AND o.estado='CANCELADA') THROW 51972,'Fallo simulado Outbox compra.',1; END;`);
  await assert.rejects(confirm(f.invoice));
  assert.deepEqual(await state(f.p1.id), { stock: 0, movimientos: 0, alerta: 'PENDIENTE', tarea: 'PENDIENTE' });
  assert.equal((await read(f.invoice.id)).estado, 'BORRADOR');
});
test('Facturas HTTP: cuerpo/moneda/identidad inválidos, versión y clave obligatorias e inexistentes', async () => {
  const f = await draft();
  for (const extra of [{ moneda: 'USD' }, { total: '1.00' }, { estado: 'RECIBIDA' }, { usuarioId: adminId }, { fecha: '2026-02-30' }]) {
    await request(app).post(base).set(auth()).send({ ...f.input, ...extra }).expect(400);
  }
  const path = `${base}/${f.invoice.id}/confirmar`;
  await request(app).post(path).set(auth()).send({}).expect(428);
  await request(app).post(path).set(auth()).set('If-Match', `"${f.invoice.version}"`).send({}).expect(400);
  await request(app).post(path).set(auth()).set('If-Match', '*').send({}).expect(400);
  await request(app).post(path).set(auth()).set('If-Match', `"${f.invoice.version}"`).set('Idempotency-Key', randomUUID()).send({ cantidad: 100 }).expect(400);
  await request(app).get(`${base}/1x`).set(auth()).expect(400);
  await request(app).get(`${base}/2000000000`).set(auth()).expect(404);
  await request(app).post(`${base}/2000000000/confirmar`).set(auth()).set('If-Match', `"${f.invoice.version}"`).set('Idempotency-Key', randomUUID()).send({}).expect(404);
});
test('Facturas SQL: proveedor inexistente/inactivo impide crear o recibir sin afectar stock', async () => {
  const f = await draft();
  await assert.rejects(facade.crear({ ...f.input, proveedorId: 2_000_000_000 }, adminId, randomUUID()), { code: 'SUPPLIER_NOT_FOUND' });
  await suppliers.actualizar(f.supplier.id, { razonSocial: f.supplier.razonSocial, correo: null, activo: false }, f.supplier.version, adminId, randomUUID());
  await assert.rejects(confirm(f.invoice), { code: 'INVOICE_SUPPLIER_INACTIVE' });
  await assert.rejects(facade.crear({ ...f.input, numero: 'OTRO' }, adminId, randomUUID()), { code: 'INVOICE_SUPPLIER_INACTIVE' });
  assert.equal((await state(f.p1.id)).stock, 0);
});
test('Facturas SQL: anular solo borrador no altera stock ni permite reutilizar documento', async () => {
  const f = await draft();
  const response = await request(app).post(`${base}/${f.invoice.id}/anular`).set(auth()).set('If-Match', `"${f.invoice.version}"`).send({}).expect(200);
  assert.equal(response.body.data.estado, 'ANULADA'); assert.equal((await state(f.p1.id)).stock, 0);
  await assert.rejects(confirm({ ...f.invoice, version: response.body.data.version }), { code: 'INVOICE_NOT_DRAFT' });
  await assert.rejects(facade.crear(f.input, adminId, randomUUID()), { code: 'INVOICE_DUPLICATE' });
});
test('Facturas SQL: documento recibido y sus detalles son inmutables por API y DML ordinario', async () => {
  const f = await draft(); const received = (await confirm(f.invoice)).factura;
  await request(app).put(`${base}/${received.id}`).set(auth()).set('If-Match', `"${received.version}"`)
    .send({ fecha: f.input.fecha, lineas: f.input.lineas }).expect(409);
  await request(app).post(`${base}/${received.id}/anular`).set(auth()).set('If-Match', `"${received.version}"`).send({}).expect(409);
  for (const query of ['UPDATE jm.factura_compra SET total=0 WHERE id=@id;', 'DELETE FROM jm.factura_compra WHERE id=@id;',
    'UPDATE jm.factura_compra_linea SET nombre=N\'Alterado\' WHERE factura_id=@id;', 'DELETE FROM jm.factura_compra_linea WHERE factura_id=@id;']) {
    await assert.rejects(connection.pool.request().input('id', connection.driver.Int, received.id).query(query));
  }
  assert.deepEqual(await read(received.id), received);
});
test('Facturas SQL: fallo de auditoría al editar conserva versión y detalles anteriores', async () => {
  const f = await draft(); const rid = randomUUID();
  await connection.pool.request().batch(`CREATE TRIGGER jm.tr_invoice_edit_fail ON jm.auditoria AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE request_id='${rid}') THROW 51973,'Fallo simulado borrador.',1; END;`);
  await assert.rejects(facade.editar(f.invoice.id, { fecha: '2026-10-20', lineas: [f.input.lineas[0]] }, f.invoice.version, adminId, rid));
  assert.deepEqual(await read(f.invoice.id), f.invoice);
});
test('Facturas SQL: fallo de auditoría en alta no deja documento ni detalles huérfanos', async () => {
  const f = await fixture(); const rid = randomUUID();
  await connection.pool.request().batch(`CREATE TRIGGER jm.tr_invoice_create_fail ON jm.auditoria AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE request_id='${rid}') THROW 51974,'Fallo simulado alta.',1; END;`);
  await assert.rejects(facade.crear(f.input, adminId, rid));
  const rows = await connection.pool.request().input('supplier', connection.driver.Int, f.supplier.id)
    .query<{ n: number }>('SELECT COUNT(*) AS n FROM jm.factura_compra WHERE proveedor_id=@supplier;');
  assert.equal(rows.recordset[0]!.n, 0); assert.equal((await state(f.p1.id)).stock, 0);
});
test('Facturas HTTP: listado paginado administrativo no expone claves y acota filtros', async () => {
  const f = await draft();
  const second = await facade.crear({ ...f.input, numero: 'SEGUNDA' }, adminId, randomUUID());
  const third = await facade.crear({ ...f.input, numero: 'TERCERA' }, adminId, randomUUID());
  const page = await request(app).get(`${base}?despuesDe=${f.invoice.id}&limite=1`).set(auth()).expect(200);
  assert.equal(page.body.data[0].id, second.id); assert.equal(page.body.siguiente, second.id);
  assert.equal('claveRecepcion' in page.body.data[0], false);
  const next = await request(app).get(`${base}?despuesDe=${second.id}&limite=1`).set(auth()).expect(200);
  assert.equal(next.body.data[0].id, third.id); assert.equal(next.body.siguiente, null);
  for (const query of ['limite=101', 'foo=1', 'despuesDe=-1']) await request(app).get(`${base}?${query}`).set(auth()).expect(400);
});
test('Facturas SQL: importes grandes y snapshots sobreviven cambios de proveedor y catálogo', async () => {
  const f = await fixture();
  const row = await facade.crear({ ...f.input, lineas: [{ productoId: f.p1.id, cantidad: 1, precioUnitario: '9999999999999999.99' }] }, adminId, randomUUID());
  assert.equal(row.total, '9999999999999999.99');
  await suppliers.actualizar(f.supplier.id, { razonSocial: 'Razón social nueva', correo: null, activo: true }, f.supplier.version, adminId, randomUUID());
  await catalog.actualizarProducto(f.p1.id, { nombre: 'Nombre nuevo', categoriaId: f.p1.categoriaId, stockMinimo: 2, precioCompra: '9.00' }, f.p1.version, adminId, randomUUID());
  const received = (await confirm(row)).factura;
  assert.equal(received.proveedorNombre, 'Proveedor Ñ de prueba'); assert.equal(received.lineas[0]!.nombre, 'Primer repuesto');
  assert.equal(received.total, '9999999999999999.99');
});
test('Facturas SQL: edición y confirmación simultáneas con una versión no se pisan', async () => {
  const f = await draft();
  const results = await Promise.allSettled([
    facade.editar(f.invoice.id, { fecha: '2026-10-20', lineas: [f.input.lineas[0]] }, f.invoice.version, adminId, randomUUID()), confirm(f.invoice),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const row = await read(f.invoice.id);
  if (row.estado === 'RECIBIDA') assert.equal((await state(f.p1.id)).stock, 3);
  else { assert.equal(row.lineas.length, 1); assert.equal((await state(f.p1.id)).stock, 0); }
});
test('Facturas SQL: salida concurrente con recepción conserva saldos sin negativos', async () => {
  const f = await draft();
  const results = await Promise.allSettled([confirm(f.invoice), inventory.registrarSalida({ productoId: f.p1.id, cantidad: 1,
    motivo: 'Salida concurrente ficticia', claveIdempotencia: randomUUID() }, mechanicId, randomUUID())]);
  assert.equal(results[0]!.status, 'fulfilled');
  const row = await state(f.p1.id); assert.equal(row.stock, results[1]!.status === 'fulfilled' ? 2 : 3);
});
