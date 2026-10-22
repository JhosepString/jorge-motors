import type { RequestHandler } from 'express';
import { AppError } from '../shared/app-error.js';
import type { AccessTokenVerifier, UserProfileRepository, VerifiedIdentity } from '../modules/auth/application/contracts.js';

export function authenticate(verifier: AccessTokenVerifier): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    const match = header?.match(/^Bearer ([A-Za-z0-9_.-]+)$/i);
    if (!match?.[1] || match[1].length > 16_384) {
      throw new AppError(401, 'TOKEN_REQUIRED', 'Se requiere un access token Bearer.');
    }
    res.locals.identity = await verifier(match[1]);
    next();
  };
}

export function resolveUser(profiles: UserProfileRepository): RequestHandler {
  return async (_req, res, next) => {
    const identity = res.locals.identity as VerifiedIdentity;
    const user = await profiles.buscarIdentidad(identity.tenantId, identity.objectId);
    // Se usa únicamente identidad verificada, nunca correo o ID enviado por el body.
    if (!user) throw new AppError(403, 'USER_NOT_REGISTERED', 'Su perfil no está registrado.');
    res.locals.actor = user;
    if (!user.activo) throw new AppError(403, 'USER_DISABLED', 'Su perfil está inactivo.');
    const requiredRole = user.rol === 'ADMINISTRADOR' ? 'Administrador' : 'Mecanico';
    if (!identity.roles.includes(requiredRole)) {
      throw new AppError(403, 'ROLE_MISMATCH', 'El rol asignado no coincide con el perfil habilitado.');
    }
    next();
  };
}

export function requireRole(...roles: Array<'ADMINISTRADOR' | 'MECANICO'>): RequestHandler {
  return (_req, res, next) => {
    if (!res.locals.actor || !roles.includes(res.locals.actor.rol)) {
      throw new AppError(403, 'ROLE_FORBIDDEN', 'Su rol no permite esta operación.');
    }
    next();
  };
}
