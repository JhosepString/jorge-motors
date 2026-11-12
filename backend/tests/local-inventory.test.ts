import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LocalInventoryStore } from '../src/infrastructure/local/local-inventory.js';

test('offline quota, idempotency, persistence and atomic pending operation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jm-local-'));
  const path = join(dir, 'data.sqlite');
  try {
    let store = new LocalInventoryStore(path, '4cb09edb-0ce8-4dcc-a33d-d96273cdca9e');
    store.cacheUser({ id: 1, tenantId: 'tenant', objectId: 'object', name: 'Admin', role: 'ADMINISTRADOR', active: true });
    store.cacheCategory(1, 'Filtros');
    store.cacheProduct({ id: 1, categoryId: 1, sku: 'F-1', name: 'Filtro', active: true, stockMinimum: 0, confirmedStock: 10, offlineQuota: 2 });
    store.cacheUserProductQuota(1, 1, 2);
    const input = { productId: 1, userId: 1, type: 'SALIDA' as const, quantity: 2,
      reason: 'Reparación', idempotencyKey: '8f464e16-bda2-4f41-9f9e-e8dbfb34fc71' };
    const first = store.registerMovement(input);
    assert.equal(first.status, 'PENDING');
    assert.equal(store.registerMovement(input).id, first.id);
    assert.equal(store.pendingOperations(1).length, 1);
    assert.equal((store.db.prepare('SELECT remaining FROM user_product_quota WHERE user_id=1 AND product_id=1').get() as { remaining: number }).remaining, 0);
    store.cacheProduct({ id: 1, categoryId: 1, sku: 'F-1', name: 'Filtro', active: true,
      stockMinimum: 0, confirmedStock: 10, offlineQuota: 2 });
    assert.equal((store.db.prepare('SELECT remaining FROM user_product_quota WHERE user_id=1 AND product_id=1').get() as { remaining: number }).remaining, 0);
    assert.throws(() => store.registerMovement({ ...input, quantity: 1 }), { code: 'IDEMPOTENCY_CONFLICT' });
    assert.throws(() => store.registerMovement({ ...input, idempotencyKey: 'ac108d72-98b2-4991-b6d1-15304c3ee759' }), { code: 'INSUFFICIENT_STOCK' });
    assert.equal(store.pendingOperations(1).length, 1);
    assert.throws(() => store.db.exec(`DELETE FROM local_movement WHERE id='${first.id}'`));
    store.close();
    store = new LocalInventoryStore(path, '4cb09edb-0ce8-4dcc-a33d-d96273cdca9e');
    assert.equal(store.pendingOperations(1)[0]?.operationId, first.id);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('seeded tools cannot be consumed as an offline stock exit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jm-tool-'));
  const store = new LocalInventoryStore(join(dir, 'data.sqlite'), '4cb09edb-0ce8-4dcc-a33d-d96273cdca9e');
  try {
    store.cacheUser({ id: 1, tenantId: 'tenant', objectId: 'object', name: 'Admin', role: 'ADMINISTRADOR', active: true });
    store.cacheCategory(1, 'Herramientas');
    store.cacheProduct({ id: 1, categoryId: 1, sku: 'SIM-HMA-002', name: 'Llave', active: true,
      stockMinimum: 0, confirmedStock: 10, offlineQuota: 2 });
    store.cacheUserProductQuota(1, 1, 2);
    assert.throws(() => store.registerMovement({ productId: 1, userId: 1, type: 'SALIDA', quantity: 1,
      reason: 'Prueba', idempotencyKey: '8f464e16-bda2-4f41-9f9e-e8dbfb34fc72' }), { code: 'TOOL_LOAN_REQUIRED' });
    assert.equal(store.pendingOperations(1).length, 0);
    assert.equal((store.db.prepare('SELECT remaining FROM user_product_quota WHERE user_id=1 AND product_id=1').get() as { remaining: number }).remaining, 2);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('each mechanic has a 20-unit pending limit per product; administrators have no personal limit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jm-mechanic-limit-'));
  const store = new LocalInventoryStore(join(dir, 'data.sqlite'), '4cb09edb-0ce8-4dcc-a33d-d96273cdca9e');
  try {
    store.cacheUser({ id: 1, tenantId: 'tenant', objectId: 'admin', name: 'Admin', role: 'ADMINISTRADOR', active: true });
    store.cacheUser({ id: 2, tenantId: 'tenant', objectId: 'mechanic', name: 'Mecánico', role: 'MECANICO', active: true });
    store.cacheCategory(1, 'Repuestos');
    for (const id of [1, 2]) {
      store.cacheProduct({ id, categoryId: 1, sku: `P-${id}`, name: `Pieza ${id}`,
        active: true, stockMinimum: 0, confirmedStock: 100, offlineQuota: 100 });
      store.cacheUserProductQuota(1, id, 100);
      store.cacheUserProductQuota(2, id, 100);
    }
    const move = (userId: number, productId: number, quantity: number) => store.registerMovement({
      userId, productId, type: 'SALIDA', quantity, reason: 'Trabajo de prueba', idempotencyKey: randomUUID(),
    });
    const first = move(2, 1, 12);
    const second = move(2, 1, 8);
    assert.throws(() => move(2, 1, 1), { code: 'OFFLINE_MECHANIC_LIMIT' });
    assert.equal(move(2, 2, 20).status, 'PENDING');
    assert.equal(move(1, 1, 25).status, 'PENDING');
    store.confirmOperation(first.id, 101);
    store.rejectOperation(second.id, 'STOCK_CONFLICT');
    assert.equal(move(2, 1, 12).status, 'PENDING');
    assert.throws(() => move(2, 1, 1), { code: 'OFFLINE_MECHANIC_LIMIT' });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two mechanics on one PC spend only their own offline quota', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jm-user-quota-'));
  const store = new LocalInventoryStore(join(dir, 'data.sqlite'), '4cb09edb-0ce8-4dcc-a33d-d96273cdca9e');
  try {
    for (const id of [2, 3]) store.cacheUser({ id, tenantId: 'tenant', objectId: `mechanic-${id}`,
      name: `Mecánico ${id}`, role: 'MECANICO', active: true });
    store.cacheCategory(1, 'Repuestos');
    store.cacheProduct({ id: 1, categoryId: 1, sku: 'P-1', name: 'Pieza', active: true,
      stockMinimum: 0, confirmedStock: 10, offlineQuota: 10 });
    store.cacheUserProductQuota(2, 1, 2);
    store.cacheUserProductQuota(3, 1, 3);
    store.registerMovement({ userId: 2, productId: 1, type: 'SALIDA', quantity: 2,
      reason: 'Trabajo', idempotencyKey: randomUUID() });
    assert.throws(() => store.registerMovement({ userId: 2, productId: 1, type: 'SALIDA', quantity: 1,
      reason: 'Trabajo', idempotencyKey: randomUUID() }), { code: 'INSUFFICIENT_STOCK' });
    assert.equal(store.registerMovement({ userId: 3, productId: 1, type: 'SALIDA', quantity: 3,
      reason: 'Trabajo', idempotencyKey: randomUUID() }).status, 'PENDING');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
