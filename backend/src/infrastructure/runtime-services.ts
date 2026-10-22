import type { BackendServices } from '../services.js';
import { AppError } from '../shared/app-error.js';
import { createEntraVerifier, parseEntraSettings } from '../modules/auth/infrastructure/entra.js';
import type { UserProfile } from '../modules/auth/application/contracts.js';
import { InventarioFacade } from '../modules/inventario/application/inventario.facade.js';
import { SqlPoolSingleton } from './database/sql-pool.js';
import { parseSqlSettings } from './database/sql-settings.js';
import { SqlInventoryUnitOfWork } from './database/sql-inventory.js';
import { SqlAuditRepository } from './database/sql-audit.js';
import { inventoryEvents } from './inventory-events.js';
import { CatalogoFacade } from '../modules/catalogo/application/catalogo.facade.js';
import { SqlCatalogUnitOfWork } from './database/sql-catalog.js';
import { ProveedoresFacade } from '../modules/compras/application/proveedores.facade.js';
import { SqlSupplierUnitOfWork } from './database/sql-suppliers.js';
import { FacturasFacade } from '../modules/compras/application/facturas.facade.js';
import { SqlInvoiceUnitOfWork } from './database/sql-invoices.js';
import { AdjuntosFacade } from '../modules/compras/application/adjuntos.facade.js';
import { SqlAttachmentUnitOfWork } from './database/sql-attachments.js';
import { LocalAttachmentStore } from './storage/local-attachment-store.js';
import { managedBlobStore, parseBlobSettings } from './storage/blob-attachment-store.js';
import type { AttachmentStore } from '../modules/compras/application/attachment-contracts.js';
import { ReportesFacade } from '../modules/reportes/application/inventory-report.js';
import { SqlReportUnitOfWork } from './database/sql-reports.js';
import { ExcelInventoryStrategy, PdfInventoryStrategy } from '../modules/reportes/infrastructure/report-strategies.js';
import { InventoryReadFacade } from '../modules/inventario/application/inventory-read.js';
import { SqlInventoryReadUnitOfWork } from './database/sql-inventory-read.js';

// Composición: ninguna conexión SQL ni consulta a Entra ocurre al crear los servicios.
export function runtimeServices(env: NodeJS.ProcessEnv): BackendServices {
  const entra = parseEntraSettings(env);
  let attachmentStore: AttachmentStore | undefined;
  const getAttachmentStore = (): AttachmentStore => {
    if (attachmentStore) return attachmentStore;
    if (env.ATTACHMENT_STORAGE === 'blob') {
      try { attachmentStore = managedBlobStore(parseBlobSettings(env)); }
      catch { throw new AppError(503, 'ATTACHMENT_STORAGE_NOT_CONFIGURED', 'Configure el almacenamiento privado de adjuntos.'); }
    } else if (env.NODE_ENV !== 'production' && (!env.ATTACHMENT_STORAGE || env.ATTACHMENT_STORAGE === 'local')) {
      attachmentStore = new LocalAttachmentStore(env.ATTACHMENT_LOCAL_ROOT);
    } else {
      throw new AppError(503, 'ATTACHMENT_STORAGE_NOT_CONFIGURED', 'Configure el almacenamiento privado de adjuntos.');
    }
    return attachmentStore;
  };
  const getConnection = async () => {
    if (!env.SQL_DATABASE) throw new AppError(503, 'DATABASE_NOT_CONFIGURED', 'Configure la base de datos de la aplicación.');
    try {
      return await SqlPoolSingleton.getInstance().getConnection(parseSqlSettings(env));
    } catch {
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'La base de datos no está disponible.');
    }
  };
  return {
    verifyToken: entra ? createEntraVerifier(entra) : async () => {
      throw new AppError(503, 'AUTH_NOT_CONFIGURED', 'Complete el registro de la API en Entra ID.');
    },
    profiles: {
      async buscarIdentidad(tenantId, objectId) {
        const { pool, driver } = await getConnection();
        const result = await pool.request().input('tenant', driver.UniqueIdentifier, tenantId)
          .input('object', driver.UniqueIdentifier, objectId)
          .query<UserProfile>(`SELECT CONVERT(int, id) AS id, nombres, rol, activo,
            CONVERT(varchar(36), entra_tenant_id) AS entraTenantId,
            CONVERT(varchar(36), entra_object_id) AS entraObjectId FROM jm.usuario
            WHERE entra_tenant_id = @tenant AND entra_object_id = @object;`);
        return result.recordset[0];
      },
    },
    audit: {
      async registrar(event) {
        const { pool, driver } = await getConnection();
        await new SqlAuditRepository(pool, driver).registrar(event);
      },
    },
    async inventory() {
      return new InventarioFacade(new SqlInventoryUnitOfWork(await getConnection()), inventoryEvents());
    },
    async catalog() {
      return new CatalogoFacade(new SqlCatalogUnitOfWork(await getConnection()), inventoryEvents());
    },
    async suppliers() {
      return new ProveedoresFacade(new SqlSupplierUnitOfWork(await getConnection()));
    },
    async invoices() {
      return new FacturasFacade(new SqlInvoiceUnitOfWork(await getConnection()), inventoryEvents());
    },
    async attachments() {
      const store = getAttachmentStore();
      return new AdjuntosFacade(new SqlAttachmentUnitOfWork(await getConnection()), store);
    },
    async reports() { return new ReportesFacade(new SqlReportUnitOfWork(await getConnection()), {
      pdf: new PdfInventoryStrategy(), xlsx: new ExcelInventoryStrategy(),
    }); },
    async inventoryRead() { return new InventoryReadFacade(new SqlInventoryReadUnitOfWork(await getConnection())); },
  };
}
