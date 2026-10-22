import type { ReadUnitOfWork, ReadRepositories, StockView, MovementView } from '../../modules/inventario/application/inventory-read.js';
import type { SqlConnection } from './sql-pool.js';
import { inventoryRepositories } from './sql-inventory.js';
import { withSqlTransaction } from './sql-transaction.js';
export class SqlInventoryReadUnitOfWork implements ReadUnitOfWork {
  constructor(private readonly connection: SqlConnection) {}
  ejecutar<T>(operation: (repos: ReadRepositories) => Promise<T>): Promise<T> {
    return withSqlTransaction(this.connection, async (tx) => {
      const d = this.connection.driver; const shared = inventoryRepositories(tx, d);
      return operation({ usuarios: shared.usuarios, auditoria: shared.auditoria,
        async stock(f) {
          return (await tx.request().input('after', d.Int, f.despuesDe).input('limit', d.Int, f.limite + 1)
            .input('search', d.NVarChar(100), f.buscar).input('category', d.Int, f.categoriaId ?? null).input('status', d.VarChar(20), f.estado)
            .query<StockView>(`SELECT TOP (@limit) CONVERT(int,p.id) AS id,p.sku,p.nombre,p.categoria_id AS categoriaId,
              c.nombre AS categoria,s.cantidad_actual AS stockActual,p.stock_minimo AS stockMinimo
              FROM jm.producto p JOIN jm.stock s ON s.producto_id=p.id JOIN jm.categoria c ON c.id=p.categoria_id
              WHERE p.activo=1 AND p.id>@after AND (@category IS NULL OR p.categoria_id=@category)
              AND (@search=N'' OR CHARINDEX(@search,p.nombre)>0 OR CHARINDEX(@search,p.sku)>0 OR CHARINDEX(@search,c.nombre)>0)
              AND (@status='TODOS' OR (@status='AGOTADO' AND s.cantidad_actual=0)
                OR (@status='BAJO_MINIMO' AND s.cantidad_actual<=p.stock_minimo)
                OR (@status='NORMAL' AND s.cantidad_actual>p.stock_minimo)) ORDER BY p.id;`)).recordset;
        },
        async movimientos(f, ownUser) {
          return (await tx.request().input('after', d.Int, f.despuesDe).input('limit', d.Int, f.limite + 1)
            .input('product', d.Int, f.productoId ?? null).input('own', d.Int, ownUser)
            .query<MovementView>(`SELECT TOP (@limit) CONVERT(int,m.id) AS id,m.producto_id AS productoId,p.sku,p.nombre,
              m.usuario_id AS usuarioId,m.tipo,m.cantidad,m.stock_anterior AS stockAnterior,m.stock_resultante AS stockResultante,
              m.motivo,m.referencia,m.fecha FROM jm.movimiento m JOIN jm.producto p ON p.id=m.producto_id
              WHERE m.id>@after AND (@product IS NULL OR m.producto_id=@product) AND (@own IS NULL OR m.usuario_id=@own)
              ORDER BY m.id;`)).recordset;
        },
        async categorias(after, limit) {
          return (await tx.request().input('after', d.Int, after).input('limit', d.Int, limit)
            .query<{ id: number; nombre: string }>('SELECT TOP (@limit) CONVERT(int,id) AS id,nombre FROM jm.categoria WHERE id>@after ORDER BY id;')).recordset;
        },
      });
    });
  }
}
