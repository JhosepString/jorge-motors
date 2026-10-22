import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, beforeEach, after, test } from 'node:test';
import { connectSql, type SqlConnection } from '../../src/infrastructure/database/sql-pool.js';
import { parseSqlSettings } from '../../src/infrastructure/database/sql-settings.js';
import { migrateInventory } from '../../src/infrastructure/database/migrate.js';
import { SqlInventoryUnitOfWork } from '../../src/infrastructure/database/sql-inventory.js';
import { SqlNotificationDispatch, OUTBOX_UTC_NOW_SQL } from '../../src/infrastructure/database/sql-notification-dispatch.js';
import { InventarioFacade } from '../../src/modules/inventario/application/inventario.facade.js';
import { inventoryEvents } from '../../src/infrastructure/inventory-events.js';
import { NotificationWorker, NotificationFailure, type NotificationTransport } from '../../src/modules/alertas/application/notification-worker.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Simulador SOLO en tests: nunca se importa desde src ni lee .env.
// La aceptación ficticia modifica exclusivamente esta base efímera, no jorge_motors_dev.
const databaseName = `jm_test_${randomUUID().replaceAll('-', '')}`;
let admin: SqlConnection | undefined;
let connection: SqlConnection;
let created = false;
let facade: InventarioFacade;
let repository: SqlNotificationDispatch;
let userId: number;
const localSettings = (database: string) => parseSqlSettings({
  SQL_DRIVER: 'windows', SQL_SERVER: 'localhost', SQL_DATABASE: database, SQL_TRUST_CERTIFICATE: 'true',
});
before(async () => {
  assert.match(databaseName, /^jm_test_[a-f0-9]{32}$/);
  admin = await connectSql(localSettings('master'));
  await admin.pool.request().query(`CREATE DATABASE [${databaseName}];`);
  created = true;
  // Probar también el aislamiento habitual de Azure SQL, sin tocar la base real.
  await admin.pool.request().query(`ALTER DATABASE [${databaseName}] SET READ_COMMITTED_SNAPSHOT ON;`);
  connection = await connectSql(localSettings(databaseName));
  await migrateInventory(connection);
  facade = new InventarioFacade(new SqlInventoryUnitOfWork(connection), inventoryEvents());
  repository = new SqlNotificationDispatch(connection);
  const seeded = await connection.pool.request().query<{ id: number }>(`INSERT INTO jm.usuario
    (entra_tenant_id, entra_object_id, nombres, rol) VALUES (NEWID(),NEWID(),N'Usuario ficticio worker','ADMINISTRADOR');
    SELECT CONVERT(int,SCOPE_IDENTITY()) AS id;
    INSERT INTO jm.categoria(nombre) VALUES (N'Demo worker');`);
  userId = seeded.recordset[0]!.id;
  console.info('SIMULACIÓN AISLADA: no se contacta correo ni Azure y no se modifica la base de demostración.');
});
beforeEach(async () => {
  // Preparación entre casos únicamente sobre la base aleatoria de ESTE archivo.
  await connection.pool.request().query(`UPDATE jm.notificacion_outbox SET estado='CANCELADA',
    lease_token=NULL, lease_hasta=NULL WHERE estado<>'ENVIADA';`);
});
after(async () => {
  await connection?.pool.close();
  if (created && admin && /^jm_test_[a-f0-9]{32}$/.test(databaseName)) {
    await admin.pool.request().query(`ALTER DATABASE [${databaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
      DROP DATABASE [${databaseName}];`);
    console.info('Simulación finalizada; base efímera eliminada. Ningún correo fue enviado.');
  }
  await admin?.pool.close();
});

