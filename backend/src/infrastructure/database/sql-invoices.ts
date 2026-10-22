import type sql from 'mssql';
import type { SqlConnection, SqlDriver } from './sql-pool.js';
import { withSqlTransaction } from './sql-transaction.js';
import { inventoryRepositories } from './sql-inventory.js';
import { supplierRepositories } from './sql-suppliers.js';
import { PurchaseError } from '../../modules/compras/domain/purchase-error.js';
import type { InvoiceLine, InvoiceRepositories, InvoiceSummary, InvoiceUnitOfWork, StoredInvoice } from '../../modules/compras/application/invoice-contracts.js';

const columns = `CONVERT(int,id) AS id,proveedor_id AS proveedorId,proveedor_codigo AS proveedorCodigo,
  proveedor_nombre AS proveedorNombre,numero,CONVERT(varchar(10),fecha,23) AS fecha,moneda,
  CONVERT(varchar(30),total) AS total,estado,usuario_creacion_id AS usuarioCreacionId,
  usuario_recepcion_id AS usuarioRecepcionId,recibida_en AS recibidaEn,
  CONVERT(varchar(16),CONVERT(binary(8),version),2) AS version`;
type Header = Omit<StoredInvoice, 'lineas'>;
function invoiceRepositories(tx: sql.Transaction, driver: SqlDriver): InvoiceRepositories {
  async function get(id: number, lock = true): Promise<StoredInvoice | undefined> {
    // HOLDLOCK conserva cabecera y detalles coherentes incluso con RCSI.
    const header = (await tx.request().input('id', driver.Int, id).query<Header>(`SELECT ${columns},
      CONVERT(varchar(36),clave_recepcion) AS claveRecepcion,version_confirmacion AS versionConfirmacion
      FROM jm.factura_compra WITH (${lock ? 'UPDLOCK,HOLDLOCK' : 'HOLDLOCK'}) WHERE id=@id;`)).recordset[0];
    if (!header) return undefined;
    const lines = await tx.request().input('id', driver.Int, id).query<InvoiceLine>(`SELECT producto_id AS productoId,
      sku,nombre,cantidad,CONVERT(varchar(30),precio_unitario) AS precioUnitario,CONVERT(varchar(30),importe) AS importe,
      CONVERT(varchar(36),clave_movimiento) AS claveMovimiento,movimiento_id AS movimientoId
      FROM jm.factura_compra_linea WHERE factura_id=@id ORDER BY producto_id;`);
    return { ...header, lineas: lines.recordset };
  }
  async function required(id: number) {
    const row = await get(id);
    if (!row) throw new Error('Factura no persistida.');
    return row;
  }
  async function insertLines(id: number, lines: InvoiceLine[]) {
    for (const line of lines) {
      await tx.request().input('id', driver.Int, id).input('product', driver.Int, line.productoId)
        .input('sku', driver.VarChar(40), line.sku).input('name', driver.NVarChar(150), line.nombre)
        .input('quantity', driver.Int, line.cantidad).input('price', driver.VarChar(19), line.precioUnitario)
        .input('amount', driver.VarChar(19), line.importe).input('key', driver.UniqueIdentifier, line.claveMovimiento)
        .query(`INSERT INTO jm.factura_compra_linea(factura_id,producto_id,sku,nombre,cantidad,precio_unitario,importe,clave_movimiento)
          VALUES (@id,@product,@sku,@name,@quantity,CONVERT(decimal(18,2),@price),CONVERT(decimal(18,2),@amount),@key);`);
    }
  }
  return {
    inventario: inventoryRepositories(tx, driver), proveedores: supplierRepositories(tx, driver).proveedores,
    facturas: {
      obtener: get,
      async listar(after, limit) {
        return (await tx.request().input('after', driver.Int, after).input('limit', driver.Int, limit)
          .query<InvoiceSummary>(`SELECT TOP (@limit) ${columns} FROM jm.factura_compra WHERE id>@after ORDER BY id;`)).recordset;
      },
      async crear(data) {
        const result = await tx.request().input('supplier', driver.Int, data.proveedorId)
          .input('code', driver.VarChar(40), data.proveedorCodigo).input('name', driver.NVarChar(150), data.proveedorNombre)
          .input('number', driver.VarChar(40), data.numero).input('date', driver.VarChar(10), data.fecha)
          .input('total', driver.VarChar(19), data.total).input('user', driver.Int, data.usuarioCreacionId)
          .query<{ id: number }>(`INSERT INTO jm.factura_compra(proveedor_id,proveedor_codigo,proveedor_nombre,numero,fecha,total,usuario_creacion_id)
            VALUES (@supplier,@code,@name,@number,CONVERT(date,@date,23),CONVERT(decimal(18,2),@total),@user);
            SELECT CONVERT(int,SCOPE_IDENTITY()) AS id;`);
        const id = result.recordset[0]?.id;
        if (!id) throw new Error('Factura no persistida.');
        await insertLines(id, data.lineas); return required(id);
      },
      async editar(id, fecha, total, lineas, version) {
        await tx.request().input('id', driver.Int, id).input('date', driver.VarChar(10), fecha)
          .input('total', driver.VarChar(19), total).input('version', driver.Char(16), version)
          .query(`UPDATE jm.factura_compra SET fecha=CONVERT(date,@date,23),total=CONVERT(decimal(18,2),@total)
            WHERE id=@id AND estado='BORRADOR' AND version=CONVERT(binary(8),@version,2);
            IF @@ROWCOUNT=0 THROW 51017,'La versión de la factura cambió.',1;
            DELETE FROM jm.factura_compra_linea WHERE factura_id=@id;`);
        await insertLines(id, lineas); return required(id);
      },
      async anular(id, version) {
        await tx.request().input('id', driver.Int, id).input('version', driver.Char(16), version)
          .query(`UPDATE jm.factura_compra SET estado='ANULADA' WHERE id=@id AND estado='BORRADOR'
            AND version=CONVERT(binary(8),@version,2);
            IF @@ROWCOUNT=0 THROW 51017,'La versión de la factura cambió.',1;`);
        return required(id);
      },
      async bloquearClave(userId, key) {
        const result = await tx.request().input('resource', driver.NVarChar(255), `jm:recepcion:${userId}:${key}`)
          .query<{ result: number }>(`DECLARE @result int;
            EXEC @result=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
            SELECT @result AS result;`);
        if ((result.recordset[0]?.result ?? -999) < 0) throw new Error('No se obtuvo el bloqueo de recepción.');
      },
      async buscarClave(userId, key) {
        return (await tx.request().input('user', driver.Int, userId).input('key', driver.UniqueIdentifier, key)
          .query<{ id: number }>(`SELECT CONVERT(int,id) AS id FROM jm.factura_compra
            WHERE usuario_recepcion_id=@user AND clave_recepcion=@key;`)).recordset[0]?.id;
      },
      async vincularMovimiento(id, productoId, movimientoId) {
        const result = await tx.request().input('id', driver.Int, id).input('product', driver.Int, productoId)
          .input('movement', driver.Int, movimientoId)
          .query(`UPDATE jm.factura_compra_linea SET movimiento_id=@movement
            WHERE factura_id=@id AND producto_id=@product AND movimiento_id IS NULL;`);
        if (result.rowsAffected[0] !== 1) throw new Error('Detalle no vinculado al movimiento.');
      },
      async recibir(id, version, userId, key) {
        await tx.request().input('id', driver.Int, id).input('version', driver.Char(16), version)
          .input('user', driver.Int, userId).input('key', driver.UniqueIdentifier, key)
          .query(`UPDATE jm.factura_compra SET estado='RECIBIDA',usuario_recepcion_id=@user,
            recibida_en=CONVERT(datetime2(3),SYSUTCDATETIME()),clave_recepcion=@key,version_confirmacion=@version
            WHERE id=@id AND estado='BORRADOR' AND version=CONVERT(binary(8),@version,2);
            IF @@ROWCOUNT=0 THROW 51017,'La versión de la factura cambió.',1;`);
        return required(id);
      },
    },
  };
}
export class SqlInvoiceUnitOfWork implements InvoiceUnitOfWork {
  constructor(private readonly connection: SqlConnection) {}
  async ejecutar<T>(operation: (repos: InvoiceRepositories) => Promise<T>): Promise<T> {
    try {
      return await withSqlTransaction(this.connection, (tx) => operation(invoiceRepositories(tx, this.connection.driver)));
    } catch (error) {
      const preceding = error && typeof error === 'object' && 'precedingErrors' in error && Array.isArray(error.precedingErrors)
        ? error.precedingErrors : [];
      const numbers = [error, ...preceding].map((item: unknown) => item && typeof item === 'object' && 'number' in item ? item.number : undefined);
      if (numbers.includes(2601) || numbers.includes(2627)) throw new PurchaseError('INVOICE_DUPLICATE', 'Documento o clave de compra ya registrado.');
      if (numbers.includes(51017)) throw new PurchaseError('STALE_VERSION', 'Otro cambio modificó la factura. Consulte su versión vigente.');
      throw error;
    }
  }
}
