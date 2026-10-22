import type { SqlConnection } from './sql-pool.js';
import { withSqlTransaction } from './sql-transaction.js';
import { inventoryRepositories } from './sql-inventory.js';
import type { InventoryReportRow, ReportRepositories, ReportUnitOfWork } from '../../modules/reportes/application/inventory-report.js';

export class SqlReportUnitOfWork implements ReportUnitOfWork {
  constructor(private readonly connection: SqlConnection) {}
  ejecutar<T>(operation: (repos: ReportRepositories) => Promise<T>): Promise<T> {
    return withSqlTransaction(this.connection, async (tx) => {
      const driver = this.connection.driver; const repos = inventoryRepositories(tx, driver);
      return operation({ usuarios: repos.usuarios, auditoria: repos.auditoria, inventario: {
        async leer(filter) {
          // Lectura serializable de las tablas consultadas, sin exigir RCSI en la base.
          // Solo 1001 filas para detectar exceso; nunca devolver un truncado silencioso.
          return (await tx.request().input('category', driver.Int, filter.categoriaId ?? null)
            .input('inactive', driver.Bit, filter.incluirInactivos).input('low', driver.Bit, filter.soloBajoMinimo)
            .query<InventoryReportRow>(`SELECT TOP (1001) CONVERT(int,p.id) AS id,p.sku,p.nombre,
              p.categoria_id AS categoriaId,c.nombre AS categoria,s.cantidad_actual AS stockActual,
              p.stock_minimo AS stockMinimo,CONVERT(varchar(30),p.precio_compra) AS precioCompra,p.activo
              FROM jm.producto p WITH (HOLDLOCK) JOIN jm.stock s WITH (HOLDLOCK) ON s.producto_id=p.id
              JOIN jm.categoria c WITH (HOLDLOCK) ON c.id=p.categoria_id
              WHERE (@category IS NULL OR p.categoria_id=@category) AND (@inactive=1 OR p.activo=1)
                AND (@low=0 OR (p.activo=1 AND s.cantidad_actual<=p.stock_minimo)) ORDER BY p.id;`)).recordset;
        },
      } });
    });
  }
}
