import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { AppError } from '../../../shared/app-error.js';
import type { AccessTokenVerifier } from '../application/contracts.js';

const schema = z.object({
  ENTRA_TENANT_ID: z.uuid().optional(),
  ENTRA_API_CLIENT_ID: z.uuid().optional(),
  ENTRA_ALLOWED_CLIENT_IDS: z.string().transform((value) => value.split(',').map((id) => id.trim().toLowerCase()))
    .pipe(z.array(z.uuid()).min(1)).optional(),
}).superRefine((value, ctx) => {
  const count = [value.ENTRA_TENANT_ID, value.ENTRA_API_CLIENT_ID, value.ENTRA_ALLOWED_CLIENT_IDS].filter(Boolean).length;
  if (count !== 0 && count !== 3) ctx.addIssue({ code: 'custom', message: 'Complete las tres variables ENTRA.' });
});

export interface EntraSettings { tenantId: string; audience: string; clientIds: string[] }
export function parseEntraSettings(env: NodeJS.ProcessEnv): EntraSettings | undefined {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error('Configuración ENTRA inválida o incompleta. Revise los IDs del tenant, API y clientes.');
  const settings = parsed.data;
  if (!settings.ENTRA_TENANT_ID) return undefined;
  return {
    tenantId: settings.ENTRA_TENANT_ID.toLowerCase(),
    audience: settings.ENTRA_API_CLIENT_ID!.toLowerCase(), clientIds: settings.ENTRA_ALLOWED_CLIENT_IDS!,
  };
}

// El resolver alternativo solo se inyecta desde pruebas; no existe bypass por .env.
export function createEntraVerifier(settings: EntraSettings, keyResolver?: JWTVerifyGetKey): AccessTokenVerifier {
  const issuer = `https://login.microsoftonline.com/${settings.tenantId}/v2.0`;
  const keys = keyResolver ?? createRemoteJWKSet(new URL(
    `https://login.microsoftonline.com/${settings.tenantId}/discovery/v2.0/keys`,
  ), { timeoutDuration: 5_000 });

  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer, audience: settings.audience, algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'tid', 'oid', 'ver'], clockTolerance: 5,
      });
      if (payload.ver !== '2.0' || payload.tid !== settings.tenantId || !z.uuid().safeParse(payload.oid).success) {
        throw new AppError(401, 'INVALID_TOKEN', 'El token no es válido para esta API.');
      }
      if (typeof payload.azp !== 'string' || !settings.clientIds.includes(payload.azp.toLowerCase())) {
        throw new AppError(403, 'CLIENT_NOT_ALLOWED', 'La aplicación cliente no está autorizada.');
      }
      if (typeof payload.scp !== 'string' || !payload.scp.split(' ').includes('Inventario.Access')) {
        throw new AppError(403, 'SCOPE_REQUIRED', 'Falta el permiso delegado de la API.');
      }
      const roles = Array.isArray(payload.roles) ? payload.roles.filter((role): role is string => typeof role === 'string') : [];
      if (!roles.some((role) => ['Administrador', 'Mecanico'].includes(role))) {
        throw new AppError(403, 'APP_ROLE_REQUIRED', 'No tiene un rol de la aplicación.');
      }
      return { tenantId: settings.tenantId, objectId: String(payload.oid).toLowerCase(), roles };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (!(error instanceof errors.JOSEError) || error.code === 'ERR_JWKS_TIMEOUT') {
        throw new AppError(503, 'AUTH_PROVIDER_UNAVAILABLE', 'No se pudo verificar la identidad en este momento.');
      }
      throw new AppError(401, 'INVALID_TOKEN', 'El token no es válido o ha expirado.');
    }
  };
}