async function pending() {
  const result = await connection.pool.request().input('sku', connection.driver.VarChar(40), randomUUID())
    .query<{ id: number }>(`INSERT INTO jm.producto(sku,nombre,categoria_id,stock_minimo)
      VALUES (@sku,N'Producto ficticio worker',(SELECT MIN(id) FROM jm.categoria),2);
      DECLARE @id int=CONVERT(int,SCOPE_IDENTITY());
      INSERT INTO jm.stock(producto_id,cantidad_actual) VALUES (@id,3); SELECT @id AS id;`);
  const productId = result.recordset[0]!.id;
  await facade.registrarSalida({ productoId: productId, cantidad: 1, motivo: 'Prueba aislada worker', claveIdempotencia: randomUUID() }, userId);
  return productId;
}
async function state(productId: number) {
  return (await connection.pool.request().input('id', connection.driver.Int, productId)
    .query<{ id: string; alertaId: number; alerta: string; envio: string; intentos: number;
      lease: string | null; aceptada: Date | null; error: string | null; cantidad: number }>(`SELECT
      CONVERT(varchar(36),o.id) AS id, a.id AS alertaId, a.estado AS alerta, o.estado AS envio,
      o.intentos, CONVERT(varchar(36),o.lease_token) AS lease, o.aceptada_en AS aceptada,
      o.ultimo_error AS error, s.cantidad_actual AS cantidad FROM jm.alerta a
      JOIN jm.notificacion_outbox o ON o.alerta_id=a.id JOIN jm.stock s ON s.producto_id=a.producto_id
      WHERE a.producto_id=@id;`)).recordset[0]!;
}
async function available(id: string) {
  await connection.pool.request().input('id', connection.driver.UniqueIdentifier, id)
    .query('UPDATE jm.notificacion_outbox SET disponible_en=DATEADD(SECOND,-1,SYSUTCDATETIME()) WHERE id=@id;');
}
async function expire(id: string) {
  await connection.pool.request().input('id', connection.driver.UniqueIdentifier, id)
    .query('UPDATE jm.notificacion_outbox SET lease_hasta=DATEADD(SECOND,-1,SYSUTCDATETIME()) WHERE id=@id;');
}
async function replenish(productoId: number) {
  return facade.registrarEntrada({ productoId, cantidad: 2, motivo: 'Reposición ficticia worker', claveIdempotencia: randomUUID() }, userId);
}
function fakeTransport() {
  const calls: string[] = [];
  const transport: NotificationTransport = { enviar: async (message) => {
    calls.push(message.idempotencyKey); return { providerId: `FICTICIO-${message.idempotencyKey}` };
  } };
  return { transport, calls };
}

test('Worker SQL: dos reclamaciones concurrentes no toman la misma tarea', async () => {
  const id = await pending();
  const tasks = await Promise.all([repository.reclamar(), repository.reclamar()]);
  assert.equal(tasks.filter(Boolean).length, 1);
  assert.equal((await state(id)).intentos, 1);
  assert.equal((await state(id)).envio, 'PROCESANDO');
});

test('Worker SQL: aceptación simulada confirma Outbox y State ENVIADA de forma atómica', async () => {
  const id = await pending(); const fake = fakeTransport();
  const worker = new NotificationWorker(repository, fake.transport);
  assert.equal(await worker.procesarUna(), 'ACEPTADA');
  assert.equal(await worker.procesarUna(), 'VACIA');
  const row = await state(id);
  assert.equal(row.envio, 'ENVIADA'); assert.equal(row.alerta, 'ENVIADA');
  assert.ok(row.aceptada); assert.equal(row.lease, null); assert.equal(fake.calls.length, 1);
  const audit = await connection.pool.request().input('task', connection.driver.VarChar(40), row.id)
    .query<{ usuario_id: number | null; accion: string }>(`SELECT usuario_id,accion FROM jm.auditoria
      WHERE LOWER(entidad_id)=LOWER(@task) AND accion='NOTIFICACION_ACEPTADA';`);
  assert.equal(audit.recordset.length, 1); assert.equal(audit.recordset[0]!.usuario_id, null);
  await replenish(id);
  assert.equal((await state(id)).alerta, 'ATENDIDA');
  assert.equal((await state(id)).envio, 'ENVIADA'); // Un aviso aceptado no se puede des-enviar.
});

