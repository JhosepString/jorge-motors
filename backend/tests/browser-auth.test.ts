import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PublicClientApplication, type InteractiveRequest } from '@azure/msal-node';
import { acquireBrowserToken } from '../src/cli/browser-auth.js';

test('el cliente usa MSAL interactivo, scope de inventario y selector de cuenta sin secreto ni redirect fijo', async () => {
  let request: InteractiveRequest | undefined;
  const result = await acquireBrowserToken({ acquireTokenInteractive: async (value) => {
    request = value;
    return {} as Awaited<ReturnType<typeof acquireBrowserToken>>;
  } }, 'api-id', async () => {});
  assert.ok(result);
  assert.deepEqual(request!.scopes, ['api://api-id/Inventario.Access']);
  assert.equal(request!.prompt, 'select_account');
  assert.match(request!.nonce!, /^[0-9a-f-]{36}$/);
  assert.equal(request!.redirectUri, undefined);
  assert.equal('clientSecret' in request!, false);
});

test('el navegador solo abre HTTPS del proveedor Microsoft esperado', async () => {
  const opened: string[] = [];
  await acquireBrowserToken({ acquireTokenInteractive: async (request) => {
    await request.openBrowser('https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize');
    for (const address of ['http://login.microsoftonline.com/', 'https://example.org/',
      'https://login.microsoftonline.com.evil.example/', 'https://user@login.microsoftonline.com/']) {
      await assert.rejects(request.openBrowser(address));
    }
    return {} as Awaited<ReturnType<typeof acquireBrowserToken>>;
  } }, 'api-id', async (url) => { opened.push(url); });
  assert.equal(opened.length, 1);
});

test('el nonce cambia entre inicios de sesión y los errores se propagan sin fallback a Device Code', async () => {
  const nonces = new Set<string>();
  const client = { acquireTokenInteractive: async (request: InteractiveRequest) => {
    nonces.add(request.nonce!);
    throw new Error('Prueba de cancelación');
  } };
  await assert.rejects(acquireBrowserToken(client, 'api-id', async () => {}));
  await assert.rejects(acquireBrowserToken(client, 'api-id', async () => {}));
  assert.equal(nonces.size, 2);
});

test('MSAL real genera PKCE S256, abre receptor loopback y lo cierra si falla la apertura, sin contactar Entra', async () => {
  const client = new PublicClientApplication({ auth: {
    clientId: '06b6e377-10f3-4742-a2b0-39289eb9d027',
    authority: 'https://login.microsoftonline.com/7f1563e9-20f9-4cd2-b943-b9bfb0c0b5c5',
  } });
  let receiver = '';
  // Sustituir la construcción remota de URL evita descubrimiento y tráfico a Microsoft.
  client.getAuthCodeUrl = async (request) => {
    assert.equal(request.codeChallengeMethod, 'S256');
    assert.match(request.codeChallenge!, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(request.responseMode, 'form_post');
    const redirect = new URL(request.redirectUri);
    assert.equal(redirect.hostname, 'localhost');
    assert.ok(Number(redirect.port) > 0);
    receiver = `http://127.0.0.1:${redirect.port}`;
    return 'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize';
  };
  await assert.rejects(acquireBrowserToken(client, 'api-id', async () => {
    const response = await fetch(receiver, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /terminal/);
    throw new Error('Navegador simulado no disponible');
  }), /Navegador simulado/);
  assert.ok(receiver);
  await assert.rejects(fetch(receiver, { signal: AbortSignal.timeout(2000) }));
});
