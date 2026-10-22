import { Router, raw } from 'express';
import { z } from 'zod';
import { authenticate, resolveUser, requireRole } from '../../../middleware/authentication.js';
import type { BackendServices } from '../../../services.js';
import { AppError } from '../../../shared/app-error.js';
import { attachmentIdSchema, attachmentNameSchema, MAX_ATTACHMENT_BYTES } from '../domain/attachment.js';

function invoiceId(value: unknown) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,9}$/.test(value) || Number(value) > 2_147_483_647) {
    throw new AppError(400, 'INVALID_ATTACHMENT', 'Identificador de factura inválido.');
  }
  return Number(value);
}
export function attachmentRouter(services: BackendServices) {
  const router = Router({ mergeParams: true });
  let uploads = 0;
  router.use(authenticate(services.verifyToken), resolveUser(services.profiles), requireRole('ADMINISTRADOR'));
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get<{ id: string }>('/', async (req, res) => {
    const id = invoiceId(req.params.id);
    res.json(await (await services.attachments()).listar(id, res.locals.actor.id, res.locals.requestId));
  });
  router.post<{ id: string }>('/', (req, _res, next) => {
    invoiceId(req.params.id);
    const query = z.object({ nombre: attachmentNameSchema }).strict().safeParse(req.query);
    if (!query.success || !attachmentIdSchema.safeParse(req.get('Idempotency-Key')).success) {
      throw new AppError(400, 'INVALID_ATTACHMENT', 'Envíe nombre válido e Idempotency-Key UUID.');
    }
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(req.get('Content-Type') ?? '')) {
      throw new AppError(415, 'UNSUPPORTED_ATTACHMENT', 'Use PDF, PNG o JPEG como cuerpo binario, no JSON/base64 ni multipart.');
    }
    next();
  }, (_req, res, next) => {
    if (uploads >= 2) throw new AppError(429, 'UPLOAD_BUSY', 'Hay dos cargas activas. Reintente con la misma clave.');
    uploads++; let released = false;
    const release = () => { if (!released) { released = true; uploads--; } };
    const responseDone = () => { if (!res.locals.uploadProcessing) release(); };
    res.locals.releaseUpload = release;
    res.once('finish', responseDone); res.once('close', responseDone); next();
  }, raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES, inflate: false }), async (req, res) => {
    res.locals.uploadProcessing = true;
    try {
      const result = await (await services.attachments()).subir(invoiceId(req.params.id), req.query.nombre, req.get('Content-Type'),
        req.body, req.get('Idempotency-Key')!, res.locals.actor.id, res.locals.requestId);
      res.status(result.repetido ? 200 : 201).json({ data: result.adjunto, repetido: result.repetido });
    } finally { res.locals.releaseUpload(); }
  });
  router.get<{ id: string; adjuntoId: string }>('/:adjuntoId/contenido', async (req, res) => {
    const id = invoiceId(req.params.id); const parsed = attachmentIdSchema.safeParse(req.params.adjuntoId);
    if (!parsed.success) throw new AppError(400, 'INVALID_ATTACHMENT', 'Identificador de adjunto inválido.');
    const result = await (await services.attachments()).descargar(id, parsed.data, res.locals.actor.id, res.locals.requestId);
    const ext = result.adjunto.contentType === 'application/pdf' ? 'pdf' : result.adjunto.contentType === 'image/png' ? 'png' : 'jpg';
    res.set({ 'Content-Type': 'application/octet-stream', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Content-Disposition': `attachment; filename="factura-adjunto-${parsed.data}.${ext}"` });
    res.send(result.contents);
  });
  return router;
}
