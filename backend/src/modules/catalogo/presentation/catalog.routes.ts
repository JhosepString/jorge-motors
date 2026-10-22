import { Router } from 'express';
import { authenticate, resolveUser, requireRole } from '../../../middleware/authentication.js';
import type { BackendServices } from '../../../services.js';
import { AppError } from '../../../shared/app-error.js';
import { versionSchema } from '../application/catalogo.facade.js';

function id(value: unknown): number {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,9}$/.test(value) || Number(value) > 2_147_483_647) {
    throw new AppError(400, 'INVALID_CATALOG_INPUT', 'Identificador inválido.');
  }
  return Number(value);
}
function expectedVersion(header: string | undefined): string {
  if (!header) throw new AppError(428, 'VERSION_REQUIRED', 'Envíe If-Match con la versión vigente.');
  const match = /^"([0-9a-fA-F]{16}|[0-9a-fA-F]{32})"$/.exec(header);
  const parsed = versionSchema.safeParse(match?.[1]);
  if (!parsed.success) throw new AppError(400, 'INVALID_CATALOG_INPUT', 'If-Match debe contener una versión fuerte entre comillas.');
  if (match![1] !== parsed.data) throw new AppError(412, 'STALE_VERSION', 'La etiqueta no coincide exactamente con la versión publicada.');
  return parsed.data;
}
export function catalogRouter(services: BackendServices) {
  const router = Router();
  router.use(authenticate(services.verifyToken), resolveUser(services.profiles), requireRole('ADMINISTRADOR'));
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  for (const kind of ['categorias', 'productos'] as const) {
    router.get(`/${kind}`, async (req, res) => {
      const facade = await services.catalog();
      res.json(await facade.listar(kind, req.query, res.locals.actor.id, res.locals.requestId));
    });
    router.post(`/${kind}`, async (req, res) => {
      const facade = await services.catalog();
      const args = [req.body, res.locals.actor.id as number, res.locals.requestId as string] as const;
      const data = kind === 'categorias' ? await facade.crearCategoria(...args) : await facade.crearProducto(...args);
      res.set('ETag', `"${data.version}"`).status(201).json({ data });
    });
    router.put(`/${kind}/:id`, async (req, res) => {
      const entityId = id(req.params.id); const version = expectedVersion(req.get('If-Match'));
      const facade = await services.catalog();
      const args = [entityId, req.body, version, res.locals.actor.id as number, res.locals.requestId as string] as const;
      const data = kind === 'categorias' ? await facade.actualizarCategoria(...args) : await facade.actualizarProducto(...args);
      res.set('ETag', `"${data.version}"`).json({ data });
    });
  }
  router.get('/productos/:id', async (req, res) => {
    const entityId = id(req.params.id); const facade = await services.catalog();
    const data = await facade.obtenerProducto(entityId, res.locals.actor.id, res.locals.requestId);
    res.set('ETag', `"${data.version}"`).json({ data });
  });
  return router;
}
