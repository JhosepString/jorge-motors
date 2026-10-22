import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { calcularStock, MAX_STOCK } from '../src/modules/inventario/domain/stock.js';
import { InventarioFacade } from '../src/modules/inventario/application/inventario.facade.js';
import type { InventoryUnitOfWork } from '../src/modules/inventario/application/contracts.js';
import { SqlPoolSingleton, sqlConnectionConfig, type SqlConnection } from '../src/infrastructure/database/sql-pool.js';
import { parseSqlSettings } from '../src/infrastructure/database/sql-settings.js';
import { inventoryEvents } from '../src/infrastructure/inventory-events.js';

afterEach(async () => { await SqlPoolSingleton.getInstance().close(); });

test('el dominio calcula entradas, salidas y agotamiento exacto', () => {
  assert.equal(calcularStock(3, 2, 'SALIDA'), 1);
  assert.equal(calcularStock(3, 3, 'SALIDA'), 0);
  assert.equal(calcularStock(0, 7, 'ENTRADA'), 7);
});

test('el dominio rechaza faltantes, fracciones, cantidades negativas y desbordamiento', () => {
  assert.throws(() => calcularStock(1, 2, 'SALIDA'), { code: 'INSUFFICIENT_STOCK' });
  for (const quantity of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => calcularStock(3, quantity, 'SALIDA'), { code: 'INVALID_QUANTITY' });
  }
  assert.throws(() => calcularStock(MAX_STOCK, 1, 'ENTRADA'), { code: 'STOCK_LIMIT_EXCEEDED' });
});

test('Facade rechaza datos inválidos antes de acceder al repositorio', async () => {
  let calls = 0;
  const uow: InventoryUnitOfWork = { ejecutar: async () => { calls++; throw new Error('No debe ejecutarse.'); } };
  const facade = new InventarioFacade(uow, inventoryEvents());
  await assert.rejects(facade.registrarSalida({
    productoId: 1, cantidad: 0, motivo: 'Prueba', claveIdempotencia: randomUUID(),
  }, 1), { code: 'INVALID_INPUT' });
  assert.equal(calls, 0);
});

test('Singleton comparte instancia y promesa de conexión entre llamadas concurrentes', async () => {
  const first = SqlPoolSingleton.getInstance();
  assert.equal(first, SqlPoolSingleton.getInstance());
  let connections = 0;
  let closed = 0;
  const fake = { pool: { close: async () => { closed++; } } } as unknown as SqlConnection;
  const connector = async () => { connections++; return fake; };
  const settings = parseSqlSettings({});
  const a = first.getConnection(settings, connector);
  const b = first.getConnection(settings, connector);
  assert.equal(a, b);
  assert.equal(await a, fake);
  assert.equal(connections, 1);
  await first.close();
  assert.equal(closed, 1);
});

test('Singleton permite reintentar una conexión fallida', async () => {
  const singleton = SqlPoolSingleton.getInstance();
  const settings = parseSqlSettings({});
  await assert.rejects(singleton.getConnection(settings, async () => { throw new Error('Sin conexión'); }));
  const fake = { pool: { close: async () => undefined } } as unknown as SqlConnection;
  assert.equal(await singleton.getConnection(settings, async () => fake), fake);
});

test('no se permite desactivar validación de certificados para un servidor remoto', () => {
  assert.throws(() => parseSqlSettings({ SQL_SERVER: 'remoto.database.windows.net', SQL_TRUST_CERTIFICATE: 'true' }));
});

test('Azure SQL usa Entra sin usuario ni contraseña y con TLS verificado', () => {
  const base = { SQL_DRIVER: 'entra', SQL_SERVER: 'jorge-demo.database.windows.net', SQL_DATABASE: 'jorge_motors' };
  const system = sqlConnectionConfig(parseSqlSettings(base));
  assert.deepEqual(system.authentication, { type: 'azure-active-directory-default', options: {} });
  assert.equal(system.port, 1433);
  assert.equal(system.options?.encrypt, true);
  assert.equal(system.options?.trustServerCertificate, false);
  assert.equal(system.user, undefined);
  assert.equal(system.password, undefined);

  const clientId = randomUUID();
  const assigned = sqlConnectionConfig(parseSqlSettings({ ...base, SQL_ENTRA_CLIENT_ID: clientId }));
  assert.deepEqual(assigned.authentication, {
    type: 'azure-active-directory-default', options: { clientId },
  });
});

test('Azure SQL rechaza servidor ajeno, credenciales SQL y certificado no validado', () => {
  const base = { SQL_DRIVER: 'entra', SQL_SERVER: 'jorge-demo.database.windows.net', SQL_DATABASE: 'jorge_motors' };
  assert.throws(() => parseSqlSettings({ ...base, SQL_SERVER: 'localhost' }));
  assert.throws(() => parseSqlSettings({ ...base, SQL_USER: 'sa', SQL_PASSWORD: 'demo' }));
  assert.throws(() => parseSqlSettings({ ...base, SQL_TRUST_CERTIFICATE: 'true' }));
  assert.throws(() => parseSqlSettings({ ...base, SQL_ENTRA_CLIENT_ID: 'no-es-uuid' }));
});
