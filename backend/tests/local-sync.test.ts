import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LocalInventoryStore } from '../src/infrastructure/local/local-inventory.js';
import { LocalSyncClient } from '../src/infrastructure/local/sync-client.js';

test('ambiguous network failure retries same operation; receipt persists atomically', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jm-sync-'));
  const path = join(dir, 'local.sqlite');
  try {
    let store = new LocalInventoryStore(path, '4cb09edb-0ce8-4dcc-a33d-d96273cdca9e');
    store.cacheUser({ id: 1, tenantId: 'tenant', objectId: 'object', name: 'Ana', role: 'MECANICO', active: true });
    store.cacheCategory(1, 'Filtros');
    store.cacheProduct({ id: 1, categoryId: 1, sku: 'F-1', name: 'Filtro', active: true,
      stockMinimum: 0, confirmedStock: 5, offlineQuota: 2 });
    store.cacheUserProductQuota(1, 1, 2);
    const movement = store.registerMovement({ productId: 1, userId: 1, type: 'SALIDA', quantity: 1,
      reason: 'Taller', idempotencyKey: '8f464e16-bda2-4f41-9f9e-e8dbfb34fc71' });
    let calls = 0; const sentIds: string[] = [];
    const transport = async (_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init?.body)); sentIds.push(body.operationId);
      assert.equal(init?.headers && (init.headers as Record<string,string>).Authorization, 'Bearer access-token');
      if (calls === 1) throw new Error('Connection dropped after cloud commit');
      return new Response(JSON.stringify({ data: { operationId: body.operationId, status: 'CONFIRMED', remoteId: 42 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    let sync = new LocalSyncClient(store, 'https://example.azurewebsites.net/api/v1', async () => 'access-token', transport as typeof fetch);
    assert.deepEqual(await sync.runOnce(1), { confirmed: 0, rejected: 0, remaining: 1, stopped: true });
    store.close();
    store = new LocalInventoryStore(path, '4cb09edb-0ce8-4dcc-a33d-d96273cdca9e');
    sync = new LocalSyncClient(store, 'https://example.azurewebsites.net/api/v1', async () => 'access-token', transport as typeof fetch);
    assert.deepEqual(await sync.runOnce(1), { confirmed: 1, rejected: 0, remaining: 0, stopped: false });
    assert.deepEqual(sentIds, [movement.id, movement.id]);
    assert.equal((store.db.prepare('SELECT remote_id FROM local_movement WHERE id=?').get(movement.id) as { remote_id: number }).remote_id, 42);
    store.confirmOperation(movement.id, 42);
    assert.throws(() => store.confirmOperation(movement.id, 43), /Conflicting/);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('server error leaves pending operation and quota untouched', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jm-sync-'));
  try {
    const store = new LocalInventoryStore(join(dir, 'local.sqlite'), '4cb09edb-0ce8-4dcc-a33d-d96273cdca9e');
    store.cacheUser({ id: 1, tenantId: 'tenant', objectId: 'object', name: 'Ana', role: 'MECANICO', active: true });
    store.cacheCategory(1, 'Filtros');
    store.cacheProduct({ id: 1, categoryId: 1, sku: 'F-1', name: 'Filtro', active: true,
      stockMinimum: 0, confirmedStock: 5, offlineQuota: 1 });
    store.cacheUserProductQuota(1, 1, 1);
    store.registerMovement({ productId: 1, userId: 1, type: 'SALIDA', quantity: 1,
      reason: 'Taller', idempotencyKey: 'ac108d72-98b2-4991-b6d1-15304c3ee759' });
    const sync = new LocalSyncClient(store, 'https://example.azurewebsites.net/api/v1', async () => 'token',
      async () => new Response('{}', { status: 503 }));
    assert.equal((await sync.runOnce(1)).remaining, 1);
    assert.equal((store.db.prepare('SELECT remaining FROM user_product_quota WHERE user_id=1 AND product_id=1').get() as { remaining: number }).remaining, 0);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('explicit rejection is retained for review without restoring spent quota', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jm-sync-'));
  try {
    const store = new LocalInventoryStore(join(dir, 'local.sqlite'), '4cb09edb-0ce8-4dcc-a33d-d96273cdca9e');
    store.cacheUser({ id: 1, tenantId: 'tenant', objectId: 'object', name: 'Ana', role: 'MECANICO', active: true });
    store.cacheCategory(1, 'Filtros');
    store.cacheProduct({ id: 1, categoryId: 1, sku: 'F-1', name: 'Filtro', active: true,
      stockMinimum: 0, confirmedStock: 5, offlineQuota: 1 });
    store.cacheUserProductQuota(1, 1, 1);
    const movement = store.registerMovement({ productId: 1, userId: 1, type: 'SALIDA', quantity: 1,
      reason: 'Taller', idempotencyKey: '7fd11ca7-5ed9-46be-b850-cbbcb5ef5d4c' });
    const sync = new LocalSyncClient(store, 'https://example.azurewebsites.net/api/v1', async () => 'token',
      async () => new Response(JSON.stringify({ data: { operationId: movement.id, status: 'REJECTED', code: 'ROLE_CHANGED' } }),
        { status: 200 }));
    assert.deepEqual(await sync.runOnce(1), { confirmed: 0, rejected: 1, remaining: 0, stopped: false });
    assert.equal((store.db.prepare('SELECT error FROM sync_operation WHERE operation_id=?').get(movement.id) as { error: string }).error, 'ROLE_CHANGED');
    assert.equal((store.db.prepare('SELECT remaining FROM user_product_quota WHERE user_id=1 AND product_id=1').get() as { remaining: number }).remaining, 0);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('explicit device revocation stops sync without discarding local operation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jm-sync-'));
  try {
    const store = new LocalInventoryStore(join(dir, 'local.sqlite'), '4cb09edb-0ce8-4dcc-a33d-d96273cdca9e');
    store.cacheUser({ id: 1, tenantId: 'tenant', objectId: 'object', name: 'Ana', role: 'MECANICO', active: true });
    store.cacheCategory(1, 'Filtros');
    store.cacheProduct({ id: 1, categoryId: 1, sku: 'F-1', name: 'Filtro', active: true,
      stockMinimum: 0, confirmedStock: 5, offlineQuota: 1 });
    store.cacheUserProductQuota(1, 1, 1);
    store.registerMovement({ productId: 1, userId: 1, type: 'SALIDA', quantity: 1,
      reason: 'Taller', idempotencyKey: 'ac108d72-98b2-4991-b6d1-15304c3ee759' });
    const sync = new LocalSyncClient(store, 'https://example.azurewebsites.net/api/v1', async () => 'token',
      async () => new Response(JSON.stringify({ error: { code: 'DEVICE_NOT_REGISTERED' } }), { status: 403 }));
    assert.deepEqual(await sync.runOnce(1), { confirmed: 0, rejected: 0, remaining: 1, stopped: true, revoked: true });
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
