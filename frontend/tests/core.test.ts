import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient, ApiError, apiBase, errorText, MovementIntent, pen, stockStatus } from '../src/core/api';
test('API: solo HTTPS o loopback explícito y sin credenciales, query ni fragmento', () => {
  assert.equal(apiBase('http://127.0.0.1:3000/api/v1/'), 'http://127.0.0.1:3000/api/v1');
  for (const url of [
    'http://example.com/api/v1',
    'https://usuario:clave@example.com/api/v1',
    'https://example.com/api/v1?token=x',
  ])
    assert.throws(() => apiBase(url));
});
test('API: token solo en cabecera, sin cookies, caché, redirects ni token en URL', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const transport = (async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return new Response('{"data":[]}', { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const api = new ApiClient('http://localhost:3000/api/v1', async () => 'ficticio', transport);
  await api.json('/inventario/stock');
  assert.equal(calls[0]!.url, 'http://localhost:3000/api/v1/inventario/stock');
  assert.equal(new Headers(calls[0]!.init.headers).get('Authorization'), 'Bearer ficticio');
  assert.equal(calls[0]!.init.credentials, 'omit');
  assert.equal(calls[0]!.init.redirect, 'error');
  assert.equal(calls[0]!.init.cache, 'no-store');
  await assert.rejects(api.json('//externo.com'));
  await assert.rejects(api.json('/../auth/me'));
});
test('API: error mantiene código HTTP/correlación y no convierte fallo en lista vacía', async () => {
  const api = new ApiClient(
    'http://localhost:3000/api/v1',
    async () => 'ficticio',
    (async () =>
      new Response('{"error":{"code":"STALE_VERSION","message":"Registro modificado.","requestId":"demo"}}', {
        status: 412,
      })) as typeof fetch,
  );
  await assert.rejects(
    api.json('/catalogo/productos/1'),
    (e: unknown) => e instanceof ApiError && e.status === 412 && e.requestId === 'demo',
  );
  assert.equal(
    errorText(new Error('token secreto ficticio')),
    'No se completó la operación. Intente nuevamente.',
  );
});
test('API: no enlaza fetch al receptor ApiClient (compatibilidad navegador)', async () => {
  const transport = async function (this: unknown) {
    assert.equal(this, undefined);
    return new Response('{}');
  } as typeof fetch;
  await new ApiClient('http://localhost:3000/api/v1', async () => 'ficticio', transport).json('/auth/me');
});
test('Dinero exacto y estados inclusivos, sin convertir a Number', () => {
  assert.equal(pen('9999999999999999.99'), 'S/ 9,999,999,999,999,999.99');
  assert.equal(stockStatus({ stockActual: 2, stockMinimo: 2 }), 'BAJO_MINIMO');
  assert.equal(stockStatus({ stockActual: 0, stockMinimo: 0 }), 'AGOTADO');
  assert.equal(stockStatus({ activo: false, stockActual: 5, stockMinimo: 2 }), 'INACTIVO');
});
test('Idempotencia: la misma intención conserva clave tras reintento, otra cambia y éxito reinicia', () => {
  const intent = new MovementIntent();
  const first = intent.forPayload({ productoId: 1, cantidad: 2 });
  assert.equal(intent.forPayload({ productoId: 1, cantidad: 2 }), first);
  assert.notEqual(intent.forPayload({ productoId: 1, cantidad: 3 }), first);
  intent.reset();
  assert.notEqual(intent.forPayload({ productoId: 1, cantidad: 2 }), first);
});
