import type { ErrorRequestHandler } from 'express';
import { AppError } from '../shared/app-error.js';
import type { Logger } from '../shared/logger.js';

export function errorHandler(logger: Logger): ErrorRequestHandler {
  // Express reconoce el manejador de errores por sus cuatro parámetros.
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    let failure = new AppError(500, 'INTERNAL_ERROR', 'Ocurrió un error interno.');
    if (error instanceof AppError) {
      failure = error;
    } else if (error && typeof error === 'object' && 'type' in error) {
      if (error.type === 'entity.parse.failed') {
        failure = new AppError(400, 'INVALID_JSON', 'El cuerpo JSON no es válido.');
      } else if (error.type === 'entity.too.large') {
        failure = new AppError(413, 'PAYLOAD_TOO_LARGE', 'El cuerpo de la petición excede el límite.');
      }
    }

    if (failure.status >= 500) {
      // No registrar cuerpos, tokens, mensajes originales ni cadenas de conexión.
      logger.error({ event: 'unhandled_request_error', requestId: res.locals.requestId });
    }

    res.status(failure.status).json({
      error: {
        code: failure.code,
        message: failure.message,
        requestId: res.locals.requestId,
      },
    });
  };
}
