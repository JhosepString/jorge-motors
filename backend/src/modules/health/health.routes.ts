import { Router } from 'express';
import type { BackendServices } from '../../services.js';

export function createHealthRouter(services?: BackendServices): Router {
  const router = Router();
  // Liveness: confirma que la API responde. No comprueba BD ni disponibilidad SLA.
  router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'jorge-motors-api' });
  });
  // Readiness sin datos de la base: confirma la identidad y conectividad SQL.
  // Se cachea brevemente para evitar una consulta por cada petición pública.
  let lastCheck: Promise<boolean> | undefined;
  let expiresAt = 0;
  router.get('/ready', async (_req, res) => {
    if (!services?.readiness) {
      res.status(503).json({ status: 'unavailable' });
      return;
    }
    if (!lastCheck || Date.now() >= expiresAt) {
      expiresAt = Date.now() + 15_000;
      lastCheck = services.readiness().then(() => true, () => false);
    }
    const ready = await lastCheck;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
  });
  return router;
}
