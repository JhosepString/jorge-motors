import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { AppConfig } from './config/env.js';
import { requestContext } from './middleware/request-context.js';
import { notFound } from './middleware/not-found.js';
import { errorHandler } from './middleware/error-handler.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { AppError } from './shared/app-error.js';
import { consoleLogger, type Logger } from './shared/logger.js';

export function createApp(config: AppConfig, logger: Logger = consoleLogger) {
  const app = express();
  app.disable('x-powered-by');

  // Chain of Responsibility: orden explícito y responsabilidades independientes.
  app.use(requestContext(logger));
  app.use(helmet());
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || origin === config.FRONTEND_ORIGIN) {
        callback(null, true);
        return;
      }
      callback(new AppError(403, 'ORIGIN_NOT_ALLOWED', 'El origen no está permitido.'));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['X-Request-Id'],
  }));
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/v1', createHealthRouter());
  // Futura autenticación/autorización se aplicará a las rutas del negocio.
  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
