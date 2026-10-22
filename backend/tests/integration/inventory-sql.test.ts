import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { connectSql, type SqlConnection } from '../../src/infrastructure/database/sql-pool.js';
import { parseSqlSettings } from '../../src/infrastructure/database/sql-settings.js';
import { migrateInventory } from '../../src/infrastructure/database/migrate.js';
import { SqlInventoryUnitOfWork } from '../../src/infrastructure/database/sql-inventory.js';
import { InventarioFacade } from '../../src/modules/inventario/application/inventario.facade.js';
import type { MovimientoInput } from '../../src/modules/inventario/application/inventario.facade.js';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { parseEnvironment } from '../../src/config/env.js';
import { runtimeServices } from '../../src/infrastructure/runtime-services.js';
import { SqlPoolSingleton } from '../../src/infrastructure/database/sql-pool.js';
import { tenantId, apiId, clientId, testVerifier, signTestToken } from '../helpers/entra-fixture.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inventoryEvents } from '../../src/infrastructure/inventory-events.js';

// No lee .env ni acepta destinos cloud. Solo crea una base efímera en localhost.
const databaseName = `jm_test_${randomUUID().replaceAll('-', '')}`;
let admin: SqlConnection | undefined;
let connection: SqlConnection | undefined;
let created = false;
let facade: InventarioFacade;
let administrator: number;
let mechanic: number;
let inactive: number;

before(async () => {
  admin = await connectSql(parseSqlSettings({
    SQL_DRIVER: 'windows', SQL_SERVER: 'localhost', SQL_DATABASE: 'master', SQL_TRUST_CERTIFICATE: 'true',
  }));
  assert.match(databaseName, /^jm_test_[a-f0-9]{32}$/);
  await admin.pool.request().query(`CREATE DATABASE [${databaseName}];`);
  created = true;
  connection = await connectSql(parseSqlSettings({
    SQL_DRIVER: 'windows', SQL_SERVER: 'localhost', SQL_DATABASE: databaseName, SQL_TRUST_CERTIFICATE: 'true',
  }));
  await migrateInventory(connection);
  facade = new InventarioFacade(new SqlInventoryUnitOfWork(connection), inventoryEvents());
  for (const [name, role, active] of [
    ['Administrador ficticio', 'ADMINISTRADOR', 1], ['Mecánico ficticio', 'MECANICO', 1],
    ['Usuario inactivo ficticio', 'MECANICO', 0],
  ] as const) {
    const result = await connection.pool.request()
      .input('name', connection.driver.NVarChar(150), name)
      .input('role', connection.driver.VarChar(20), role)
      .input('active', connection.driver.Bit, active)
      .input('tenant', connection.driver.UniqueIdentifier, tenantId)
      .query<{ id: number }>(`INSERT INTO jm.usuario(entra_tenant_id, entra_object_id, nombres, rol, activo)
        VALUES (@tenant, NEWID(), @name, @role, @active);
        SELECT CONVERT(int, SCOPE_IDENTITY()) AS id;`);
    if (role === 'ADMINISTRADOR') administrator = result.recordset[0]!.id;
    else if (active) mechanic = result.recordset[0]!.id;
    else inactive = result.recordset[0]!.id;
  }
  await connection.pool.request().query("INSERT INTO jm.categoria(nombre) VALUES (N'Repuestos de prueba');");
});

after(async () => {
  await SqlPoolSingleton.getInstance().close();
  await connection?.pool.close();
  if (created && admin && /^jm_test_[a-f0-9]{32}$/.test(databaseName)) {
    // Únicamente la base creada en ESTE proceso; jamás se toma de configuración.
    await admin.pool.request().query(`ALTER DATABASE [${databaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [${databaseName}];`);
    console.info('Base efímera SQL de pruebas eliminada; no contiene datos del usuario.');
  }
  await admin?.pool.close();
});

