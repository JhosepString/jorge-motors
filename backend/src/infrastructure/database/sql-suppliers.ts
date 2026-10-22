import type sql from 'mssql';
import type { SqlConnection, SqlDriver } from './sql-pool.js';
import { withSqlTransaction } from './sql-transaction.js';
import { inventoryRepositories } from './sql-inventory.js';
import type { Proveedor, ProveedorNuevo, SupplierRepositories, SupplierUnitOfWork } from '../../modules/compras/application/contracts.js';
import { PurchaseError } from '../../modules/compras/domain/purchase-error.js';

const columns = `CONVERT(int,id) AS id,codigo,razon_social AS razonSocial,correo,activo,
  CONVERT(varchar(16),CONVERT(binary(8),version),2) AS version`;
function parameters(request: sql.Request, driver: SqlDriver, data: Omit<ProveedorNuevo, 'codigo'>) {
  return request.input('name', driver.NVarChar(150), data.razonSocial).input('email', driver.NVarChar(254), data.correo);
}
export function supplierRepositories(transaction: sql.Transaction, driver: SqlDriver): SupplierRepositories {
  const inventory = inventoryRepositories(transaction, driver);
  return {
    usuarios: inventory.usuarios, auditoria: inventory.auditoria,
    proveedores: {
      async obtener(id, bloquear) {
        return (await transaction.request().input('id', driver.Int, id)
          .query<Proveedor>(`SELECT ${columns} FROM jm.proveedor${bloquear ? ' WITH (UPDLOCK,HOLDLOCK)' : ''} WHERE id=@id;`)).recordset[0];
      },
      async listar(after, limit) {
        return (await transaction.request().input('after', driver.Int, after).input('limit', driver.Int, limit)
          .query<Proveedor>(`SELECT TOP (@limit) ${columns} FROM jm.proveedor WHERE id>@after ORDER BY id;`)).recordset;
      },
      async crear(data) {
        const result = await parameters(transaction.request(), driver, data).input('code', driver.VarChar(40), data.codigo)
          .query<Proveedor>(`INSERT INTO jm.proveedor(codigo,razon_social,correo) VALUES (@code,@name,@email);
            SELECT ${columns} FROM jm.proveedor WHERE id=CONVERT(int,SCOPE_IDENTITY());`);
        if (!result.recordset[0]) throw new Error('Proveedor no persistido.');
        return result.recordset[0];
      },
      async actualizar(id, data, version) {
        const result = await parameters(transaction.request(), driver, data).input('id', driver.Int, id)
          .input('active', driver.Bit, data.activo).input('version', driver.VarChar(16), version)
          .query<Proveedor>(`UPDATE jm.proveedor SET razon_social=@name,correo=@email,activo=@active
            WHERE id=@id AND version=CONVERT(binary(8),@version,2);
            IF @@ROWCOUNT=0 THROW 51016, 'La versión del proveedor cambió.', 1;
            SELECT ${columns} FROM jm.proveedor WHERE id=@id;`);
        if (!result.recordset[0]) throw new Error('Proveedor no actualizado.');
        return result.recordset[0];
      },
    },
  };
}
export class SqlSupplierUnitOfWork implements SupplierUnitOfWork {
  constructor(private readonly connection: SqlConnection) {}
  async ejecutar<T>(operation: (repos: SupplierRepositories) => Promise<T>): Promise<T> {
    try {
      return await withSqlTransaction(this.connection, (tx) => operation(supplierRepositories(tx, this.connection.driver)));
    } catch (error) {
      const preceding = error && typeof error === 'object' && 'precedingErrors' in error && Array.isArray(error.precedingErrors)
        ? error.precedingErrors : [];
      const numbers = [error, ...preceding].map((item: unknown) => item && typeof item === 'object' && 'number' in item ? item.number : undefined);
      if (numbers.includes(2601) || numbers.includes(2627)) throw new PurchaseError('SUPPLIER_DUPLICATE', 'El código de proveedor ya está registrado.');
      if (numbers.includes(51016)) throw new PurchaseError('STALE_VERSION', 'Otro cambio modificó el proveedor. Consulte la versión vigente.');
      throw error;
    }
  }
}
