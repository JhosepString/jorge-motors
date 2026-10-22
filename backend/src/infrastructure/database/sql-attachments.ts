import type { SqlConnection } from './sql-pool.js';
import { withSqlTransaction } from './sql-transaction.js';
import { inventoryRepositories } from './sql-inventory.js';
import type { AttachmentRepositories, AttachmentUnitOfWork, StoredAttachment } from '../../modules/compras/application/attachment-contracts.js';
import { PurchaseError } from '../../modules/compras/domain/purchase-error.js';

const expired = `creado_en<=DATEADD(minute,-30,CONVERT(datetime2(3),SYSUTCDATETIME()))`;
const columns = `LOWER(CONVERT(varchar(36),id)) AS id,factura_id AS facturaId,nombre,content_type AS contentType,
  bytes,sha256,estado,usuario_id AS usuarioId,creado_en AS creadoEn,CONVERT(bit,CASE WHEN ${expired} THEN 1 ELSE 0 END) AS caducado`;
export class SqlAttachmentUnitOfWork implements AttachmentUnitOfWork {
  constructor(private readonly connection: SqlConnection) {}
  ejecutar<T>(operation: (repos: AttachmentRepositories) => Promise<T>): Promise<T> {
    return withSqlTransaction(this.connection, async (tx) => {
      const driver = this.connection.driver;
      const inventory = inventoryRepositories(tx, driver);
      const get = async (id: string) => (await tx.request().input('id', driver.UniqueIdentifier, id)
        .query<StoredAttachment>(`SELECT ${columns} FROM jm.factura_adjunto WITH (UPDLOCK,HOLDLOCK) WHERE id=@id;`)).recordset[0];
      const requireRow = async (id: string) => {
        const row = await get(id); if (!row) throw new Error('Adjunto no persistido.'); return row;
      };
      return operation({ usuarios: inventory.usuarios, auditoria: inventory.auditoria,
        facturas: {
          async obtener(id) {
            return (await tx.request().input('id', driver.Int, id).query<{ id: number; estado: string }>(
              'SELECT CONVERT(int,id) AS id,estado FROM jm.factura_compra WITH (UPDLOCK,HOLDLOCK) WHERE id=@id;')).recordset[0];
          },
        },
        adjuntos: {
          obtener: get,
          async bloquear(resource) {
            const result = await tx.request().input('resource', driver.NVarChar(255), `jm:adjunto:${resource}`)
              .query<{ result: number }>(`DECLARE @result int;
                EXEC @result=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
                SELECT @result AS result;`);
            if ((result.recordset[0]?.result ?? -999) < 0) throw new PurchaseError('ATTACHMENT_BUSY', 'El archivo está siendo procesado. Reintente con la misma clave.');
          },
          async buscarClave(userId, key) {
            return (await tx.request().input('user', driver.Int, userId).input('key', driver.UniqueIdentifier, key)
              .query<StoredAttachment>(`SELECT ${columns} FROM jm.factura_adjunto WHERE usuario_id=@user AND clave=@key;`)).recordset[0];
          },
          async contarActivos(invoiceId) {
            return (await tx.request().input('invoice', driver.Int, invoiceId)
              .query<{ n: number }>(`SELECT COUNT(*) AS n FROM jm.factura_adjunto WHERE factura_id=@invoice AND estado<>'ELIMINADO';`)).recordset[0]!.n;
          },
          async crear(data, key) {
            await tx.request().input('id', driver.UniqueIdentifier, data.id).input('invoice', driver.Int, data.facturaId)
              .input('name', driver.NVarChar(110), data.nombre).input('mime', driver.VarChar(20), data.contentType)
              .input('bytes', driver.Int, data.bytes).input('sha', driver.Char(64), data.sha256)
              .input('user', driver.Int, data.usuarioId).input('key', driver.UniqueIdentifier, key)
              .query(`INSERT INTO jm.factura_adjunto(id,factura_id,nombre,content_type,bytes,sha256,usuario_id,clave)
                VALUES (@id,@invoice,@name,@mime,@bytes,@sha,@user,@key);`);
            return requireRow(data.id);
          },
          async finalizar(id) {
            const result = await tx.request().input('id', driver.UniqueIdentifier, id).query(`UPDATE jm.factura_adjunto
              SET estado='LISTO' WHERE id=@id AND estado='PENDIENTE' AND NOT (${expired});`);
            if (result.rowsAffected[0] !== 1) throw new PurchaseError('ATTACHMENT_EXPIRED', 'La carga caducó antes de finalizar.');
            return requireRow(id);
          },
          async eliminar(id) {
            const result = await tx.request().input('id', driver.UniqueIdentifier, id).query(`UPDATE jm.factura_adjunto
              SET estado='ELIMINADO' WHERE id=@id AND estado='PENDIENTE' AND ${expired};`);
            if (result.rowsAffected[0] !== 1) throw new Error('El adjunto ya no admite limpieza.');
          },
          async listar(invoiceId) {
            return (await tx.request().input('invoice', driver.Int, invoiceId)
              .query<StoredAttachment>(`SELECT TOP (5) ${columns} FROM jm.factura_adjunto
                WHERE factura_id=@invoice AND estado<>'ELIMINADO' ORDER BY creado_en,id;`)).recordset;
          },
          async caducados() {
            return (await tx.request().query<StoredAttachment>(`SELECT TOP (25) ${columns} FROM jm.factura_adjunto
              WHERE estado='PENDIENTE' AND ${expired} ORDER BY creado_en,id;`)).recordset;
          },
        },
      });
    });
  }
}