test('Worker SQL: fallo temporal agenda reintento futuro y conserva clave estable', async () => {
  const id = await pending(); const fake = fakeTransport();
  const failing: NotificationTransport = { enviar: async (message) => {
    fake.calls.push(message.idempotencyKey); throw new NotificationFailure('TEMPORARY_FAILURE');
  } };
  assert.equal(await new NotificationWorker(repository, failing).procesarUna(), 'REINTENTO');
  assert.equal((await state(id)).envio, 'PENDIENTE');
  assert.equal(await repository.reclamar(), undefined); // No dormir: el reloj SQL impide el envío temprano.
  await available((await state(id)).id);
  assert.equal(await new NotificationWorker(repository, fake.transport).procesarUna(), 'ACEPTADA');
  assert.equal((await state(id)).intentos, 2);
  assert.equal(new Set(fake.calls).size, 1);
});

test('Worker SQL: fallo permanente queda AGOTADA sin afirmar envío ni cerrar alerta', async () => {
  const id = await pending();
  const transport: NotificationTransport = { enviar: async () => { throw new NotificationFailure('PERMANENT_FAILURE'); } };
  assert.equal(await new NotificationWorker(repository, transport).procesarUna(), 'AGOTADA');
  const row = await state(id);
  assert.equal(row.envio, 'AGOTADA'); assert.equal(row.alerta, 'PENDIENTE');
  assert.equal(row.intentos, 1); assert.equal(row.aceptada, null);
  assert.equal(await repository.reclamar(), undefined);
});

test('Worker SQL: cinco fallos agotan el presupuesto sin sexto envío', async () => {
  const id = await pending(); let calls = 0;
  const transport: NotificationTransport = { enviar: async () => { calls++; throw new NotificationFailure('TEMPORARY_FAILURE'); } };
  const worker = new NotificationWorker(repository, transport);
  for (let attempt = 1; attempt <= 5; attempt++) {
    assert.equal(await worker.procesarUna(), attempt < 5 ? 'REINTENTO' : 'AGOTADA');
    if (attempt < 5) await available((await state(id)).id);
  }
  assert.equal(await worker.procesarUna(), 'VACIA');
  assert.equal(calls, 5); assert.equal((await state(id)).intentos, 5);
});

test('Worker SQL: otra conexión recupera lease vencido e invalida al dueño anterior', async () => {
  const id = await pending(); const old = (await repository.reclamar())!;
  await expire(old.id);
  assert.equal(await repository.vigente(old), false);
  assert.equal(await repository.aceptar(old, 'FICTICIO-VENCIDO'), false);
  assert.equal(await repository.fallar(old, 'TEMPORARY_FAILURE', 60), false);
  const nextConnection = await connectSql(localSettings(databaseName));
  try {
    const fake = fakeTransport();
    assert.equal(await new NotificationWorker(new SqlNotificationDispatch(nextConnection), fake.transport).procesarUna(), 'ACEPTADA');
    assert.equal((await state(id)).intentos, 2);
    assert.equal(await repository.vigente(old), false);
    assert.equal(await repository.aceptar(old, 'FICTICIO-ANTERIOR'), false);
    assert.equal(await repository.fallar(old, 'TEMPORARY_FAILURE', 60), false);
    assert.equal(fake.calls[0], old.id);
  } finally { await nextConnection.pool.close(); }
});

test('Worker SQL: caída en el quinto intento no deja tarea PROCESANDO para siempre', async () => {
  const id = await pending();
  for (let attempt = 1; attempt <= 5; attempt++) {
    const claimed = (await repository.reclamar())!;
    assert.equal(claimed.intento, attempt); await expire(claimed.id);
  }
  assert.equal(await repository.reclamar(), undefined);
  assert.equal((await state(id)).envio, 'AGOTADA');
  assert.equal((await state(id)).error, 'LEASE_EXPIRED_LIMIT');
});

