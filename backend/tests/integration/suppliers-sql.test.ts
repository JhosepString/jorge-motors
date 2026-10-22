import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import request from 'supertest';
import { connectSql, SqlPoolSingleton, type SqlConnection } from '../../src/infrastructure/database/sql-pool.js';
import { parseSqlSettings } from '../../src/infrastructure/database/sql-settings.js';
import { migrateInventory } from '../../src/infrastructure/database/migrate.js';
import { SqlSupplierUnitOfWork } from '../../src/infrastructure/database/sql-suppliers.js';
import { ProveedoresFacade } from '../../src/modules/compras/application/proveedores.facade.js';
import { createApp } from '../../src/app.js';
import { runtimeServices } from '../../src/infrastructure/runtime-services.js';
import { parseEnvironment } from '../../src/config/env.js';
import { tenantId, apiId, clientId, testVerifier, signTestToken } from '../helpers/entra-fixture.js';

const database = `jm_test_${randomUUID().replaceAll('-', '')}`;
let master: SqlConnection | undefined;
let connection: SqlConnection | undefined;
let created = false;
let facade: ProveedoresFacade;
let app: ReturnType<typeof createApp>;
let adminId: number;
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
  connection = await connectSql(settings(database));
  await migrateInventory(connection); await migrateInventory(connection);
  facade = new ProveedoresFacade(new SqlSupplierUnitOfWork(connection));
  for (const kind of ['admin', 'mechanic', 'inactive']) {
    const oid = randomUUID(); const role = kind === 'mechanic' ? 'MECANICO' : 'ADMINISTRADOR';
    const result = await connection.pool.request().input('oid', connection.driver.UniqueIdentifier, oid)
      .input('tenant', connection.driver.UniqueIdentifier, tenantId).input('role', connection.driver.VarChar(20), role)
      .input('active', connection.driver.Bit, kind !== 'inactive')
      .query<{ id: number }>(`INSERT INTO jm.usuario(entra_tenant_id,entra_object_id,nombres,rol,activo)
        VALUES (@tenant,@oid,N'Empleado ficticio proveedores',@role,@active); SELECT CONVERT(int,SCOPE_IDENTITY()) AS id;`);
    const token = await signTestToken({ oid, roles: [role === 'ADMINISTRADOR' ? 'Administrador' : 'Mecanico'] });
    const id = result.recordset[0]!.id;
    if (kind === 'admin') { adminId = id; adminToken = token; }
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
    console.info('Proveedores: base efímera eliminada; no se contactó Azure ni correo.');
  }
  await master?.pool.close();
});
const base = '/api/v1/compras/proveedores';
const auth = () => ({ Authorization: `Bearer ${adminToken}` });
const input = () => ({ codigo: randomUUID(), razonSocial: 'Proveedor ficticio Ñ', correo: 'contacto@example.invalid' });
async function create() { return facade.crear(input(), adminId, randomUUID()); }
async function audit(rid: string) {
  return (await connection!.pool.request().input('rid', connection!.driver.UniqueIdentifier, rid)
    .query<{ accion: string; usuario: number | null; codigo: string; antes: string | null; despues: string | null }>(
      `SELECT accion,usuario_id AS usuario,codigo,valores_anteriores AS antes,valores_nuevos AS despues FROM jm.auditoria WHERE request_id=@rid;`)).recordset;
}
test('Proveedores HTTP: 401 anónimo, 403 Mecánico/inactivo y rechazos auditados', async () => {
  const anonymous = await request(app).get(base).expect(401);
  assert.equal((await audit(anonymous.headers['x-request-id']!))[0]!.usuario, null);
  for (const method of ['get', 'post', 'put'] as const) {
    const response = await request(app)[method](method === 'put' ? `${base}/1` : base)
      .auth(mechanicToken, { type: 'bearer' }).send({}).expect(403);
    assert.equal((await audit(response.headers['x-request-id']!))[0]!.codigo, 'ROLE_FORBIDDEN');
  }
  await request(app).get(base).auth(inactiveToken, { type: 'bearer' }).expect(403);
  for (const actor of [mechanicId, inactiveId, 2_000_000_000]) {
    await assert.rejects(facade.crear(input(), actor, randomUUID()), { code: 'SUPPLIER_FORBIDDEN' });
  }
});
test('Proveedores HTTP+SQL: alta unicode y lectura; sin usuario, stock, alerta ni correo', async () => {
  const response = await request(app).post(base).set(auth()).send(input()).expect(201);
  const p = response.body.data;
  assert.equal(p.razonSocial, 'Proveedor ficticio Ñ'); assert.equal(p.activo, true);
  assert.match(p.version, /^[0-9A-F]{16}$/); assert.equal(response.headers.etag, `"${p.version}"`);
  const read = await request(app).get(`${base}/${p.id}`).set(auth()).expect(200);
  assert.equal(read.headers['cache-control'], 'no-store'); assert.deepEqual(read.body.data, p);
  const rows = await audit(response.headers['x-request-id']!);
  assert.equal(rows[0]!.accion, 'PROVEEDOR_CREADO'); assert.equal(rows[0]!.usuario, adminId);
  assert.equal(JSON.parse(rows[0]!.despues!).correoConfigurado, true);
  assert.equal(rows[0]!.despues!.includes('contacto@example.invalid'), false);
  const counts = await connection!.pool.request().query(`SELECT
    (SELECT COUNT(*) FROM jm.usuario) AS usuarios,(SELECT COUNT(*) FROM jm.producto) AS productos,
    (SELECT COUNT(*) FROM jm.movimiento) AS movimientos,(SELECT COUNT(*) FROM jm.notificacion_outbox) AS tareas;`);
  assert.deepEqual(counts.recordset[0], { usuarios: 3, productos: 0, movimientos: 0, tareas: 0 });
});
test('Proveedores HTTP: edición, desactivación/reactivación y conflicto con versión anterior', async () => {
  const p = await create(); const path = `${base}/${p.id}`;
  const body = { razonSocial: 'Proveedor actualizado', correo: null, activo: false };
  await request(app).put(path).set(auth()).send(body).expect(428);
  for (const tag of ['*', `W/"${p.version}"`, `"${p.version}","${p.version}"`]) {
    await request(app).put(path).set(auth()).set('If-Match', tag).send(body).expect(400);
  }
  const updated = await request(app).put(path).set(auth()).set('If-Match', `"${p.version}"`).send(body).expect(200);
  assert.equal(updated.body.data.activo, false); assert.equal(updated.body.data.correo, null);
  assert.notEqual(updated.body.data.version, p.version);
  await request(app).put(path).set(auth()).set('If-Match', `"${p.version}"`).send({ ...body, razonSocial: 'Obsoleto' }).expect(412);
  const rows = await audit(updated.headers['x-request-id']!);
  assert.equal(JSON.parse(rows[0]!.antes!).activo, true); assert.equal(JSON.parse(rows[0]!.despues!).activo, false);
  const activated = await request(app).put(path).set(auth()).set('If-Match', updated.headers.etag!).send({ ...body, activo: true }).expect(200);
  assert.equal(activated.body.data.activo, true); assert.equal(activated.body.data.codigo, p.codigo);
});
test('Proveedores SQL: altas concurrentes con mismo código solo confirman una', async () => {
  const data = input();
  const result = await Promise.allSettled([facade.crear(data, adminId, randomUUID()), facade.crear(data, adminId, randomUUID())]);
  assert.equal(result.filter((row) => row.status === 'fulfilled').length, 1);
  const failed = result.find((row) => row.status === 'rejected');
  assert.equal(failed?.status === 'rejected' && failed.reason.code, 'SUPPLIER_DUPLICATE');
});
test('Proveedores SQL: dos ediciones sobre una versión aceptan una sola', async () => {
  const p = await create(); const data = { razonSocial: 'Primera', correo: null, activo: true };
  const result = await Promise.allSettled([
    facade.actualizar(p.id, data, p.version, adminId, randomUUID()),
    facade.actualizar(p.id, { ...data, razonSocial: 'Segunda' }, p.version, adminId, randomUUID()),
  ]);
  assert.equal(result.filter((row) => row.status === 'fulfilled').length, 1);
  const failed = result.find((row) => row.status === 'rejected');
  assert.equal(failed?.status === 'rejected' && failed.reason.code, 'STALE_VERSION');
});
test('Proveedores HTTP: validación estricta, código inmutable y sin borrado físico', async () => {
  const p = await create(); const body = { razonSocial: p.razonSocial, correo: null, activo: true };
  for (const extra of [{ codigo: 'OTRO' }, { usuarioId: adminId }, { activo: 'false' }, { correo: 'incorrecto' }, { stockActual: 10 }]) {
    await request(app).put(`${base}/${p.id}`).set(auth()).set('If-Match', `"${p.version}"`).send({ ...body, ...extra }).expect(400);
  }
  await request(app).delete(`${base}/${p.id}`).set(auth()).expect(404);
  const after = await facade.obtener(p.id, adminId, randomUUID()); assert.equal(after.version, p.version);
  await request(app).get(`${base}/1x`).set(auth()).expect(400);
  await request(app).get(`${base}/2000000000`).set(auth()).expect(404);
  await request(app).put(`${base}/2000000000`).set(auth()).set('If-Match', `"${p.version}"`).send(body).expect(404);
});
test('Proveedores SQL: nombre parametrizado no se interpreta como SQL', async () => {
  const name = "Contacto'; DROP TABLE jm.proveedor; --";
  const p = await facade.crear({ ...input(), razonSocial: name }, adminId, randomUUID());
  assert.equal((await facade.obtener(p.id, adminId, randomUUID())).razonSocial, name);
});
test('Proveedores HTTP: paginación acotada y sin filtros desconocidos', async () => {
  const p1 = await create(); const p2 = await create(); const p3 = await create();
  const first = await request(app).get(`${base}?despuesDe=${p1.id}&limite=1`).set(auth()).expect(200);
  assert.equal(first.body.data[0].id, p2.id); assert.equal(first.body.siguiente, p2.id);
  const next = await request(app).get(`${base}?despuesDe=${p2.id}&limite=1`).set(auth()).expect(200);
  assert.equal(next.body.data[0].id, p3.id); assert.equal(next.body.siguiente, null);
  for (const query of ['limite=101', 'limite=0', 'foo=1', 'despuesDe=-1']) {
    await request(app).get(`${base}?${query}`).set(auth()).expect(400);
  }
});
test('Proveedores SQL: fallo al auditar alta revierte proveedor y su auditoría', async () => {
  const data = input(); const rid = randomUUID();
  await connection!.pool.request().batch(`CREATE TRIGGER jm.tr_supplier_create_fail ON jm.auditoria AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE request_id='${rid}') THROW 51981,'Fallo ficticio proveedor.',1; END;`);
  await assert.rejects(facade.crear(data, adminId, rid));
  const count = await connection!.pool.request().input('code', connection!.driver.VarChar(40), data.codigo.toUpperCase())
    .query<{ n: number }>('SELECT COUNT(*) AS n FROM jm.proveedor WHERE codigo=@code;');
  assert.equal(count.recordset[0]!.n, 0); assert.deepEqual(await audit(rid), []);
});
test('Proveedores SQL: fallo al auditar edición revierte datos, activo y versión', async () => {
  const p = await create(); const rid = randomUUID();
  await connection!.pool.request().batch(`CREATE TRIGGER jm.tr_supplier_edit_fail ON jm.auditoria AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE request_id='${rid}') THROW 51982,'Fallo ficticio edición.',1; END;`);
  await assert.rejects(facade.actualizar(p.id, { razonSocial: 'No confirmar', correo: null, activo: false }, p.version, adminId, rid));
  assert.deepEqual(await facade.obtener(p.id, adminId, randomUUID()), p); assert.deepEqual(await audit(rid), []);
});
