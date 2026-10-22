import { AppError } from './shared/app-error.js';
import type { AccessTokenVerifier, UserProfileRepository } from './modules/auth/application/contracts.js';
import type { AuditRepository } from './modules/auditoria/application/contracts.js';
import type { InventarioFacade } from './modules/inventario/application/inventario.facade.js';
import type { CatalogoFacade } from './modules/catalogo/application/catalogo.facade.js';
import type { ProveedoresFacade } from './modules/compras/application/proveedores.facade.js';
import type { FacturasFacade } from './modules/compras/application/facturas.facade.js';
import type { AdjuntosFacade } from './modules/compras/application/adjuntos.facade.js';
import type { ReportesFacade } from './modules/reportes/application/inventory-report.js';
import type { InventoryReadFacade } from './modules/inventario/application/inventory-read.js';

export interface BackendServices {
  verifyToken: AccessTokenVerifier;
  profiles: UserProfileRepository;
  audit: AuditRepository;
  inventory(): Promise<InventarioFacade>;
  catalog(): Promise<CatalogoFacade>;
  suppliers(): Promise<ProveedoresFacade>;
  invoices(): Promise<FacturasFacade>;
  attachments(): Promise<AdjuntosFacade>;
  reports(): Promise<ReportesFacade>;
  inventoryRead(): Promise<InventoryReadFacade>;
}

export function unconfiguredServices(): BackendServices {
  const unavailable = async (): Promise<never> => {
    throw new AppError(503, 'SERVICE_NOT_CONFIGURED', 'Complete la configuración de identidad y persistencia.');
  };
  return {
    verifyToken: unavailable, profiles: { buscarIdentidad: unavailable },
    audit: { registrar: unavailable }, inventory: unavailable, catalog: unavailable, suppliers: unavailable, invoices: unavailable, attachments: unavailable, reports: unavailable, inventoryRead: unavailable,
  };
}