async function product(stock = 3): Promise<number> {
  const { pool, driver } = connection!;
  const result = await pool.request().input('sku', driver.VarChar(40), randomUUID())
    .input('stock', driver.Int, stock)
    .query<{ id: number }>(`INSERT INTO jm.producto(sku, nombre, categoria_id, stock_minimo)
      VALUES (@sku, N'Filtro ficticio', (SELECT MIN(id) FROM jm.categoria), 2);
      DECLARE @id int = CONVERT(int, SCOPE_IDENTITY());
      INSERT INTO jm.stock(producto_id, cantidad_actual) VALUES (@id, @stock);
      SELECT @id AS id;`);
  return result.recordset[0]!.id;
}
function command(productoId: number, cantidad = 2): MovimientoInput {
  return { productoId, cantidad, motivo: 'Uso en taller', referencia: 'OT-externa-001', claveIdempotencia: randomUUID() };
}
async function balance(productoId: number) {
  return (await connection!.pool.request().input('id', connection!.driver.Int, productoId)
    .query<{ cantidad: number; movimientos: number }>(`SELECT s.cantidad_actual AS cantidad,
      (SELECT COUNT(*) FROM jm.movimiento WHERE producto_id = @id) AS movimientos
      FROM jm.stock AS s WHERE s.producto_id = @id;`)).recordset[0]!;
}

test('SQL: migración repetible sin borrar datos', async () => {
  await migrateInventory(connection!);
  const result = await connection!.pool.request().query<{ n: number }>('SELECT COUNT(*) AS n FROM jm.usuario;');
  assert.equal(result.recordset[0]!.n, 3);
});

test('SQL: salida e ingreso persisten saldos e historial en una transacción', async () => {
  const id = await product();
  const salida = await facade.registrarSalida(command(id), mechanic);
  assert.equal(salida.movimiento.stockAnterior, 3);
  assert.equal(salida.movimiento.stockResultante, 1);
  const entrada = await facade.registrarEntrada(command(id, 5), administrator);
  assert.equal(entrada.movimiento.stockResultante, 6);
  assert.deepEqual(await balance(id), { cantidad: 6, movimientos: 2 });
});

