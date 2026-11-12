import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiClient } from '../src/core/api';
import { desktopTransport } from '../src/core/desktop-transport';

test('desktop API transport relays JSON and files without forwarding renderer token', async () => {
  const requests: Array<{ path: string; method: string; headers: Record<string, string>; body?: string | Uint8Array }> = [];
  const bridge = { apiRequest: async (input: typeof requests[number]) => {
    requests.push(input);
    return { status: 200, headers: { 'content-type': 'application/json' },
      body: new TextEncoder().encode(JSON.stringify({ data: { ok: true } })) };
  } } as unknown as NonNullable<Window['jorgeDesktop']>;
  const base = 'https://api.example.com/api/v1';
  const client = new ApiClient(base, async () => 'renderer-placeholder', desktopTransport(base, bridge));
  assert.deepEqual(await client.json('/sync/devices'), { data: { ok: true } });
  await client.json('/compras/facturas/1/adjuntos?nombre=recibo.pdf', { method: 'POST',
    headers: { 'Content-Type': 'application/pdf', 'Idempotency-Key': 'key-1' },
    body: new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' }) });
  assert.equal(requests[0]?.path, '/sync/devices');
  assert.equal(requests[0]?.headers.authorization, undefined);
  assert.deepEqual(Array.from(requests[1]?.body as Uint8Array), [1, 2, 3]);
  assert.equal(requests[1]?.headers['content-type'], 'application/pdf');
});
