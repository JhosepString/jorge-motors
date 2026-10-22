import { Router } from 'express';
import { authenticate, resolveUser, requireRole } from '../../../middleware/authentication.js';
import type { BackendServices } from '../../../services.js';
import { AppError } from '../../../shared/app-error.js';

function id(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,9}$/.test(value) || Number(value) > 2_147_483_647) {
    throw new AppError(400, 'INVALID_SUPPLIER_INPUT', 'Identificador inválido.');
  }
  return Number(value);
}
function version(header: string | undefined): string {
  if (!header) throw new AppError(428, 'VERSION_REQUIRED', 'Envíe If-Match con la versión vigente.');
  const match = /^"([0-9a-fA-F]{16})"$/.exec(header);
  if (!match) throw new AppError(400, 'INVALID_SUPPLIER_INPUT', 'Envíe una sola versión fuerte entre comillas.');
  if (match[1] !== match[1]!.toUpperCase()) throw new AppError(412, 'STALE_VERSION', 'La etiqueta no coincide con la publicada.');
  return match[1]!;
}
export function supplierRouter(services: BackendServices) {
  const router = Router();
  router.use(authenticate(services.verifyToken), resolveUser(services.profiles), requireRole('ADMINISTRADOR'));
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/', async (req, res) => {
    res.json(await (await services.suppliers()).listar(req.query, res.locals.actor.id, res.locals.requestId));
  });
  router.get('/:id', async (req, res) => {
    const entityId = id(req.params.id);
    const data = await (await services.suppliers()).obtener(entityId, res.locals.actor.id, res.locals.requestId);
    res.set('ETag', `"${data.version}"`).json({ data });
  });
  router.post('/', async (req, res) => {
    const data = await (await services.suppliers()).crear(req.body, res.locals.actor.id, res.locals.requestId);
    res.set('ETag', `"${data.version}"`).status(201).json({ data });
  });
  router.put('/:id', async (req, res) => {
    const entityId = id(req.params.id); const expected = version(req.get('If-Match'));
    const data = await (await services.suppliers()).actualizar(entityId, req.body, expected, res.locals.actor.id, res.locals.requestId);
    res.set('ETag', `"${data.version}"`).json({ data });
  });
  return router;
}
