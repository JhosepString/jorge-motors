import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { readdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { connectSql, SqlPoolSingleton, type SqlConnection } from '../../src/infrastructure/database/sql-pool.js';
import { parseSqlSettings } from '../../src/infrastructure/database/sql-settings.js';
import { migrateInventory } from '../../src/infrastructure/database/migrate.js';
import { SqlInvoiceUnitOfWork } from '../../src/infrastructure/database/sql-invoices.js';
import { SqlSupplierUnitOfWork } from '../../src/infrastructure/database/sql-suppliers.js';
import { SqlCatalogUnitOfWork } from '../../src/infrastructure/database/sql-catalog.js';
import { SqlAttachmentUnitOfWork } from '../../src/infrastructure/database/sql-attachments.js';
import { FacturasFacade } from '../../src/modules/compras/application/facturas.facade.js';
import { ProveedoresFacade } from '../../src/modules/compras/application/proveedores.facade.js';
import { CatalogoFacade } from '../../src/modules/catalogo/application/catalogo.facade.js';
import { AdjuntosFacade, AttachmentCleanup } from '../../src/modules/compras/application/adjuntos.facade.js';
import type { AttachmentStore } from '../../src/modules/compras/application/attachment-contracts.js';
import { inspectAttachment, MAX_ATTACHMENT_BYTES } from '../../src/modules/compras/domain/attachment.js';
import { LocalAttachmentStore } from '../../src/infrastructure/storage/local-attachment-store.js';
import { inventoryEvents } from '../../src/infrastructure/inventory-events.js';
import { createApp } from '../../src/app.js';
import { runtimeServices } from '../../src/infrastructure/runtime-services.js';
import { parseEnvironment } from '../../src/config/env.js';
import { tenantId, apiId, clientId, testVerifier, signTestToken } from '../helpers/entra-fixture.js';
import { pdfFixture, pngFixture, tempAttachmentRoot, removeAttachmentRoot } from '../helpers/attachment-fixture.js';

const database = `jm_test_${randomUUID().replaceAll('-', '')}`;
let master: SqlConnection | undefined; let connection: SqlConnection; let created = false;
let root: string; let store: LocalAttachmentStore; let uow: SqlAttachmentUnitOfWork;
let facade: AdjuntosFacade; let cleanup: AttachmentCleanup; let invoices: FacturasFacade;
let suppliers: ProveedoresFacade; let catalog: CatalogoFacade; let app: ReturnType<typeof createApp>;
let adminId: number; let mechanicId: number; let adminToken: string; let mechanicToken: string; let inactiveToken: string;
const settings = (name: string) => parseSqlSettings({ SQL_DRIVER: 'windows', SQL_SERVER: 'localhost', SQL_DATABASE: name, SQL_TRUST_CERTIFICATE: 'true' });
before(async () => {
  assert.match(database, /^jm_test_[a-f0-9]{32}$/);
  root = await tempAttachmentRoot(); store = new LocalAttachmentStore(root);
  master = await connectSql(settings('master'));
  await master.pool.request().query(`CREATE DATABASE [${database}];`); created = true;
  await master.pool.request().query(`ALTER DATABASE [${database}] SET READ_COMMITTED_SNAPSHOT ON;`);
  connection = await connectSql(settings(database)); await migrateInventory(connection); await migrateInventory(connection);
  uow = new SqlAttachmentUnitOfWork(connection); facade = new AdjuntosFacade(uow, store); cleanup = new AttachmentCleanup(uow, store);
  invoices = new FacturasFacade(new SqlInvoiceUnitOfWork(connection), inventoryEvents());
  suppliers = new ProveedoresFacade(new SqlSupplierUnitOfWork(connection)); catalog = new CatalogoFacade(new SqlCatalogUnitOfWork(connection), inventoryEvents());
  for (const kind of ['admin', 'mechanic', 'inactive']) {
    const oid = randomUUID(); const role = kind === 'mechanic' ? 'MECANICO' : 'ADMINISTRADOR';
    const result = await connection.pool.request().input('oid', connection.driver.UniqueIdentifier, oid)
      .input('tenant', connection.driver.UniqueIdentifier, tenantId).input('role', connection.driver.VarChar(20), role)
      .input('active', connection.driver.Bit, kind !== 'inactive')
      .query<{ id: number }>(`INSERT INTO jm.usuario(entra_tenant_id,entra_object_id,nombres,rol,activo)
        VALUES (@tenant,@oid,N'Empleado ficticio adjuntos',@role,@active); SELECT CONVERT(int,SCOPE_IDENTITY()) AS id;`);
    const token = await signTestToken({ oid, roles: [role === 'MECANICO' ? 'Mecanico' : 'Administrador'] });
    if (kind === 'admin') { adminId = result.recordset[0]!.id; adminToken = token; }
    else if (kind === 'mechanic') { mechanicId = result.recordset[0]!.id; mechanicToken = token; }
    else inactiveToken = token;
  }
  const services = runtimeServices({ ...settings(database), ATTACHMENT_LOCAL_ROOT: root, ENTRA_TENANT_ID: tenantId, ENTRA_API_CLIENT_ID: apiId, ENTRA_ALLOWED_CLIENT_IDS: clientId });
  services.verifyToken = testVerifier;
  app = createApp(parseEnvironment({ NODE_ENV: 'test' }), { info() {}, error() {} }, services);
});
after(async () => {
  await SqlPoolSingleton.getInstance().close(); await connection?.pool.close();
  if (created && master && /^jm_test_[a-f0-9]{32}$/.test(database)) {
    await master.pool.request().query(`ALTER DATABASE [${database}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${database}];`);
  }
  await master?.pool.close(); if (root) await removeAttachmentRoot(root);
  console.info('Adjuntos: base y archivos ficticios temporales eliminados; sin cambios en Azure ni datos del usuario.');
});
const auth = () => ({ Authorization: `Bearer ${adminToken}` });
const path = (id: number) => `/api/v1/compras/facturas/${id}/adjuntos`;
async function fixture() {
  const supplier = await suppliers.crear({ codigo: randomUUID(), razonSocial: 'Proveedor ficticio', correo: null }, adminId, randomUUID());
  const category = await catalog.crearCategoria({ nombre: randomUUID() }, adminId, randomUUID());
  const product = await catalog.crearProducto({ sku: randomUUID(), nombre: 'Producto ficticio', categoriaId: category.id, stockMinimo: 2, precioCompra: '1.00' }, adminId, randomUUID());
  const invoice = await invoices.crear({ proveedorId: supplier.id, numero: `D-${randomUUID()}`, fecha: '2026-10-21', moneda: 'PEN',
    lineas: [{ productoId: product.id, cantidad: 3, precioUnitario: '1.00' }] }, adminId, randomUUID());
  return { invoice, product };
}
async function upload(id: number, key: string = randomUUID(), f = facade, rid: string = randomUUID()) {
  return f.subir(id, 'Factura.pdf', 'application/pdf', pdfFixture, key, adminId, rid);
}
async function rows(invoiceId: number) {
  return (await connection.pool.request().input('invoice', connection.driver.Int, invoiceId)
    .query<{ id: string; estado: string }>('SELECT LOWER(CONVERT(varchar(36),id)) AS id,estado FROM jm.factura_adjunto WHERE factura_id=@invoice;')).recordset;
}
async function expired(invoiceId: number, partial = true) {
  const id = randomUUID(); const file = inspectAttachment('Factura.pdf', 'application/pdf', pdfFixture);
  await connection.pool.request().input('id', connection.driver.UniqueIdentifier, id).input('invoice', connection.driver.Int, invoiceId)
    .input('user', connection.driver.Int, adminId).input('key', connection.driver.UniqueIdentifier, randomUUID())
    .input('bytes', connection.driver.Int, file.bytes).input('sha', connection.driver.Char(64), file.sha256)
    .query(`INSERT INTO jm.factura_adjunto(id,factura_id,nombre,content_type,bytes,sha256,usuario_id,clave,creado_en)
      VALUES (@id,@invoice,N'Factura.pdf','application/pdf',@bytes,@sha,@user,@key,DATEADD(minute,-31,CONVERT(datetime2(3),SYSUTCDATETIME())));`);
  if (partial) await store.putIfAbsent(id, Buffer.from('%PDF-parcial'));
  return id;
}
test('Adjuntos HTTP: sesión y rol antes del binario; Mecánico/inactivo sin acceso ni escritura', async () => {
  const f = await fixture();
  await request(app).get(path(f.invoice.id)).expect(401);
  await request(app).post(path(f.invoice.id) + '?nombre=Factura.pdf').set('Content-Type', 'application/pdf').send(pdfFixture).expect(401);
  for (const token of [mechanicToken, inactiveToken]) {
    await request(app).get(path(f.invoice.id)).auth(token, { type: 'bearer' }).expect(403);
    await request(app).post(path(f.invoice.id) + '?nombre=Factura.pdf').auth(token, { type: 'bearer' })
      .set('Content-Type', 'application/pdf').set('Idempotency-Key', randomUUID()).send(pdfFixture).expect(403);
  }
  await assert.rejects(facade.subir(f.invoice.id, 'Factura.pdf', 'application/pdf', pdfFixture, randomUUID(), mechanicId, randomUUID()), { code: 'ATTACHMENT_FORBIDDEN' });
  assert.equal((await rows(f.invoice.id)).length, 0);
});
test('Adjuntos HTTP+SQL+disco: carga, listado y descarga privados sin cambiar factura/stock', async () => {
  const f = await fixture();
  const response = await request(app).post(path(f.invoice.id) + '?nombre=Factura.pdf').set(auth()).set('Content-Type', 'application/pdf')
    .set('Idempotency-Key', randomUUID()).send(pdfFixture).expect(201);
  const a = response.body.data; assert.equal(a.estado, 'LISTO'); assert.equal(a.bytes, pdfFixture.length);
  assert.equal('caducado' in a, false); assert.equal('ruta' in a, false);
  const list = await request(app).get(path(f.invoice.id)).set(auth()).expect(200);
  assert.equal(list.body.data.length, 1); assert.equal(list.headers['cache-control'], 'no-store');
  const downloaded = await request(app).get(`${path(f.invoice.id)}/${a.id}/contenido`).set(auth()).expect(200);
  assert.deepEqual(downloaded.body, pdfFixture); assert.match(downloaded.headers['content-disposition']!, /^attachment;/);
  assert.equal(downloaded.headers['content-type'], 'application/octet-stream'); assert.equal(downloaded.headers['x-content-type-options'], 'nosniff');
  await request(app).get(`/.local-data/attachments/${a.id}.bin`).expect(404);
  const invoice = await invoices.obtener(f.invoice.id, adminId, randomUUID()); assert.equal(invoice.version, f.invoice.version);
  const sql = await connection.pool.request().input('id', connection.driver.Int, f.product.id)
    .query(`SELECT cantidad_actual AS stock,(SELECT COUNT(*) FROM jm.movimiento WHERE producto_id=@id) AS movimientos FROM jm.stock WHERE producto_id=@id;`);
  assert.deepEqual(sql.recordset[0], { stock: 0, movimientos: 0 });
  await request(app).get(`${path(f.invoice.id)}/${a.id}/contenido`).auth(mechanicToken, { type: 'bearer' }).expect(403);
});
test('Adjuntos SQL+disco: cargas concurrentes con la misma clave conservan un objeto', async () => {
  const f = await fixture(); const key = randomUUID();
  const result = await Promise.all([upload(f.invoice.id, key), upload(f.invoice.id, key)]);
  assert.equal(result.filter((r) => r.repetido).length, 1); assert.equal(result[0]!.adjunto.id, result[1]!.adjunto.id);
  assert.equal((await rows(f.invoice.id)).length, 1);
  await assert.rejects(facade.subir(f.invoice.id, 'Otro.png', 'image/png', pngFixture, key, adminId, randomUUID()), { code: 'IDEMPOTENCY_CONFLICT' });
});
test('Adjuntos HTTP: MIME/firma/nombre/clave inválidos, comprimidos y más de 5 MiB se rechazan sin reserva', async () => {
  const f = await fixture(); const url = path(f.invoice.id);
  await request(app).post(url + '?nombre=Factura.pdf').set(auth()).set('Content-Type', 'application/pdf').send(pdfFixture).expect(400);
  await request(app).post(url + '?nombre=Factura.pdf').set(auth()).set('Content-Type', 'text/html').set('Idempotency-Key', randomUUID()).send('html').expect(415);
  await request(app).post(url + '?nombre=Factura.pdf').set(auth()).set('Content-Type', 'application/pdf').set('Idempotency-Key', randomUUID()).send(pngFixture).expect(415);
  await request(app).post(url + '?nombre=..%2Ffoo.pdf').set(auth()).set('Content-Type', 'application/pdf').set('Idempotency-Key', randomUUID()).send(pdfFixture).expect(400);
  await request(app).post(url + '?nombre=Factura.pdf').set(auth()).set('Content-Type', 'application/pdf').set('Content-Encoding', 'gzip')
    .set('Idempotency-Key', randomUUID()).send(pdfFixture).expect(415);
  await request(app).post(url + '?nombre=Factura.pdf').set(auth()).set('Content-Type', 'application/pdf')
    .set('Idempotency-Key', randomUUID()).send(Buffer.alloc(MAX_ATTACHMENT_BYTES + 1)).expect(413);
  assert.equal((await rows(f.invoice.id)).length, 0);
});
test('Adjuntos SQL: factura inexistente/anulada bloquea subida; recibida permite añadir sin modificarla', async () => {
  await assert.rejects(upload(2_000_000_000), { code: 'INVOICE_NOT_FOUND' });
  const f = await fixture(); await invoices.anular(f.invoice.id, {}, f.invoice.version, adminId, randomUUID());
  await assert.rejects(upload(f.invoice.id), { code: 'ATTACHMENT_INVOICE_CANCELLED' });
  const g = await fixture(); const received = (await invoices.confirmar(g.invoice.id, {}, g.invoice.version, randomUUID(), adminId, randomUUID())).factura;
  await upload(received.id); assert.equal((await invoices.obtener(received.id, adminId, randomUUID())).version, received.version);
});
test('Adjuntos HTTP: IDs cruzados o pendientes no revelan contenido', async () => {
  const f = await fixture(); const g = await fixture(); const a = (await upload(f.invoice.id)).adjunto;
  await request(app).get(`${path(g.invoice.id)}/${a.id}/contenido`).set(auth()).expect(404);
  await request(app).get(`${path(f.invoice.id)}/no-es-uuid/contenido`).set(auth()).expect(400);
  const id = await expired(f.invoice.id, false);
  await request(app).get(`${path(f.invoice.id)}/${id}/contenido`).set(auth()).expect(404);
});
test('Adjuntos SQL: cinco reservas/listos como máximo, incluso con altas concurrentes', async () => {
  const f = await fixture();
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => upload(f.invoice.id)));
  const failures = results.filter((r) => r.status === 'rejected').map((r) => ({ code: r.reason.code, number: r.reason.number,
    message: r.reason.message, preceding: r.reason.precedingErrors?.map((e: { number?: number; message?: string }) => ({ number: e.number, message: e.message })) }));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 5, JSON.stringify(failures));
  const failed = results.find((r) => r.status === 'rejected');
  assert.equal(failed?.status === 'rejected' && failed.reason.code, 'ATTACHMENT_LIMIT'); assert.equal((await rows(f.invoice.id)).length, 5);
});
test('Adjuntos SQL: fallo de auditoría de reserva no deja SQL ni toca el almacenamiento', async () => {
  const f = await fixture(); const rid = randomUUID(); let calls = 0;
  await connection.pool.request().batch(`CREATE TRIGGER jm.tr_attach_reserve_fail ON jm.auditoria AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE request_id='${rid}' AND accion='ADJUNTO_RESERVADO') THROW 51961,'Fallo ficticio reserva.',1; END;`);
  const failing = new AdjuntosFacade(uow, { putIfAbsent: async () => { calls++; }, read: async () => pdfFixture, remove: async () => {} });
  await assert.rejects(upload(f.invoice.id, randomUUID(), failing, rid));
  assert.equal(calls, 0); assert.equal((await rows(f.invoice.id)).length, 0);
});
test('Adjuntos SQL+disco: caída tras escribir deja PENDIENTE; replay recupera el mismo objeto', async () => {
  const f = await fixture(); const key = randomUUID();
  const failing: AttachmentStore = { putIfAbsent: async (id, bytes) => { await store.putIfAbsent(id, bytes); throw new Error('Caída ficticia'); },
    read: (id) => store.read(id), remove: (id) => store.remove(id) };
  await assert.rejects(upload(f.invoice.id, key, new AdjuntosFacade(uow, failing)));
  const pending = (await rows(f.invoice.id))[0]!; assert.equal(pending.estado, 'PENDIENTE');
  assert.deepEqual(await store.read(pending.id), pdfFixture);
  const retried = await upload(f.invoice.id, key); assert.equal(retried.adjunto.id, pending.id); assert.equal(retried.adjunto.estado, 'LISTO');
});
test('Adjuntos SQL+disco: fallo de auditoría final no afirma éxito ni pierde registro del archivo', async () => {
  const f = await fixture(); const key = randomUUID(); const rid = randomUUID();
  await connection.pool.request().batch(`CREATE TRIGGER jm.tr_attach_ready_fail ON jm.auditoria AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE request_id='${rid}' AND accion='ADJUNTO_LISTO') THROW 51962,'Fallo ficticio confirmación.',1; END;`);
  await assert.rejects(upload(f.invoice.id, key, facade, rid));
  const pending = (await rows(f.invoice.id))[0]!; assert.equal(pending.estado, 'PENDIENTE');
  assert.deepEqual(await store.read(pending.id), pdfFixture);
  await upload(f.invoice.id, key); assert.equal((await rows(f.invoice.id))[0]!.estado, 'LISTO');
});
test('Adjuntos HTTP: contenido alterado devuelve 503 y no audita descarga autorizada', async () => {
  const f = await fixture(); const a = (await upload(f.invoice.id)).adjunto;
  await writeFile(join(root, `${a.id}.bin`), Buffer.from('Contenido alterado ficticio'));
  const response = await request(app).get(`${path(f.invoice.id)}/${a.id}/contenido`).set(auth()).expect(503);
  assert.equal(response.body.error.code, 'ATTACHMENT_INTEGRITY');
  const rows = await connection.pool.request().input('rid', connection.driver.UniqueIdentifier, response.headers['x-request-id'])
    .query(`SELECT accion FROM jm.auditoria WHERE request_id=@rid;`);
  assert.ok(!rows.recordset.some((r) => r.accion === 'ADJUNTO_DESCARGA_AUTORIZADA'));
});
test('Adjuntos SQL+disco: lectura ausente y auditoría fallida no devuelven bytes', async () => {
  const f = await fixture(); const a = (await upload(f.invoice.id)).adjunto;
  await unlink(join(root, `${a.id}.bin`));
  await request(app).get(`${path(f.invoice.id)}/${a.id}/contenido`).set(auth()).expect(503);
  const b = (await upload(f.invoice.id)).adjunto; const rid = randomUUID();
  await connection.pool.request().batch(`CREATE TRIGGER jm.tr_attach_download_fail ON jm.auditoria AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE request_id='${rid}' AND accion='ADJUNTO_DESCARGA_AUTORIZADA') THROW 51963,'Fallo ficticio descarga.',1; END;`);
  await assert.rejects(facade.descargar(f.invoice.id, b.id, adminId, rid));
});
test('Limpieza SQL+disco: consulta sin efectos; elimina solo pendientes antiguos y conserva listos', async () => {
  const f = await fixture(); const ready = (await upload(f.invoice.id)).adjunto;
  const old = await expired(f.invoice.id); const missing = await expired(f.invoice.id, false);
  const preview = await cleanup.pendientes(); assert.ok(preview.some((row) => row.id === old));
  assert.ok((await readdir(root)).includes(`${old}.bin`));
  const result = await cleanup.ejecutar(); assert.ok(result.eliminados >= 2);
  assert.equal((await rows(f.invoice.id)).find((r) => r.id === old)!.estado, 'ELIMINADO');
  assert.equal((await rows(f.invoice.id)).find((r) => r.id === missing)!.estado, 'ELIMINADO');
  assert.deepEqual(await store.read(ready.id), pdfFixture);
  assert.equal((await facade.listar(f.invoice.id, adminId, randomUUID())).data.length, 1);
});
test('Limpieza SQL+disco: dos limpiadores simultáneos no borran dos veces ni cambian listos', async () => {
  const f = await fixture(); const old = await expired(f.invoice.id);
  const results = await Promise.all([cleanup.ejecutar(), cleanup.ejecutar()]);
  assert.equal(results.reduce((sum, r) => sum + r.eliminados, 0), 1);
  const events = await connection.pool.request().input('id', connection.driver.VarChar(40), old)
    .query<{ n: number }>(`SELECT COUNT(*) AS n FROM jm.auditoria WHERE entidad_id=@id AND accion='ADJUNTO_LIMPIADO';`);
  assert.equal(events.recordset[0]!.n, 1);
});
test('Limpieza SQL: fallo de disco o auditoría conserva estado recuperable, no falso ELIMINADO', async () => {
  const f = await fixture(); const old = await expired(f.invoice.id);
  const failing = new AttachmentCleanup(uow, { putIfAbsent: (id, b) => store.putIfAbsent(id, b), read: (id) => store.read(id),
    remove: async () => { throw new Error('Fallo ficticio disco.'); } });
  await assert.rejects(failing.ejecutar()); assert.equal((await rows(f.invoice.id)).find((r) => r.id === old)!.estado, 'PENDIENTE');
  await connection.pool.request().batch(`CREATE TRIGGER jm.tr_attach_cleanup_fail ON jm.auditoria AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE entidad_id='${old}' AND accion='ADJUNTO_LIMPIADO') THROW 51964,'Fallo ficticio limpieza.',1; END;`);
  await assert.rejects(cleanup.ejecutar()); assert.equal((await rows(f.invoice.id)).find((r) => r.id === old)!.estado, 'PENDIENTE');
  await connection.pool.request().batch('DROP TRIGGER jm.tr_attach_cleanup_fail;');
  await cleanup.ejecutar(); assert.equal((await rows(f.invoice.id)).find((r) => r.id === old)!.estado, 'ELIMINADO');
});
test('Adjuntos SQL: metadatos y registros listos no se borran/alteran con DML ordinario', async () => {
  const f = await fixture(); const a = (await upload(f.invoice.id)).adjunto;
  for (const query of ['UPDATE jm.factura_adjunto SET nombre=N\'otro.pdf\' WHERE id=@id;', 'DELETE FROM jm.factura_adjunto WHERE id=@id;']) {
    await assert.rejects(connection.pool.request().input('id', connection.driver.UniqueIdentifier, a.id).query(query));
  }
  assert.equal((await rows(f.invoice.id))[0]!.estado, 'LISTO');
});
test('Adjuntos SQL+disco: reserva caducada no revive ni reutiliza su clave después de limpiar', async () => {
  const f = await fixture(); const old = await expired(f.invoice.id);
  const row = await connection.pool.request().input('id', connection.driver.UniqueIdentifier, old)
    .query<{ clave: string }>('SELECT CONVERT(varchar(36),clave) AS clave FROM jm.factura_adjunto WHERE id=@id;');
  const key = row.recordset[0]!.clave;
  await assert.rejects(upload(f.invoice.id, key), { code: 'ATTACHMENT_EXPIRED' });
  await cleanup.ejecutar();
  await assert.rejects(upload(f.invoice.id, key), { code: 'ATTACHMENT_EXPIRED' });
  const next = await upload(f.invoice.id); assert.notEqual(next.adjunto.id, old);
  assert.equal((await facade.listar(f.invoice.id, adminId, randomUUID())).data.length, 1);
});
test('Adjuntos HTTP: tercera carga en curso recibe 429 y las plazas se liberan al terminar', async () => {
  const f = await fixture(); const g = await fixture();
  let release!: () => void; let both!: () => void; let entries = 0;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { both = resolve; });
  const gated: AttachmentStore = {
    putIfAbsent: async (id, bytes) => { entries++; if (entries === 2) both(); await blocked; await store.putIfAbsent(id, bytes); },
    read: (id) => store.read(id), remove: (id) => store.remove(id),
  };
  const services = runtimeServices({ ...settings(database), ENTRA_TENANT_ID: tenantId, ENTRA_API_CLIENT_ID: apiId, ENTRA_ALLOWED_CLIENT_IDS: clientId });
  services.verifyToken = testVerifier; services.attachments = async () => new AdjuntosFacade(uow, gated);
  const limitedApp = createApp(parseEnvironment({ NODE_ENV: 'test' }), { info() {}, error() {} }, services);
  const send = (id: number) => request(limitedApp).post(path(id) + '?nombre=Factura.pdf').set(auth())
    .set('Content-Type', 'application/pdf').set('Idempotency-Key', randomUUID()).send(pdfFixture);
  const first = send(f.invoice.id).then((response) => response);
  const second = send(g.invoice.id).then((response) => response);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([entered, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('No se iniciaron dos cargas.')), 20_000); })]);
    await send(f.invoice.id).expect(429);
  } finally { if (timer) clearTimeout(timer); release(); }
  const results = await Promise.all([first, second]); assert.ok(results.every((r) => r.status === 201));
  await send(f.invoice.id).expect(201);
});
