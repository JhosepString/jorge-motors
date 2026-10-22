import { Router, type RequestHandler } from 'express';
import { authenticate, resolveUser, requireRole } from '../../../middleware/authentication.js';
import type { BackendServices } from '../../../services.js';
import { AppError } from '../../../shared/app-error.js';
import { movimientoInputSchema, type MovimientoInput } from '../application/inventario.facade.js';

const bodySchema = movimientoInputSchema.omit({ claveIdempotencia: true });
const validateMovement: RequestHandler = (req, res, next) => {
  const body = bodySchema.safeParse(req.body);
  if (!body.success) throw new AppError(400, 'INVALID_INPUT', 'Revise producto, cantidad, motivo y referencia.');
  const parsed = movimientoInputSchema.safeParse({ ...body.data, claveIdempotencia: req.get('Idempotency-Key') });
  if (!parsed.success) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Envíe Idempotency-Key con un UUID válido.');
  res.locals.movementInput = parsed.data;
  next();
};

export function inventoryRouter(services: BackendServices): Router {
  const router = Router();
  router.use(authenticate(services.verifyToken), resolveUser(services.profiles));
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  for (const kind of ['stock', 'movimientos', 'categorias'] as const) {
    router.get(`/${kind}`, requireRole('ADMINISTRADOR', 'MECANICO'), async (req, res) => {
      res.json(await (await services.inventoryRead())[kind](req.query, res.locals.actor.id, res.locals.requestId));
    });
  }
  for (const kind of ['salidas', 'entradas'] as const) {
    router.post(`/${kind}`, requireRole(...(kind === 'entradas'
      ? ['ADMINISTRADOR'] as const : ['ADMINISTRADOR', 'MECANICO'] as const)), validateMovement,
    async (_req, res) => {
      const facade = await services.inventory();
      const input = res.locals.movementInput as MovimientoInput;
      const result = kind === 'salidas'
        ? await facade.registrarSalida(input, res.locals.actor.id, res.locals.requestId)
        : await facade.registrarEntrada(input, res.locals.actor.id, res.locals.requestId);
      const { requestHash: _hash, ...movimiento } = result.movimiento;
      res.status(result.repetido ? 200 : 201).json({ data: movimiento, repetido: result.repetido });
    });
  }
  return router;
}
