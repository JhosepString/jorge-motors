import { Router } from 'express';
import { authenticate, resolveUser, requireRole } from '../../../middleware/authentication.js';
import type { BackendServices } from '../../../services.js';
import { ReportError } from '../application/inventory-report.js';

export function reportRouter(services: BackendServices) {
  const router = Router();
  let activeExports = 0;
  router.use(authenticate(services.verifyToken), resolveUser(services.profiles), requireRole('ADMINISTRADOR'));
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/inventario', async (req, res) => {
    res.json(await (await services.reports()).inventario(req.query, res.locals.actor.id, res.locals.requestId));
  });
  router.get('/inventario/exportar', async (req, res) => {
    if (activeExports >= 2) {
      res.set('Retry-After', '2');
      throw new ReportError('REPORT_BUSY', 'Hay dos exportaciones en curso. Reintente en unos segundos.');
    }
    activeExports++;
    let released = false; let generationDone = false; let responseDone = false;
    const release = () => { if (!released && generationDone && responseDone) { released = true; activeExports--; } };
    const finished = () => { responseDone = true; release(); };
    res.once('finish', finished); res.once('close', finished);
    try {
      const { formato, contents } = await (await services.reports()).exportarInventario(req.query, res.locals.actor.id, res.locals.requestId);
      if (res.destroyed) return;
      res.set('Content-Type', formato === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', `attachment; filename="inventario.${formato}"`);
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Content-Security-Policy', "default-src 'none'; sandbox");
      res.send(contents);
    } finally {
      // Un cliente que desconecta no libera el cupo mientras el generador sigue activo.
      generationDone = true; responseDone ||= res.destroyed || res.writableFinished; release();
    }
  });
  return router;
}