test('SQL: dos salidas simultáneas no dejan stock negativo', async () => {
  const id = await product(3);
  const results = await Promise.allSettled([
    facade.registrarSalida(command(id, 2), mechanic),
    facade.registrarSalida(command(id, 2), mechanic),
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  const failure = results.find((item) => item.status === 'rejected');
  assert.equal(failure?.status === 'rejected' && failure.reason.code, 'INSUFFICIENT_STOCK');
  assert.deepEqual(await balance(id), { cantidad: 1, movimientos: 1 });
});

test('SQL: dos salidas válidas concurrentes tienen saldos encadenados', async () => {
  const id = await product(5);
  const results = await Promise.all([
    facade.registrarSalida(command(id), mechanic), facade.registrarSalida(command(id), mechanic),
  ]);
  assert.deepEqual(results.map((item) => item.movimiento.stockAnterior).sort(), [3, 5]);
  assert.deepEqual(await balance(id), { cantidad: 1, movimientos: 2 });
});

test('SQL: solicitudes duplicadas concurrentes descuentan una sola vez', async () => {
  const id = await product();
  const input = command(id);
  const results = await Promise.all([
    facade.registrarSalida(input, mechanic), facade.registrarSalida(input, mechanic),
  ]);
  assert.equal(results[0].movimiento.id, results[1].movimiento.id);
  assert.equal(results.filter((item) => item.repetido).length, 1);
  assert.deepEqual(await balance(id), { cantidad: 1, movimientos: 1 });
});

test('SQL: reutilizar una clave con otros datos se rechaza sin alterar stock', async () => {
  const id = await product();
  const input = command(id);
  await facade.registrarSalida(input, mechanic);
  await assert.rejects(facade.registrarSalida({ ...input, cantidad: 1 }, mechanic), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(await balance(id), { cantidad: 1, movimientos: 1 });
});

test('SQL: entrada por mecánico y operación por usuario inactivo son rechazadas', async () => {
  const id = await product();
  await assert.rejects(facade.registrarEntrada(command(id), mechanic), { code: 'FORBIDDEN_MOVEMENT' });
  await assert.rejects(facade.registrarSalida(command(id), inactive), { code: 'USER_NOT_ACTIVE' });
  assert.deepEqual(await balance(id), { cantidad: 3, movimientos: 0 });
});

test('SQL: producto inexistente e inactivo son rechazados', async () => {
  const id = await product();
  await connection!.pool.request().input('id', connection!.driver.Int, id)
    .query('UPDATE jm.producto SET activo = 0 WHERE id = @id;');
  await assert.rejects(facade.registrarSalida(command(id), mechanic), { code: 'PRODUCT_NOT_ACTIVE' });
  await assert.rejects(facade.registrarSalida(command(2_000_000_000), mechanic), { code: 'PRODUCT_NOT_FOUND' });
  assert.deepEqual(await balance(id), { cantidad: 3, movimientos: 0 });
});

test('SQL: un fallo de escritura del historial revierte también el descuento', async () => {
  const id = await product();
  await connection!.pool.request().batch(`CREATE TRIGGER jm.tr_prueba_fallo ON jm.movimiento AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE motivo = N'FORZAR_FALLO')
      THROW 51999, 'Fallo simulado de almacenamiento.', 1; END;`);
  await assert.rejects(facade.registrarSalida({ ...command(id), motivo: 'FORZAR_FALLO' }, mechanic));
  assert.deepEqual(await balance(id), { cantidad: 3, movimientos: 0 });
});

test('SQL: historial inmutable incluso con UPDATE y DELETE directos', async () => {
  const id = await product();
  const result = await facade.registrarSalida(command(id), mechanic);
  for (const statement of ['UPDATE jm.movimiento SET motivo = N\'Cambio\' WHERE id = @id;', 'DELETE FROM jm.movimiento WHERE id = @id;']) {
    await assert.rejects(connection!.pool.request().input('id', connection!.driver.Int, result.movimiento.id).query(statement));
  }
  assert.deepEqual(await balance(id), { cantidad: 1, movimientos: 1 });
});

test('SQL: referencias se parametrizan, sin interpretar su contenido como SQL', async () => {
  const id = await product();
  const reference = "OT'; DROP TABLE jm.producto; --";
  const result = await facade.registrarSalida({ ...command(id), referencia: reference }, mechanic);
  assert.equal(result.movimiento.referencia, reference);
  assert.deepEqual(await balance(id), { cantidad: 1, movimientos: 1 });
});

function protectedApp() {
  const services = runtimeServices({
    ENTRA_TENANT_ID: tenantId, ENTRA_API_CLIENT_ID: apiId, ENTRA_ALLOWED_CLIENT_IDS: clientId,
    SQL_DRIVER: 'windows', SQL_SERVER: 'localhost', SQL_DATABASE: databaseName, SQL_TRUST_CERTIFICATE: 'true',
  });
  services.verifyToken = testVerifier; // Firma RSA local de prueba, sin llamadas al tenant.
  const lookup = services.profiles.buscarIdentidad;
  services.profiles.buscarIdentidad = async (...args) => {
    const profile = await lookup(...args);
    if (profile) assert.equal(typeof profile.id, 'number', 'El ID SQL debe ser numérico.');
    return profile;
  };
  return createApp(parseEnvironment({ NODE_ENV: 'test' }), { info() {}, error() {} }, services);
}
async function tokenFor(userId: number, role: string) {
  const result = await connection!.pool.request().input('id', connection!.driver.Int, userId)
    .query<{ objectId: string }>('SELECT CONVERT(varchar(36), entra_object_id) AS objectId FROM jm.usuario WHERE id = @id;');
  return signTestToken({ oid: result.recordset[0]!.objectId, roles: [role] });
}

test('HTTP+SQL: movimiento autorizado y auditoría se guardan con identidad y requestId', async () => {
  const id = await product();
  const app = protectedApp();
  const token = await tokenFor(mechanic, 'Mecanico');
  const res = await request(app).post('/api/v1/inventario/salidas')
    .auth(token, { type: 'bearer' }).set('Idempotency-Key', randomUUID())
    .send({ productoId: id, cantidad: 2, motivo: 'Prueba HTTP auditada' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const audits = await connection!.pool.request().input('request', connection!.driver.UniqueIdentifier, res.headers['x-request-id'])
    .query<{ usuario_id: number; accion: string; valores_anteriores: string; valores_nuevos: string }>(
      "SELECT usuario_id, accion, valores_anteriores, valores_nuevos FROM jm.auditoria WHERE request_id = @request AND codigo = 'MOVEMENT_CREATED';",
    );
  assert.equal(audits.recordset.length, 1);
  assert.equal(audits.recordset[0]!.usuario_id, mechanic);
  assert.equal(audits.recordset[0]!.accion, 'INVENTARIO_SALIDA');
  assert.deepEqual(JSON.parse(audits.recordset[0]!.valores_anteriores), { stock: 3 });
  assert.deepEqual(JSON.parse(audits.recordset[0]!.valores_nuevos), { stock: 1 });
  assert.equal(res.body.data.requestHash, undefined);
  assert.deepEqual(await balance(id), { cantidad: 1, movimientos: 1 });
});

test('HTTP+SQL: entrada prohibida y petición sin token dejan auditoría sin modificar stock', async () => {
  const id = await product();
  const app = protectedApp();
  const denied = await request(app).post('/api/v1/inventario/entradas')
    .auth(await tokenFor(mechanic, 'Mecanico'), { type: 'bearer' })
    .set('Idempotency-Key', randomUUID()).send({ productoId: id, cantidad: 1, motivo: 'No permitido' }).expect(403);
  const unauthenticated = await request(app).post('/api/v1/inventario/salidas').send({ productoId: id }).expect(401);
  for (const [res, user, code] of [[denied, mechanic, 'ROLE_FORBIDDEN'], [unauthenticated, null, 'TOKEN_REQUIRED']] as const) {
    const result = await connection!.pool.request().input('id', connection!.driver.UniqueIdentifier, res.headers['x-request-id'])
      .query<{ resultado: string; usuario_id: number | null; codigo: string }>(
        'SELECT resultado, usuario_id, codigo FROM jm.auditoria WHERE request_id = @id;',
      );
    assert.equal(result.recordset[0]!.resultado, 'RECHAZADO');
    assert.equal(result.recordset[0]!.usuario_id, user);
    assert.equal(result.recordset[0]!.codigo, code);
  }
  assert.deepEqual(await balance(id), { cantidad: 3, movimientos: 0 });
});

test('HTTP+SQL: reintento devuelve 200, registra el reintento y no duplica el movimiento', async () => {
  const id = await product();
  const key = randomUUID();
  const app = protectedApp();
  const token = await tokenFor(mechanic, 'Mecanico');
  for (const status of [201, 200]) {
    const res = await request(app).post('/api/v1/inventario/salidas').auth(token, { type: 'bearer' })
      .set('Idempotency-Key', key).send({ productoId: id, cantidad: 2, motivo: 'Mismo movimiento' }).expect(status);
    assert.equal(res.body.repetido, status === 200);
  }
  assert.deepEqual(await balance(id), { cantidad: 1, movimientos: 1 });
  const audits = await connection!.pool.request().input('id', connection!.driver.Int, id)
    .query<{ accion: string }>(`SELECT a.accion FROM jm.auditoria a JOIN jm.movimiento m
      ON a.entidad_id = CONVERT(varchar(40), m.id) WHERE m.producto_id = @id
      AND a.accion IN ('INVENTARIO_SALIDA', 'MOVIMIENTO_REINTENTO') ORDER BY a.id;`);
  assert.deepEqual(audits.recordset.map((row) => row.accion), ['INVENTARIO_SALIDA', 'MOVIMIENTO_REINTENTO']);
});

test('HTTP+SQL: si falla la auditoría de éxito se revierte stock e historial', async () => {
  const id = await product();
  await connection!.pool.request().batch(`CREATE TRIGGER jm.tr_prueba_auditoria_fallo ON jm.auditoria AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted a JOIN jm.movimiento m ON a.entidad_id = CONVERT(varchar(40), m.id)
      WHERE a.codigo = 'MOVEMENT_CREATED' AND m.motivo = N'FORZAR_AUDITORIA')
      THROW 51998, 'Fallo simulado de auditoria.', 1; END;`);
  const res = await request(protectedApp()).post('/api/v1/inventario/salidas')
    .auth(await tokenFor(mechanic, 'Mecanico'), { type: 'bearer' }).set('Idempotency-Key', randomUUID())
    .send({ productoId: id, cantidad: 2, motivo: 'FORZAR_AUDITORIA' }).expect(500);
  assert.deepEqual(await balance(id), { cantidad: 3, movimientos: 0 });
  const result = await connection!.pool.request().input('id', connection!.driver.UniqueIdentifier, res.headers['x-request-id'])
    .query<{ accion: string; resultado: string }>('SELECT accion, resultado FROM jm.auditoria WHERE request_id = @id;');
  assert.deepEqual(result.recordset.map((row) => [row.accion, row.resultado]), [['HTTP_ERROR', 'ERROR']]);
});

test('SQL: auditoría rechaza UPDATE y DELETE ordinarios', async () => {
  for (const statement of ["UPDATE jm.auditoria SET codigo = 'ALTERADO' WHERE id = 1;", 'DELETE FROM jm.auditoria WHERE id = 1;']) {
    await assert.rejects(connection!.pool.request().query(statement));
  }
});

test('CLI+SQL: alta local y auditoría son atómicas; un duplicado no crea otro perfil', async () => {
  const id = randomUUID();
  const run = promisify(execFile);
  const env = {
    ...process.env, SQL_DRIVER: 'windows', SQL_SERVER: 'localhost', SQL_DATABASE: databaseName,
    SQL_TRUST_CERTIFICATE: 'true', ENTRA_TENANT_ID: tenantId,
    ENTRA_API_CLIENT_ID: apiId, ENTRA_ALLOWED_CLIENT_IDS: clientId,
  };
  const args = ['--import', 'tsx', 'src/cli/register-user.ts', id, 'MECANICO', 'Alta ficticia CLI'];
  const result = await run(process.execPath, args, { env });
  assert.match(result.stdout, /Perfil local creado/);
  await assert.rejects(run(process.execPath, args, { env }));
  const profiles = await connection!.pool.request().input('id', connection!.driver.UniqueIdentifier, id)
    .query<{ cantidad: number; registros: number }>(`SELECT COUNT(*) AS cantidad,
      (SELECT COUNT(*) FROM jm.auditoria a JOIN jm.usuario u ON a.entidad_id = CONVERT(varchar(40), u.id)
        WHERE u.entra_object_id = @id AND a.codigo = 'LOCAL_BOOTSTRAP_PROFILE_CREATED') AS registros
      FROM jm.usuario WHERE entra_object_id = @id;`);
  assert.deepEqual(profiles.recordset[0], { cantidad: 1, registros: 1 });

  await connection!.pool.request().batch(`CREATE TRIGGER jm.tr_prueba_bootstrap_fallo ON jm.auditoria AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted a JOIN jm.usuario u ON a.entidad_id = CONVERT(varchar(40), u.id)
      WHERE a.codigo = 'LOCAL_BOOTSTRAP_PROFILE_CREATED' AND u.nombres = N'FORZAR_BOOTSTRAP')
      THROW 51997, 'Fallo simulado de bootstrap auditado.', 1; END;`);
  const failedId = randomUUID();
  await assert.rejects(run(process.execPath,
    ['--import', 'tsx', 'src/cli/register-user.ts', failedId, 'MECANICO', 'FORZAR_BOOTSTRAP'], { env }));
  const failed = await connection!.pool.request().input('id', connection!.driver.UniqueIdentifier, failedId)
    .query<{ cantidad: number }>('SELECT COUNT(*) AS cantidad FROM jm.usuario WHERE entra_object_id = @id;');
  assert.equal(failed.recordset[0]!.cantidad, 0);
});

async function alertRows(productoId: number) {
  return (await connection!.pool.request().input('id', connection!.driver.Int, productoId)
    .query<{ id: number; estado: string; outboxEstado: string; payload: string }>(`SELECT CONVERT(int, a.id) AS id,
      a.estado, o.estado AS outboxEstado, o.payload FROM jm.alerta a
      JOIN jm.notificacion_outbox o ON o.alerta_id = a.id WHERE a.producto_id = @id ORDER BY a.id;`)).recordset;
}

test('Alertas+SQL: en el mínimo se crea alerta y Outbox; movimiento repetido no duplica el evento', async () => {
  const id = await product(3);
  const input = command(id, 1);
  await facade.registrarSalida(input, mechanic);
  const rows = await alertRows(id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.estado, 'PENDIENTE');
  assert.equal(rows[0]!.outboxEstado, 'PENDIENTE');
  const payload = JSON.parse(rows[0]!.payload);
  assert.equal(payload.stock, 2);
  assert.equal(payload.minimo, 2);
  assert.equal(payload.productoId, id);
  assert.equal(payload.alertaId, rows[0]!.id);
  await facade.registrarSalida(input, mechanic);
  await facade.registrarSalida(command(id, 1), mechanic);
  assert.equal((await alertRows(id)).length, 1);
  assert.deepEqual(await balance(id), { cantidad: 1, movimientos: 2 });
});

test('Alertas+SQL: dos salidas concurrentes bajo mínimo comparten un único ciclo abierto', async () => {
  const id = await product(4);
  await Promise.all([
    facade.registrarSalida(command(id, 2), mechanic), facade.registrarSalida(command(id, 1), mechanic),
  ]);
  assert.equal((await alertRows(id)).length, 1);
  assert.deepEqual(await balance(id), { cantidad: 1, movimientos: 2 });
});

test('Alertas+SQL: reposición parcial mantiene alerta; superar mínimo atiende, cancela tarea y permite otro ciclo', async () => {
  const id = await product(3);
  const original = command(id, 2);
  await facade.registrarSalida(original, mechanic); // 1
  await facade.registrarEntrada(command(id, 1), administrator); // 2: todavía bajo
  assert.equal((await alertRows(id))[0]!.estado, 'PENDIENTE');
  await facade.registrarEntrada(command(id, 1), administrator); // 3: atendida
  let rows = await alertRows(id);
  assert.equal(rows[0]!.estado, 'ATENDIDA');
  assert.equal(rows[0]!.outboxEstado, 'CANCELADA');
  await facade.registrarSalida(original, mechanic); // Replay antiguo no reabre
  assert.equal((await alertRows(id)).length, 1);
  await facade.registrarSalida(command(id, 1), mechanic); // 2: nuevo ciclo
  rows = await alertRows(id);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]!.estado, 'PENDIENTE');
  assert.equal(rows[1]!.outboxEstado, 'PENDIENTE');
  const audit = await connection!.pool.request().input('id', connection!.driver.Int, rows[0]!.id)
    .query<{ accion: string }>(`SELECT accion FROM jm.auditoria WHERE entidad_id = CONVERT(varchar(40), @id)
      AND accion IN ('ALERTA_CREADA', 'ALERTA_ATENDIDA') ORDER BY id;`);
  assert.deepEqual(audit.recordset.map((row) => row.accion), ['ALERTA_CREADA', 'ALERTA_ATENDIDA']);
});

test('Alertas+SQL: un movimiento que permanece por encima del mínimo no genera tareas', async () => {
  const id = await product(10);
  await facade.registrarSalida(command(id, 2), mechanic);
  assert.equal((await alertRows(id)).length, 0);
});

test('Alertas+SQL: si falla Outbox se revierten stock, movimiento, alerta y auditoría de éxito', async () => {
  const id = await product(3);
  await connection!.pool.request().batch(`CREATE TRIGGER jm.tr_prueba_outbox_fallo ON jm.notificacion_outbox AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted i WHERE JSON_VALUE(i.payload, '$.productoId') = '${id}')
      THROW 51996, 'Fallo simulado Outbox.', 1; END;`);
  await assert.rejects(facade.registrarSalida(command(id, 1), mechanic));
  assert.deepEqual(await balance(id), { cantidad: 3, movimientos: 0 });
  const rows = await connection!.pool.request().input('id', connection!.driver.Int, id)
    .query<{ cantidad: number }>('SELECT COUNT(*) AS cantidad FROM jm.alerta WHERE producto_id = @id;');
  assert.equal(rows.recordset[0]!.cantidad, 0);
});

test('Alertas+SQL: fallo al auditar la alerta revierte también Outbox y movimiento', async () => {
  const id = await product(3);
  await connection!.pool.request().batch(`CREATE TRIGGER jm.tr_prueba_alerta_auditoria_fallo ON jm.auditoria AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted i JOIN jm.alerta a ON i.entidad_id = CONVERT(varchar(40), a.id)
      WHERE i.accion = 'ALERTA_CREADA' AND a.producto_id = ${id})
      THROW 51995, 'Fallo simulado auditoria alerta.', 1; END;`);
  const requestId = randomUUID();
  await assert.rejects(facade.registrarSalida(command(id, 1), mechanic, requestId));
  assert.deepEqual(await balance(id), { cantidad: 3, movimientos: 0 });
  assert.equal((await alertRows(id)).length, 0);
  const audit = await connection!.pool.request().input('request', connection!.driver.UniqueIdentifier, requestId)
    .query<{ cantidad: number }>('SELECT COUNT(*) AS cantidad FROM jm.auditoria WHERE request_id = @request;');
  assert.equal(audit.recordset[0]!.cantidad, 0);
});

test('Alertas+SQL: índice único impide una segunda alerta abierta incluso desde SQL directo', async () => {
  const id = await product(3);
  await facade.registrarSalida(command(id, 1), mechanic);
  const second = await facade.registrarSalida(command(id, 1), mechanic);
  await assert.rejects(connection!.pool.request().input('product', connection!.driver.Int, id)
    .input('movement', connection!.driver.Int, second.movimiento.id)
    .query(`INSERT INTO jm.alerta(producto_id, movimiento_origen_id, stock_detectado, stock_minimo)
      VALUES (@product, @movement, 1, 2);`));
  assert.equal((await alertRows(id)).length, 1);
});

test('Alertas+SQL: tarea pendiente se conserva al abrir otra conexión sin volver a publicar el movimiento', async () => {
  const id = await product(3);
  await facade.registrarSalida(command(id, 1), mechanic);
  const another = await connectSql(parseSqlSettings({
    SQL_DRIVER: 'windows', SQL_SERVER: 'localhost', SQL_DATABASE: databaseName, SQL_TRUST_CERTIFICATE: 'true',
  }));
  try {
    const rows = await another.pool.request().input('id', another.driver.Int, id)
      .query<{ estado: string; stock: string }>(`SELECT o.estado, JSON_VALUE(o.payload, '$.stock') AS stock
        FROM jm.notificacion_outbox o JOIN jm.alerta a ON o.alerta_id = a.id WHERE a.producto_id = @id;`);
    assert.deepEqual(rows.recordset, [{ estado: 'PENDIENTE', stock: '2' }]);
  } finally { await another.pool.close(); }
});

test('Alertas+SQL: una reposición insuficiente también detecta un producto inicialmente bajo sin alerta', async () => {
  const id = await product(0);
  await facade.registrarEntrada(command(id, 1), administrator);
  const rows = await alertRows(id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.estado, 'PENDIENTE');
  assert.equal(JSON.parse(rows[0]!.payload).stock, 1);
});

test('Alertas+SQL: fallo al cancelar Outbox revierte reposición, atención y auditoría de éxito', async () => {
  const id = await product(3);
  await facade.registrarSalida(command(id, 2), mechanic);
  const alert = (await alertRows(id))[0]!;
  await connection!.pool.request().batch(`CREATE TRIGGER jm.tr_prueba_cancelacion_fallo ON jm.notificacion_outbox AFTER UPDATE AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted i WHERE i.alerta_id = ${alert.id} AND i.estado = 'CANCELADA')
      THROW 51994, 'Fallo simulado cancelacion.', 1; END;`);
  const requestId = randomUUID();
  await assert.rejects(facade.registrarEntrada(command(id, 3), administrator, requestId));
  assert.deepEqual(await balance(id), { cantidad: 1, movimientos: 1 });
  const rows = await alertRows(id);
  assert.equal(rows[0]!.estado, 'PENDIENTE');
  assert.equal(rows[0]!.outboxEstado, 'PENDIENTE');
  const audit = await connection!.pool.request().input('request', connection!.driver.UniqueIdentifier, requestId)
    .query<{ cantidad: number }>('SELECT COUNT(*) AS cantidad FROM jm.auditoria WHERE request_id = @request;');
  assert.equal(audit.recordset[0]!.cantidad, 0);
});
