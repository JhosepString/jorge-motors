import { Router } from 'express';
import { authenticate, resolveUser } from '../../../middleware/authentication.js';
import type { BackendServices } from '../../../services.js';

export function authRouter(services: BackendServices): Router {
  const router = Router();
  router.get('/me', authenticate(services.verifyToken), resolveUser(services.profiles), async (_req, res) => {
    const { actor, identity, requestId } = res.locals;
    await services.audit.registrar({
      requestId, action: 'CONSULTA_PERFIL', result: 'EXITO', userId: actor.id,
      tenantId: identity.tenantId, objectId: identity.objectId,
      entityId: String(actor.id), code: 'PROFILE_READ', httpStatus: 200, before: null, after: null,
    });
    res.json({ data: { id: actor.id, nombres: actor.nombres, rol: actor.rol } });
  });
  return router;
}
