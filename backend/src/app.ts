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
import { unconfiguredServices, type BackendServices } from './services.js';
import { inventoryRouter } from './modules/inventario/presentation/inventory.routes.js';
import { authRouter } from './modules/auth/presentation/auth.routes.js';
import { catalogRouter } from './modules/catalogo/presentation/catalog.routes.js';
import { supplierRouter } from './modules/compras/presentation/supplier.routes.js';
import { invoiceRouter } from './modules/compras/presentation/invoice.routes.js';
import { attachmentRouter } from './modules/compras/presentation/attachment.routes.js';
import { reportRouter } from './modules/reportes/presentation/report.routes.js';

export function createApp(config: AppConfig, logger: Logger = consoleLogger, services: BackendServices = unconfiguredServices()) {
  const app = express();
  app.disable('x-powered-by');

  // Chain of Responsibility: orden explícito y responsabilidades independientes.
  app.use(requestContext(logger));
  app.use((req, res, next) => {
    res.locals.auditRequired = req.path.startsWith('/api/v1/inventario') || req.path.startsWith('/api/v1/catalogo') || req.path.startsWith('/api/v1/compras') || req.path.startsWith('/api/v1/reportes') || req.path === '/api/v1/auth/me';
    next();
  });
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
    exposedHeaders: ['X-Request-Id', 'ETag', 'Content-Disposition', 'Retry-After'],
  }));
  app.use(express.json({ limit: '64kb' }));
  app.use('/api/v1', createHealthRouter());
  app.use('/api/v1/auth', authRouter(services));
  app.use('/api/v1/inventario', inventoryRouter(services));
  app.use('/api/v1/catalogo', catalogRouter(services));
  app.use('/api/v1/compras/proveedores', supplierRouter(services));
  app.use('/api/v1/compras/facturas/:id/adjuntos', attachmentRouter(services));
  app.use('/api/v1/compras/facturas', invoiceRouter(services));
  app.use('/api/v1/reportes', reportRouter(services));
  app.use(notFound);
  app.use(errorHandler(logger, services.audit));
  return app;
}
