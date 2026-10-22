import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from '../shared/logger.js';

export function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => {
      logger.info({
        event: 'http_request_completed',
        requestId,
        method: req.method,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
    // Chain of Responsibility: este eslabón delega en el siguiente.
    next();
  };
}
