import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole, resolveUser } from '../../../middleware/authentication.js';
import type { BackendServices } from '../../../services.js';
import { AppError } from '../../../shared/app-error.js';
import { bootstrapInput, quotaInput, syncInput } from '../../../infrastructure/database/sql-sync.js';
import { deviceRegistrationInput, deviceRevocationInput } from '../../../infrastructure/database/sql-devices.js';
import { requestDeviceProof } from '../../auth/application/request-device-proof.js';

export function syncRouter(services: BackendServices): Router {
  const router = Router();
  router.use(authenticate(services.verifyToken), resolveUser(services.profiles));
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/devices', requireRole('ADMINISTRADOR', 'MECANICO'), async (req, res) => {
    const parsed = deviceRegistrationInput.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'INVALID_DEVICE', 'Registro de equipo inválido.');
    if (!services.devices) throw new AppError(503, 'DEVICE_SERVICE_NOT_CONFIGURED', 'El registro de equipos no está configurado.');
    await (await services.devices()).register(parsed.data, res.locals.identity, requestDeviceProof(req),
      res.locals.actor, res.locals.requestId);
    res.status(200).json({ data: { deviceId: parsed.data.deviceId } });
  });
  router.get('/devices', requireRole('ADMINISTRADOR'), async (_req, res) => {
    if (!services.devices) throw new AppError(503, 'DEVICE_SERVICE_NOT_CONFIGURED', 'El registro de equipos no está configurado.');
    res.json({ data: await (await services.devices()).list(res.locals.identity) });
  });
  router.post('/devices/:deviceId/revoke', requireRole('ADMINISTRADOR'), async (req, res) => {
    const deviceId = z.uuid().safeParse(req.params.deviceId);
    const body = deviceRevocationInput.safeParse(req.body);
    if (!deviceId.success || !body.success) throw new AppError(400, 'INVALID_DEVICE_REVOCATION', 'Indique un equipo y un motivo válido.');
    if (!services.devices) throw new AppError(503, 'DEVICE_SERVICE_NOT_CONFIGURED', 'El registro de equipos no está configurado.');
    res.json({ data: await (await services.devices()).revoke(deviceId.data, body.data.reason,
      res.locals.identity, res.locals.actor, res.locals.requestId) });
  });
  router.get('/bootstrap', requireRole('ADMINISTRADOR', 'MECANICO'), async (req, res) => {
    const parsed = bootstrapInput.safeParse({ deviceId: req.query.deviceId,
      after: Number(req.query.after ?? 0), limit: Number(req.query.limit ?? 100) });
    if (!parsed.success) throw new AppError(400, 'INVALID_BOOTSTRAP_INPUT', 'Consulta inicial inválida.');
    if (!services.sync) throw new AppError(503, 'SYNC_NOT_CONFIGURED', 'La sincronización no está configurada.');
    if (!services.devices) throw new AppError(503, 'DEVICE_SERVICE_NOT_CONFIGURED', 'El registro de equipos no está configurado.');
    await (await services.devices()).assertProof(parsed.data.deviceId, res.locals.identity, requestDeviceProof(req),
      'GET', req.originalUrl);
    res.json({ data: await (await services.sync()).bootstrap(parsed.data, res.locals.actor) });
  });
  router.post('/quotas', requireRole('ADMINISTRADOR'), async (req, res) => {
    const parsed = quotaInput.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'INVALID_QUOTA_INPUT', 'Revise el equipo, producto y cantidad.');
    if (!services.sync) throw new AppError(503, 'SYNC_NOT_CONFIGURED', 'La sincronización no está configurada.');
    if (!services.devices) throw new AppError(503, 'DEVICE_SERVICE_NOT_CONFIGURED', 'El registro de equipos no está configurado.');
    await (await services.devices()).assertRegistered(parsed.data.deviceId, res.locals.identity);
    const remaining = await (await services.sync()).assignQuota(parsed.data, res.locals.actor, res.locals.requestId);
    res.status(201).json({ data: { allocationId: parsed.data.allocationId, remaining } });
  });
  router.post('/operations', requireRole('ADMINISTRADOR', 'MECANICO'), async (req, res) => {
    const parsed = syncInput.safeParse(req.body);
    if (!parsed.success) throw new AppError(400, 'INVALID_SYNC_INPUT', 'Operación de sincronización inválida.');
    if (!services.sync) throw new AppError(503, 'SYNC_NOT_CONFIGURED', 'La sincronización no está configurada.');
    if (!services.devices) throw new AppError(503, 'DEVICE_SERVICE_NOT_CONFIGURED', 'El registro de equipos no está configurado.');
    await (await services.devices()).assertProof(parsed.data.deviceId, res.locals.identity, requestDeviceProof(req),
      'POST', req.originalUrl, req.body);
    const result = await (await services.sync()).accept(parsed.data, res.locals.actor, res.locals.requestId);
    res.status(200).json({ data: result });
  });
  return router;
}
