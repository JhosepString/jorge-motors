import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proxyApiRequest, validateApiRequest } from '../api-proxy.mjs';

test('API proxy accepts only relative application routes and approved headers', () => {
  const valid = { path: '/inventario/productos?despuesDe=0', method: 'GET', headers: {} };
  assert.equal(validateApiRequest(valid).path, valid.path);
  for (const path of ['https://other.example/path', '//other.example', '/../secret', '/inventario/../../secret', '/x#fragment'])
    assert.throws(() => validateApiRequest({ ...valid, path }), /Invalid API request/);
  assert.throws(() => validateApiRequest({ ...valid, headers: { Host: 'evil.example' } }), /Invalid API headers/);
  assert.throws(() => validateApiRequest({ ...valid, body: '{}' }), /exceeds limit/);
  assert.throws(() => validateApiRequest({ path: '/x', method: 'POST', headers: {}, body: new Uint8Array(5 * 1024 * 1024 + 1) }), /exceeds limit/);
});

test('API proxy obtains bearer in main process and relays JSON or binary response', async () => {
  const calls = [];
  const transport = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ data: [1] }), { status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'request-1' } });
  };
  const result = await proxyApiRequest('https://api.example.com/api/v1', async () => 'secret-token',
    { path: '/sync/devices', method: 'GET', headers: {} }, transport);
  assert.equal(calls[0].url, 'https://api.example.com/api/v1/sync/devices');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-token');
  assert.equal(result.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(result.body)), { data: [1] });
  await assert.rejects(proxyApiRequest('http://api.example.com/api/v1', async () => 'token',
    { path: '/x', method: 'GET', headers: {} }, transport), /configuration/);
  await assert.rejects(proxyApiRequest('https://api.example.com/api/v1', async () => 'token',
    { path: '/x', method: 'GET', headers: {} }, async () => new Response('large',
      { headers: { 'Content-Length': String(12 * 1024 * 1024 + 1) } })), /response exceeds limit/);
  assert.equal(calls.length, 1);
});
