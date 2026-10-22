import { Router } from 'express';

export function createHealthRouter(): Router {
  const router = Router();
  // Liveness: confirma que la API responde. No comprueba BD ni disponibilidad SLA.
  router.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'jorge-motors-api' });
  });
  return router;
}