test('Worker SQL: reposición previa cancela tarea pendiente y evita llamar al transporte', async () => {
  const id = await pending(); await replenish(id); const fake = fakeTransport();
  assert.equal(await new NotificationWorker(repository, fake.transport).procesarUna(), 'VACIA');
  assert.equal(fake.calls.length, 0); assert.equal((await state(id)).envio, 'CANCELADA');
});

test('Worker SQL: reposición invalida una tarea ya reclamada antes de enviar', async () => {
  const id = await pending(); const task = (await repository.reclamar())!;
  await replenish(id); const fake = fakeTransport();
  const staleRepository = { reclamar: async () => task, vigente: repository.vigente.bind(repository),
    aceptar: repository.aceptar.bind(repository), fallar: repository.fallar.bind(repository) };
  assert.equal(await new NotificationWorker(staleRepository, fake.transport).procesarUna(), 'OBSOLETA');
  assert.equal(fake.calls.length, 0); assert.equal((await state(id)).envio, 'CANCELADA');
  assert.equal((await state(id)).lease, null);
});

test('Worker SQL: una reposición durante el transporte no se sobrescribe al confirmar', async () => {
  const id = await pending();
  const transport: NotificationTransport = { enviar: async () => {
    await replenish(id); return { providerId: 'FICTICIO-ACEPTADO-DURANTE-REPOSICION' };
  } };
  assert.equal(await new NotificationWorker(repository, transport).procesarUna(), 'ACEPTACION_NO_CONFIRMADA');
  const row = await state(id);
  assert.equal(row.alerta, 'ATENDIDA'); assert.equal(row.envio, 'CANCELADA'); assert.equal(row.cantidad, 4);
});

test('Worker SQL: si falla auditoría de aceptación se revierte confirmación, no el envío externo', async () => {
  const id = await pending(); const row = await state(id); const fake = fakeTransport();
  await connection.pool.request().batch(`CREATE TRIGGER jm.tr_worker_auditoria_fallo ON jm.auditoria AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE accion='NOTIFICACION_ACEPTADA'
      AND LOWER(entidad_id)=LOWER('${row.id}')) THROW 51990, 'Fallo simulado confirmacion.', 1; END;`);
  await assert.rejects(new NotificationWorker(repository, fake.transport).procesarUna());
  const after = await state(id);
  assert.equal(fake.calls.length, 1); assert.equal(after.envio, 'PROCESANDO');
  assert.equal(after.alerta, 'PENDIENTE'); assert.equal(after.aceptada, null);
});

test('Worker SQL: payload incompatible se agota sin transporte', async () => {
  const id = await pending(); const row = await state(id); const fake = fakeTransport();
  await connection.pool.request().input('id', connection.driver.UniqueIdentifier, row.id)
    .query("UPDATE jm.notificacion_outbox SET payload=N'{}' WHERE id=@id;");
  assert.equal(await new NotificationWorker(repository, fake.transport).procesarUna(), 'AGOTADA');
  assert.equal(fake.calls.length, 0); assert.equal((await state(id)).error, 'INVALID_PAYLOAD');
});

test('Worker SQL: reposición y confirmación concurrentes no pierden el estado ATENDIDA', async () => {
  const id = await pending(); const task = (await repository.reclamar())!;
  await Promise.all([repository.aceptar(task, 'FICTICIO-CONCURRENTE'), replenish(id)]);
  const row = await state(id);
  assert.equal(row.alerta, 'ATENDIDA'); assert.equal(row.cantidad, 4);
  assert.ok(['ENVIADA', 'CANCELADA'].includes(row.envio));
});

