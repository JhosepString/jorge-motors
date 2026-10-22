import type { ErrorRequestHandler } from 'express';
import { AppError } from '../shared/app-error.js';
import type { Logger } from '../shared/logger.js';
import { InventoryError } from '../modules/inventario/domain/inventory-error.js';
import type { AuditRepository, AuditEvent } from '../modules/auditoria/application/contracts.js';
import { CatalogError } from '../modules/catalogo/domain/catalog-error.js';
import { PurchaseError } from '../modules/compras/domain/purchase-error.js';
import { ReportError } from '../modules/reportes/application/inventory-report.js';

export function errorHandler(logger: Logger, audit?: AuditRepository): ErrorRequestHandler {
  // Express reconoce el manejador de errores por sus cuatro parámetros.
  return async (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    let failure = new AppError(500, 'INTERNAL_ERROR', 'Ocurrió un error interno.');
    if (error instanceof AppError) {
      failure = error;
    } else if (error instanceof ReportError) {
      const statuses: Record<string, number> = { INVALID_REPORT_INPUT: 400, REPORT_FORBIDDEN: 403, REPORT_TOO_LARGE: 413,
        REPORT_BUSY: 429, REPORT_EXPORT_NOT_CONFIGURED: 503, REPORT_EXCEL_PRECISION: 422, REPORT_PDF_TEXT: 422 };
      failure = new AppError(statuses[error.code] ?? 500, error.code, error.message);
    } else if (error instanceof PurchaseError) {
      const statuses: Record<string, number> = {
        INVALID_SUPPLIER_INPUT: 400, SUPPLIER_NOT_FOUND: 404, SUPPLIER_FORBIDDEN: 403,
        SUPPLIER_DUPLICATE: 409, STALE_VERSION: 412,
        INVALID_INVOICE_INPUT: 400, INVOICE_AMOUNT_LIMIT: 400, INVOICE_FORBIDDEN: 403,
        INVOICE_NOT_FOUND: 404, INVOICE_PRODUCT_NOT_FOUND: 404, INVOICE_PRODUCT_INACTIVE: 409,
        INVOICE_SUPPLIER_INACTIVE: 409, INVOICE_DUPLICATE: 409, INVOICE_NOT_DRAFT: 409,
        INVOICE_ALREADY_RECEIVED: 409, IDEMPOTENCY_CONFLICT: 409,
        INVALID_ATTACHMENT: 400, UNSUPPORTED_ATTACHMENT: 415, ATTACHMENT_TOO_LARGE: 413,
        ATTACHMENT_FORBIDDEN: 403, ATTACHMENT_NOT_FOUND: 404, ATTACHMENT_LIMIT: 409,
        ATTACHMENT_INVOICE_CANCELLED: 409, ATTACHMENT_EXPIRED: 409, ATTACHMENT_BUSY: 409,
        ATTACHMENT_STORAGE_UNAVAILABLE: 503, ATTACHMENT_INTEGRITY: 503,
      };
      failure = new AppError(statuses[error.code] ?? 500, error.code, error.message);
    } else if (error instanceof CatalogError) {
      const statuses: Record<string, number> = {
        INVALID_CATALOG_INPUT: 400, CATEGORY_NOT_FOUND: 404, CATALOG_PRODUCT_NOT_FOUND: 404,
        CATALOG_FORBIDDEN: 403, CATALOG_DUPLICATE: 409, CATALOG_PRODUCT_INACTIVE: 409, STALE_VERSION: 412,
      };
      failure = new AppError(statuses[error.code] ?? 500, error.code, error.message);
    } else if (error instanceof InventoryError) {
      const statuses: Record<string, number> = {
        INVALID_INPUT: 400, INVALID_QUANTITY: 400, PRODUCT_NOT_FOUND: 404,
        USER_NOT_ACTIVE: 403, FORBIDDEN_MOVEMENT: 403, PRODUCT_NOT_ACTIVE: 409,
        INSUFFICIENT_STOCK: 409, STOCK_LIMIT_EXCEEDED: 409, STOCK_CONFLICT: 409,
        IDEMPOTENCY_CONFLICT: 409,
      };
      failure = new AppError(statuses[error.code] ?? 500, error.code, error.message);
    } else if (error && typeof error === 'object' && 'type' in error) {
      if (error.type === 'entity.parse.failed') {
        failure = new AppError(400, 'INVALID_JSON', 'El cuerpo JSON no es válido.');
      } else if (error.type === 'entity.too.large') {
        failure = new AppError(413, 'PAYLOAD_TOO_LARGE', 'El cuerpo de la petición excede el límite.');
      } else if (error.type === 'encoding.unsupported') {
        failure = new AppError(415, 'UNSUPPORTED_ATTACHMENT', 'No se admiten cuerpos comprimidos.');
      }
    }

    if (failure.status >= 500) {
      // No registrar cuerpos, tokens, mensajes originales ni cadenas de conexión.
      logger.error({ event: 'unhandled_request_error', requestId: res.locals.requestId });
    }

    if (res.locals.auditRequired) {
      const event: AuditEvent = {
        requestId: res.locals.requestId,
        action: failure.status >= 500 ? 'HTTP_ERROR' : 'HTTP_RECHAZADA',
        result: failure.status >= 500 ? 'ERROR' : 'RECHAZADO',
        userId: res.locals.actor?.id ?? null,
        tenantId: res.locals.identity?.tenantId ?? null,
        objectId: res.locals.identity?.objectId ?? null,
        entityId: null, code: failure.code, httpStatus: failure.status, before: null, after: null,
      };
      try {
        if (!audit) throw new Error('Auditoría no configurada.');
        await audit.registrar(event);
      } catch {
        // Respaldo explícito: no se afirma que el evento quedó persistido en SQL.
        logger.error({ event: 'audit_persistence_failed', ...event, destination: 'console_fallback' });
      }
    }
    if (failure.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');

    res.status(failure.status).json({
      error: {
        code: failure.code,
        message: failure.message,
        requestId: res.locals.requestId,
      },
    });
  };
}
