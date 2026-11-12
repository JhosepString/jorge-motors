import { Router } from 'express';
import { authenticate, resolveUser, requireRole } from '../../../middleware/authentication.js';
import type { BackendServices } from '../../../services.js';
import { z } from 'zod';
import { AppError } from '../../../shared/app-error.js';
import { requestDeviceProof } from '../application/request-device-proof.js';

export function authRouter(services: BackendServices): Router {
  const router = Router();
  const userBody = z.object({ objectId: z.uuid(), nombres: z.string().trim().min(1).max(150),
    rol: z.enum(['ADMINISTRADOR', 'MECANICO']), activo: z.boolean() }).strict();
  const userChange = userBody.omit({ objectId: true });
  const actorContext = (res: { locals: Record<string, any> }) => ({ id: res.locals.actor.id,
    tenantId: res.locals.identity.tenantId, objectId: res.locals.identity.objectId,
    requestId: res.locals.requestId });
  router.get('/users', authenticate(services.verifyToken), resolveUser(services.profiles), requireRole('ADMINISTRADOR'), async (_req, res) => {
    if (!services.users) throw new AppError(503, 'USER_MANAGEMENT_NOT_CONFIGURED', 'La gestión de usuarios no está disponible.');
    res.json({ data: await (await services.users()).list(actorContext(res)) });
  });
  router.post('/users', authenticate(services.verifyToken), resolveUser(services.profiles), requireRole('ADMINISTRADOR'), async (req, res) => {
    const input = userBody.safeParse(req.body);
    if (!input.success) throw new AppError(400, 'INVALID_USER_INPUT', 'Revise el identificador, nombre y rol.');
    if (!services.users) throw new AppError(503, 'USER_MANAGEMENT_NOT_CONFIGURED', 'La gestión de usuarios no está disponible.');
    res.status(201).json({ data: await (await services.users()).create(actorContext(res), input.data) });
  });
  router.patch('/users/:id', authenticate(services.verifyToken), resolveUser(services.profiles), requireRole('ADMINISTRADOR'), async (req, res) => {
    const id = z.coerce.number().int().positive().max(2_147_483_647).safeParse(req.params.id);
    const input = userChange.safeParse(req.body);
    if (!id.success || !input.success) throw new AppError(400, 'INVALID_USER_INPUT', 'Revise el perfil y sus datos.');
    if (!services.users) throw new AppError(503, 'USER_MANAGEMENT_NOT_CONFIGURED', 'La gestión de usuarios no está disponible.');
    res.json({ data: await (await services.users()).update(actorContext(res), id.data, input.data) });
  });
  router.get('/me', authenticate(services.verifyToken), resolveUser(services.profiles), async (_req, res) => {
    const { actor, identity, requestId } = res.locals;
    await services.audit.registrar({
      requestId, action: 'CONSULTA_PERFIL', result: 'EXITO', userId: actor.id,
      tenantId: identity.tenantId, objectId: identity.objectId,
      entityId: String(actor.id), code: 'PROFILE_READ', httpStatus: 200, before: null, after: null,
    });
    res.json({ data: { id: actor.id, nombres: actor.nombres, rol: actor.rol } });
  });
  router.post('/offline-grant', authenticate(services.verifyToken), resolveUser(services.profiles), async (req, res) => {
    const parsed = z.object({ deviceId: z.uuid() }).strict().safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'INVALID_DEVICE', 'Identificador del equipo inválido.');
    if (!services.offlineGrant) throw new AppError(503, 'OFFLINE_GRANT_NOT_CONFIGURED', 'El acceso local no está configurado.');
    if (!services.devices) throw new AppError(503, 'DEVICE_SERVICE_NOT_CONFIGURED', 'El registro de equipos no está configurado.');
    const { actor, identity, requestId } = res.locals;
    await (await services.devices()).assertProof(parsed.data.deviceId, identity, requestDeviceProof(req),
      'POST', req.originalUrl, req.body);
    const grant = await services.offlineGrant(parsed.data.deviceId, actor, identity);
    await services.audit.registrar({ requestId, action: 'CONSULTA_PERFIL', result: 'EXITO', userId: actor.id,
      tenantId: identity.tenantId, objectId: identity.objectId, entityId: String(actor.id),
      code: 'OFFLINE_GRANT_ISSUED', httpStatus: 200, before: null, after: null });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { grant } });
  });
  return router;
}
