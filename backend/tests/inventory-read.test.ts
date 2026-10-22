import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { InventoryReadFacade, stockQuerySchema, movementQuerySchema, type ReadUnitOfWork } from '../src/modules/inventario/application/inventory-read.js';
import type { UsuarioInventario } from '../src/modules/inventario/application/contracts.js';
test('Lecturas: filtros acotados y sin usuario/precio/campos arbitrarios', () => {
  assert.equal(stockQuerySchema.parse({}).limite, 25);
  for (const input of [{ usuarioId: 1 }, { precioCompra: true }, { limite: 101 }, { buscar: 'x'.repeat(101) }, { estado: 'INACTIVO' }]) assert.equal(stockQuerySchema.safeParse(input).success, false);
  assert.equal(movementQuerySchema.safeParse({ usuarioId: 1 }).success, false);
});
test('Lecturas: Mecánico se limita por identidad, Administrador no; el perfil se revalida', async () => {
  let role: UsuarioInventario['rol'] = 'MECANICO'; let active = true; const scopes: (number | null)[] = [];
  const uow: ReadUnitOfWork = { async ejecutar(operation) { return operation({
    usuarios: { obtener: async () => ({ id: 7, rol: role, activo: active, entraTenantId: randomUUID(), entraObjectId: randomUUID() }) },
    auditoria: { registrar: async () => {} }, stock: async () => [], categorias: async () => [],
    movimientos: async (_f, own) => { scopes.push(own); return []; },
  }); } };
  const facade = new InventoryReadFacade(uow);
  await facade.movimientos({}, 7, randomUUID()); role = 'ADMINISTRADOR'; await facade.movimientos({}, 7, randomUUID());
  assert.deepEqual(scopes, [7, null]); active = false;
  await assert.rejects(facade.stock({}, 7, randomUUID()), { code: 'READ_FORBIDDEN' });
});
test('Lecturas: entrada inválida no toca SQL y auditoría fallida no devuelve éxito', async () => {
  const uow: ReadUnitOfWork = { ejecutar: async () => { throw new Error('No SQL'); } };
  await assert.rejects(new InventoryReadFacade(uow).stock({ buscar: [] }, 1, randomUUID()), { code: 'INVALID_READ_INPUT' });
  const audited: ReadUnitOfWork = { ejecutar: async (operation) => operation({ usuarios: { obtener: async () => ({ id: 1, rol: 'MECANICO', activo: true, entraTenantId: randomUUID(), entraObjectId: randomUUID() }) },
    auditoria: { registrar: async () => { throw new Error('Auditoría fallida'); } }, stock: async () => [], categorias: async () => [], movimientos: async () => [] }) };
  await assert.rejects(new InventoryReadFacade(audited).stock({}, 1, randomUUID()), /Auditoría fallida/);
});
