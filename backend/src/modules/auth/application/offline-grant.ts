import { importPKCS8, SignJWT } from 'jose';
import type { UserProfile, VerifiedIdentity } from './contracts.js';

export type OfflineGrantSigner = (deviceId: string, actor: UserProfile, identity: VerifiedIdentity) => Promise<string>;

export function createOfflineGrantSigner(privateKeyPem: string): OfflineGrantSigner {
  let keyPromise: ReturnType<typeof importPKCS8> | undefined;
  return async (deviceId, actor, identity) => {
    keyPromise ??= importPKCS8(privateKeyPem.replaceAll('\\n', '\n'), 'RS256');
    return new SignJWT({ device_id: deviceId, user_id: actor.id, name: actor.nombres, role: actor.rol,
      tenant_id: identity.tenantId, object_id: identity.objectId, offline_policy: 'UNTIL_RECONNECT' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer('jorge-motors-api').setAudience('jorge-motors-desktop-offline')
      .setSubject(`${identity.tenantId}:${identity.objectId}`)
      .setIssuedAt().sign(await keyPromise);
  };
}
