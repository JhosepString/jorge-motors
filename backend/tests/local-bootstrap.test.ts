import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LocalInventoryStore } from '../src/infrastructure/local/local-inventory.js';
import { LocalBootstrapClient } from '../src/infrastructure/local/bootstrap-client.js';

const deviceId = '4cb09edb-0ce8-4dcc-a33d-d96273cdca9e';
const user = { id: 7, tenantId: '7f1563e9-20f9-4cd2-b943-b9bfb0c0b5c5',
  objectId: '8f464e16-bda2-4f41-9f9e-e8dbfb34fc71', name: 'Ana', role: 'MECANICO', active: true };
const product = { id: 1, categoryId: 1, categoryName: 'Filtros', sku: 'F-1', name: 'Filtro',
  active: true, stockMinimum: 0, confirmedStock: 4, offlineQuota: 2 };

test('bootstrap persists pages, resumes after failure and rejects a foreign device', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jm-bootstrap-'));
  const path = join(dir, 'data.sqlite');
  try {
    let store = new LocalInventoryStore(path, deviceId);
    let calls = 0;
    const fetchPage = async (url: string | URL | Request) => {
      calls++;
      const after = Number(new URL(String(url)).searchParams.get('after'));
      if (after === 0) return new Response(JSON.stringify({ data: { deviceId, user, products: [product], nextAfter: 1 } }), { status: 200 });
      if (calls === 2) throw new Error('Network lost');
      return new Response(JSON.stringify({ data: { deviceId, user, products: [], nextAfter: null } }), { status: 200 });
    };
    let client = new LocalBootstrapClient(store, 'https://example.azurewebsites.net/api/v1', async () => 'token', fetchPage as typeof fetch);
    await assert.rejects(client.download(7), /Network lost/);
    assert.equal(store.bootstrapCursor(7), 1);
    assert.equal((store.db.prepare('SELECT offline_quota FROM product WHERE id=1').get() as { offline_quota: number }).offline_quota, 2);
    store.close();
    store = new LocalInventoryStore(path, deviceId);
    client = new LocalBootstrapClient(store, 'https://example.azurewebsites.net/api/v1', async () => 'token', fetchPage as typeof fetch);
    assert.equal(await client.download(7), 0);
    assert.equal(store.bootstrapCursor(7), null);
    store.close();
    assert.throws(() => new LocalInventoryStore(path, 'ac108d72-98b2-4991-b6d1-15304c3ee759'), /another device/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('invalid bootstrap page rolls back user, product and cursor together', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jm-bootstrap-'));
  try {
    const store = new LocalInventoryStore(join(dir, 'data.sqlite'), deviceId);
    assert.throws(() => store.applyBootstrapPage({ deviceId, user, products: [product,
      { ...product, id: 2, categoryId: 999, categoryName: '' }], nextAfter: null }, 7, 0));
    assert.equal(store.bootstrapCursor(7), 0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM product').get()!.n, 0);
    assert.throws(() => store.applyBootstrapPage({ deviceId, user, products: [product,
      { ...product, id: 2, sku: product.sku }], nextAfter: null }, 7, 0));
    assert.equal(store.bootstrapCursor(7), 0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM product').get()!.n, 0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM local_user').get()!.n, 0);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('refresh reconciles new quota without counting unsettled exits twice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jm-refresh-'));
  try {
    const store = new LocalInventoryStore(join(dir, 'data.sqlite'), deviceId);
    store.applyBootstrapPage({ deviceId, user, products: [{ ...product, offlineQuota: 3 }], nextAfter: null }, 7, 0);
    const movement = store.registerMovement({ productId: 1, userId: 7, type: 'SALIDA', quantity: 1,
      reason: 'Taller', idempotencyKey: '7fd11ca7-5ed9-46be-b850-cbbcb5ef5d4c' });
    assert.equal((store.db.prepare('SELECT offline_quota FROM product WHERE id=1').get() as { offline_quota: number }).offline_quota, 2);
    store.beginRefresh(7);
    store.applyRefreshPage({ deviceId, user, products: [{ ...product, offlineQuota: 5, confirmedStock: 6 }], nextAfter: null }, 7, 0);
    assert.equal((store.db.prepare('SELECT offline_quota FROM product WHERE id=1').get() as { offline_quota: number }).offline_quota, 4);
    store.confirmOperation(movement.id, 42);
    store.beginRefresh(7);
    store.applyRefreshPage({ deviceId, user, products: [{ ...product, offlineQuota: 4, confirmedStock: 5 }], nextAfter: null }, 7, 0);
    assert.equal((store.db.prepare('SELECT offline_quota FROM product WHERE id=1').get() as { offline_quota: number }).offline_quota, 4);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('refresh fails closed when cloud quota falls below a pending exit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jm-refresh-'));
  try {
    const store = new LocalInventoryStore(join(dir, 'data.sqlite'), deviceId);
    store.applyBootstrapPage({ deviceId, user, products: [{ ...product, offlineQuota: 2 }], nextAfter: null }, 7, 0);
    store.registerMovement({ productId: 1, userId: 7, type: 'SALIDA', quantity: 1,
      reason: 'Taller', idempotencyKey: 'ac108d72-98b2-4991-b6d1-15304c3ee759' });
    store.beginRefresh(7);
    assert.throws(() => store.applyRefreshPage({ deviceId, user,
      products: [{ ...product, offlineQuota: 0 }], nextAfter: null }, 7, 0), /quota/);
    assert.equal(store.refreshCursor(7), 0);
    assert.equal((store.db.prepare('SELECT offline_quota FROM product WHERE id=1').get() as { offline_quota: number }).offline_quota, 1);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bootstrap reports explicit device revocation without changing local data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jm-bootstrap-'));
  try {
    const store = new LocalInventoryStore(join(dir, 'data.sqlite'), deviceId);
    const client = new LocalBootstrapClient(store, 'https://example.azurewebsites.net/api/v1', async () => 'token',
      async () => new Response(JSON.stringify({ error: { code: 'DEVICE_NOT_REGISTERED' } }), { status: 403 }));
    await assert.rejects(client.download(7), { code: 'DEVICE_NOT_REGISTERED' });
    assert.equal(store.bootstrapCursor(7), 0);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
