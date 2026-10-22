import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { createEntraVerifier } from '../../src/modules/auth/infrastructure/entra.js';

export const tenantId = '11111111-1111-4111-8111-111111111111';
export const apiId = '22222222-2222-4222-8222-222222222222';
export const clientId = '33333333-3333-4333-8333-333333333333';
export const objectId = '44444444-4444-4444-8444-444444444444';
export const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
const { privateKey, publicKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'local-test-key', alg: 'RS256', use: 'sig' };

export const testVerifier = createEntraVerifier({ tenantId, audience: apiId, clientIds: [clientId] }, createLocalJWKSet({ keys: [jwk] }));

// Clave efímera de prueba. No se almacena ni configura como clave de la API real.
export function signTestToken(claims: JWTPayload = {}, key = privateKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: issuer, aud: apiId, iat: now, exp: now + 300,
    tid: tenantId, oid: objectId, ver: '2.0', azp: clientId,
    scp: 'Inventario.Access', roles: ['Administrador'], ...claims,
  }).setProtectedHeader({ alg: 'RS256', kid: 'local-test-key' }).sign(key);
}
