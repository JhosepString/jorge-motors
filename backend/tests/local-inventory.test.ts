import assert from 'node:assert/strict';
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
    const input = { productId: 1, userId: 1, type: 'SALIDA' as const, quantity: 2,
      reason: 'Reparación', idempotencyKey: '8f464e16-bda2-4f41-9f9e-e8dbfb34fc71' };
    const first = store.registerMovement(input);
    assert.equal(first.status, 'PENDING');
    assert.equal(store.registerMovement(input).id, first.id);
    assert.equal(store.pendingOperations(1).length, 1);
    assert.equal((store.db.prepare('SELECT offline_quota FROM product WHERE id=1').get() as { offline_quota: number }).offline_quota, 0);
    assert.throws(() => store.cacheProduct({ id: 1, categoryId: 1, sku: 'F-1', name: 'Filtro', active: true,
      stockMinimum: 0, confirmedStock: 10, offlineQuota: 2 }), /pending/);
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
    assert.throws(() => store.registerMovement({ productId: 1, userId: 1, type: 'SALIDA', quantity: 1,
      reason: 'Prueba', idempotencyKey: '8f464e16-bda2-4f41-9f9e-e8dbfb34fc72' }), { code: 'TOOL_LOAN_REQUIRED' });
    assert.equal(store.pendingOperations(1).length, 0);
    assert.equal((store.db.prepare('SELECT offline_quota FROM product WHERE id=1').get() as { offline_quota: number }).offline_quota, 2);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
