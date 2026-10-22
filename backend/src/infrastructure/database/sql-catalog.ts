import type sql from 'mssql';
import type { CatalogRepositories, CatalogUnitOfWork, Categoria, ProductoCatalogo, ProductoEditable, ProductoNuevo } from '../../modules/catalogo/application/contracts.js';
import { CatalogError } from '../../modules/catalogo/domain/catalog-error.js';
import type { SqlConnection, SqlDriver } from './sql-pool.js';
import { inventoryRepositories } from './sql-inventory.js';
import { withSqlTransaction } from './sql-transaction.js';

// ROWVERSION requiere cast explícito a binary antes de representar sus 8 bytes en hexadecimal.
const categoryColumns = 'CONVERT(int,id) AS id, nombre, CONVERT(varchar(16),CONVERT(binary(8),version),2) AS version';
const productColumns = `CONVERT(int,p.id) AS id, p.sku, p.nombre, p.categoria_id AS categoriaId,
  p.stock_minimo AS stockMinimo, CONVERT(varchar(30),p.precio_compra) AS precioCompra,
  p.activo, s.cantidad_actual AS stockActual,
  CONVERT(varchar(16),CONVERT(binary(8),p.version),2)+CONVERT(varchar(16),CONVERT(binary(8),s.version),2) AS version`;
function productParameters(request: sql.Request, driver: SqlDriver, data: ProductoEditable) {
  return request.input('name', driver.NVarChar(150), data.nombre).input('category', driver.Int, data.categoriaId)
    .input('minimum', driver.Int, data.stockMinimo).input('price', driver.NVarChar(19), data.precioCompra);
}
function catalogRepositories(transaction: sql.Transaction, driver: SqlDriver): CatalogRepositories {
  return {
    inventario: inventoryRepositories(transaction, driver),
    categorias: {
      async obtener(id, bloquear = false) {
        const result = await transaction.request().input('id', driver.Int, id)
          .query<Categoria>(`SELECT ${categoryColumns} FROM jm.categoria WITH (${bloquear ? 'UPDLOCK,HOLDLOCK' : 'HOLDLOCK'}) WHERE id=@id;`);
        return result.recordset[0];
      },
      async listar(after, limit) {
        return (await transaction.request().input('after', driver.Int, after).input('limit', driver.Int, limit)
          .query<Categoria>(`SELECT TOP (@limit) ${categoryColumns} FROM jm.categoria WHERE id>@after ORDER BY id;`)).recordset;
      },
      async crear(nombre) {
        const result = await transaction.request().input('name', driver.NVarChar(100), nombre)
          .query<Categoria>(`INSERT INTO jm.categoria(nombre) VALUES (@name);
            SELECT ${categoryColumns} FROM jm.categoria WHERE id=CONVERT(int,SCOPE_IDENTITY());`);
        if (!result.recordset[0]) throw new Error('Categoría no persistida.');
        return result.recordset[0];
      },
      async actualizar(id, nombre, version) {
        const result = await transaction.request().input('id', driver.Int, id).input('name', driver.NVarChar(100), nombre)
          .input('version', driver.VarChar(16), version)
          .query<Categoria>(`UPDATE jm.categoria SET nombre=@name WHERE id=@id AND version=CONVERT(binary(8),@version,2);
            IF @@ROWCOUNT=0 THROW 51015, 'La versión cambió.', 1;
            SELECT ${categoryColumns} FROM jm.categoria WHERE id=@id;`);
        if (!result.recordset[0]) throw new Error('Categoría no actualizada.');
        return result.recordset[0];
      },
    },
    productos: {
      async obtener(id, bloquear) {
        const locks = bloquear ? ' WITH (UPDLOCK,HOLDLOCK)' : '';
        const result = await transaction.request().input('id', driver.Int, id)
          .query<ProductoCatalogo>(`SELECT ${productColumns} FROM jm.producto p${locks}
            JOIN jm.stock s${locks} ON s.producto_id=p.id WHERE p.id=@id;`);
        return result.recordset[0];
      },
      async listar(after, limit) {
        return (await transaction.request().input('after', driver.Int, after).input('limit', driver.Int, limit)
          .query<ProductoCatalogo>(`SELECT TOP (@limit) ${productColumns} FROM jm.producto p
            JOIN jm.stock s ON s.producto_id=p.id WHERE p.id>@after ORDER BY p.id;`)).recordset;
      },
      async crear(data: ProductoNuevo) {
        const result = await productParameters(transaction.request(), driver, data).input('sku', driver.VarChar(40), data.sku)
          .query<ProductoCatalogo>(`INSERT INTO jm.producto(sku,nombre,categoria_id,stock_minimo,precio_compra)
            VALUES (@sku,@name,@category,@minimum,CONVERT(decimal(18,2),@price));
            DECLARE @id int=CONVERT(int,SCOPE_IDENTITY());
            INSERT INTO jm.stock(producto_id,cantidad_actual) VALUES (@id,0);
            SELECT ${productColumns} FROM jm.producto p JOIN jm.stock s ON s.producto_id=p.id WHERE p.id=@id;`);
        if (!result.recordset[0]) throw new Error('Producto no persistido.');
        return result.recordset[0];
      },
      async actualizar(id, data, version) {
        const result = await productParameters(transaction.request(), driver, data)
          .input('id', driver.Int, id).input('version', driver.VarChar(32), version)
          .query<ProductoCatalogo>(`UPDATE jm.producto SET nombre=@name,categoria_id=@category,
            stock_minimo=@minimum,precio_compra=CONVERT(decimal(18,2),@price)
            WHERE id=@id AND version=CONVERT(binary(8),LEFT(@version,16),2)
              AND EXISTS (SELECT 1 FROM jm.stock WHERE producto_id=@id AND version=CONVERT(binary(8),RIGHT(@version,16),2));
            IF @@ROWCOUNT=0 THROW 51015, 'La versión cambió.', 1;
            SELECT ${productColumns} FROM jm.producto p JOIN jm.stock s ON s.producto_id=p.id WHERE p.id=@id;`);
        if (!result.recordset[0]) throw new Error('Producto no actualizado.');
        return result.recordset[0];
      },
    },
  };
}

export class SqlCatalogUnitOfWork implements CatalogUnitOfWork {
  constructor(private readonly connection: SqlConnection) {}
  async ejecutar<T>(operation: (repositories: CatalogRepositories) => Promise<T>): Promise<T> {
    try {
      return await withSqlTransaction(this.connection, (transaction) => operation(catalogRepositories(transaction, this.connection.driver)));
    } catch (error) {
      const preceding = error && typeof error === 'object' && 'precedingErrors' in error && Array.isArray(error.precedingErrors)
        ? error.precedingErrors : [];
      const numbers = [error, ...preceding].map((item: unknown) => item && typeof item === 'object' && 'number' in item ? item.number : undefined);
      if (numbers.includes(2601) || numbers.includes(2627)) throw new CatalogError('CATALOG_DUPLICATE', 'El nombre de categoría o SKU ya está registrado.');
      if (numbers.includes(51015)) throw new CatalogError('STALE_VERSION', 'Otro cambio modificó el registro. Consulte la versión vigente.');
      throw error;
    }
  }
}