test('Worker SQL: recupera la reserva de un proceso hijo que terminó antes del envío', async () => {
  const id = await pending();
  const result = await promisify(execFile)(process.execPath,
    ['--import', 'tsx', 'tests/helpers/claim-outbox-and-stop.ts', databaseName]);
  const abandoned = JSON.parse(result.stdout.trim()) as { id: string };
  assert.equal((await state(id)).envio, 'PROCESANDO');
  await expire(abandoned.id); // Adelantar vencimiento solo en la base efímera, sin esperar dos minutos.
  const fake = fakeTransport();
  assert.equal(await new NotificationWorker(repository, fake.transport).procesarUna(), 'ACEPTADA');
  assert.equal((await state(id)).intentos, 2); assert.equal(fake.calls.length, 1);
});

test('Worker SQL: timeout deja reintento durable sin aceptación ficticia', async () => {
  const id = await pending();
  const transport: NotificationTransport = { enviar: async () => new Promise(() => {}) };
  assert.equal(await new NotificationWorker(repository, transport, 5).procesarUna(), 'REINTENTO');
  const row = await state(id);
  assert.equal(row.envio, 'PENDIENTE'); assert.equal(row.error, 'TRANSPORT_TIMEOUT'); assert.equal(row.aceptada, null);
});

test('Worker SQL: fallo al auditar reintento revierte la reprogramación y mantiene reserva recuperable', async () => {
  const id = await pending(); const row = await state(id);
  await connection.pool.request().batch(`CREATE TRIGGER jm.tr_worker_reintento_fallo ON jm.auditoria AFTER INSERT AS
    BEGIN IF EXISTS (SELECT 1 FROM inserted WHERE accion='NOTIFICACION_REINTENTO'
      AND LOWER(entidad_id)=LOWER('${row.id}')) THROW 51989, 'Fallo simulado reintento.', 1; END;`);
  const transport: NotificationTransport = { enviar: async () => { throw new NotificationFailure('TEMPORARY_FAILURE'); } };
  await assert.rejects(new NotificationWorker(repository, transport).procesarUna());
  assert.equal((await state(id)).envio, 'PROCESANDO');
  assert.equal((await state(id)).error, null);
});

test('Worker SQL: reloj y disponibilidad usan la misma precisión sin adelantar tareas futuras', async () => {
  // Sustituir SOLO el origen de reloj en el fragmento fijo de producción permite
  // reproducir el tick exacto sin depender del reloj real ni dormir en la prueba.
  const clock = OUTBOX_UTC_NOW_SQL.replace('SYSUTCDATETIME()', '@rawNow');
  for (const instant of ['2026-10-21T20:00:00.1236000', '2026-10-21T20:00:00.9996000']) {
    const result = await connection.pool.request().input('instant', connection.driver.VarChar(30), instant)
      .query<{ sin_normalizar: number; disponible: number; futura: number; vencida: number; vigente: number }>(`
        DECLARE @rawNow datetime2(7)=CONVERT(datetime2(7),@instant,126);
        DECLARE @due datetime2(3)=@rawNow;
        SELECT CASE WHEN @due<=@rawNow THEN 1 ELSE 0 END AS sin_normalizar,
          CASE WHEN @due<=${clock} THEN 1 ELSE 0 END AS disponible,
          CASE WHEN DATEADD(MILLISECOND,1,@due)<=${clock} THEN 1 ELSE 0 END AS futura,
          CASE WHEN @due<=${clock} THEN 1 ELSE 0 END AS vencida,
          CASE WHEN @due>${clock} THEN 1 ELSE 0 END AS vigente;`);
    assert.deepEqual(result.recordset[0], { sin_normalizar: 0, disponible: 1, futura: 0, vencida: 1, vigente: 0 });
  }
});

test('Worker SQL: 100 altas y reclamaciones inmediatas no producen falsos VACIA', async () => {
  for (let i = 0; i < 100; i++) {
    const productId = await pending();
    const task = await repository.reclamar();
    assert.ok(task, `Reclamación inmediata ${i + 1}: no debe devolver VACIA`);
    const row = await state(productId);
    assert.equal(task.id, row.id.toLowerCase());
    assert.equal(row.intentos, 1);
  }
});
