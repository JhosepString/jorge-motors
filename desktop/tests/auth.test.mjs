import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DesktopAuth, validateAuthConfig } from '../auth.mjs';

const config = { tenantId: '7f1563e9-20f9-4cd2-b943-b9bfb0c0b5c5',
  desktopClientId: '8f464e16-bda2-4f41-9f9e-e8dbfb34fc71',
  apiClientId: 'ac108d72-98b2-4991-b6d1-15304c3ee759',
  apiBaseUrl: 'https://example.azurewebsites.net/api/v1' };

test('desktop configuration requires Entra IDs and HTTPS API', () => {
  assert.equal(validateAuthConfig(config).apiBaseUrl, config.apiBaseUrl);
  assert.throws(() => validateAuthConfig({ ...config, apiBaseUrl: 'http://localhost:3000/api/v1' }), /HTTPS/);
  assert.throws(() => validateAuthConfig({ ...config, desktopClientId: 'bad' }), /Entra/);
});

test('desktop sign-in reports a safe Entra diagnostic code', async () => {
  const auth = new DesktopAuth(config, async () => {});
  auth.client = { acquireTokenInteractive: async () => { throw { errorCode: 'user_cancelled' }; } };
  await assert.rejects(auth.signIn(), /JM_AUTH_ENTRA_USER_CANCELLED/);
});

test('desktop lets MSAL Node choose its loopback redirect', async () => {
  const auth = new DesktopAuth(config, async () => {});
  auth.client = { acquireTokenInteractive: async (request) => {
    assert.equal(Object.hasOwn(request, 'redirectUri'), false);
    assert.equal(request.prompt, 'select_account');
    throw { errorCode: 'user_cancelled' };
  } };
  await assert.rejects(auth.signIn(), /JM_AUTH_ENTRA_USER_CANCELLED/);
});

test('desktop session starts only after API confirms profile and role', async () => {
  let accepted = false;
  const auth = new DesktopAuth(config, async () => {}, async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer valid-token');
    return { ok: accepted, json: async () => ({ data: { id: 4, nombres: 'Ana', rol: 'MECANICO' } }) };
  });
  const account = { homeAccountId: 'test' };
  auth.client = { acquireTokenInteractive: async () => ({ account, accessToken: 'valid-token' }),
    acquireTokenSilent: async () => ({ accessToken: 'renewed-token' }),
    getTokenCache: () => ({ removeAccount: async () => {} }) };
  await assert.rejects(auth.signIn(), /API no autorizó/);
  assert.equal(auth.state().signedIn, false);
  accepted = true;
  const state = await auth.signIn();
  assert.equal(state.profile.rol, 'MECANICO');
  assert.equal(await auth.token(), 'renewed-token');
  await auth.signOut();
  assert.equal(auth.state().signedIn, false);
});

test('failed reconnect keeps offline access, but explicit profile denial removes it', async () => {
  let clears = 0;
  let profileDenied = false;
  const grantStore = { deviceId: '8f464e16-bda2-4f41-9f9e-e8dbfb34fc71',
    load: async () => ({ id: 4, nombres: 'Ana', rol: 'MECANICO', issuedAt: Date.now() - 1000 }),
    clear: async () => { clears++; } };
  const identity = { deviceId: grantStore.deviceId, publicKey: 'public-key', proofHeaders: () => ({}) };
  const auth = new DesktopAuth(config, async () => {}, async (url) => {
    if (url.endsWith('/auth/me')) return profileDenied
      ? { ok: false, status: 403 }
      : { ok: true, json: async () => ({ data: { id: 4, nombres: 'Ana', rol: 'MECANICO' } }) };
    throw new Error('Network lost during device registration');
  }, grantStore, identity);
  auth.client = { acquireTokenInteractive: async () => ({ account: { homeAccountId: 'test' }, accessToken: 'valid-token' }) };
  await auth.initialize();
  await assert.rejects(auth.signIn(), /JM_AUTH_DEVICE_NETWORK/);
  assert.equal(auth.state().offlineAuthorized, true);
  assert.equal(clears, 0);
  profileDenied = true;
  await assert.rejects(auth.signIn(), /API no autorizó/);
  assert.equal(auth.state().offlineAuthorized, false);
  assert.equal(clears, 1);
});

test('desktop explains an unregistered Microsoft account without exposing identity details', async () => {
  const auth = new DesktopAuth(config, async () => {}, async () => ({ ok: false, status: 403,
    json: async () => ({ error: { code: 'USER_NOT_REGISTERED' } }) }));
  auth.client = { acquireTokenInteractive: async () => ({ account: { homeAccountId: 'other' },
    accessToken: 'valid-token' }) };
  await assert.rejects(auth.signIn(), /JM_AUTH_PROFILE_USER_NOT_REGISTERED/);
  assert.equal(auth.state().signedIn, false);
});
