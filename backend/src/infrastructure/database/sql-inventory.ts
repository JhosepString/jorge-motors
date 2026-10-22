import type sql from 'mssql';
import type {
  InventoryUnitOfWork, Movimiento, MovimientoRepository, NuevoMovimiento,
  ProductoInventario, Repositories, UsuarioInventario,
} from '../../modules/inventario/application/contracts.js';
import type { SqlConnection, SqlDriver } from './sql-pool.js';
import { SqlAuditRepository } from './sql-audit.js';
import { SqlAlertaRepository, SqlOutboxRepository } from './sql-alerts.js';
import { withSqlTransaction } from './sql-transaction.js';

// Normalizar IDENTITY a int: el driver ODBC puede devolverlo como string.
const movementColumns = `CONVERT(int, id) AS id, producto_id AS productoId, usuario_id AS usuarioId, tipo, cantidad,
  stock_anterior AS stockAnterior, stock_resultante AS stockResultante, motivo, referencia,
  CONVERT(varchar(36), clave_idempotencia) AS claveIdempotencia, request_hash AS requestHash, fecha`;

class SqlMovimientoRepository implements MovimientoRepository {
  constructor(private readonly transaction: sql.Transaction, private readonly driver: SqlDriver) {}

  async bloquearClave(usuarioId: number, clave: string): Promise<void> {
    const result = await this.transaction.request()
      .input('resource', this.driver.NVarChar(255), `jm:movimiento:${usuarioId}:${clave}`)
      .query<{ result: number }>(`DECLARE @result int;
        EXEC @result = sys.sp_getapplock @Resource = @resource,
          @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;
        SELECT @result AS result;`);
    if ((result.recordset[0]?.result ?? -999) < 0) throw new Error('No se obtuvo el bloqueo de idempotencia.');
  }

  async buscarPorClave(usuarioId: number, clave: string): Promise<Movimiento | undefined> {
    const result = await this.transaction.request()
      .input('user', this.driver.Int, usuarioId)
      .input('key', this.driver.UniqueIdentifier, clave)
      .query<Movimiento>(`SELECT ${movementColumns} FROM jm.movimiento
        WHERE usuario_id = @user AND clave_idempotencia = @key;`);
    return result.recordset[0];
  }

  async crear(movimiento: NuevoMovimiento): Promise<Movimiento> {
    const result = await this.transaction.request()
      .input('product', this.driver.Int, movimiento.productoId)
      .input('user', this.driver.Int, movimiento.usuarioId)
      .input('type', this.driver.VarChar(7), movimiento.tipo)
      .input('quantity', this.driver.Int, movimiento.cantidad)
      .input('before', this.driver.Int, movimiento.stockAnterior)
      .input('after', this.driver.Int, movimiento.stockResultante)
      .input('reason', this.driver.NVarChar(300), movimiento.motivo)
      .input('reference', this.driver.NVarChar(120), movimiento.referencia)
      .input('key', this.driver.UniqueIdentifier, movimiento.claveIdempotencia)
      .input('hash', this.driver.Char(64), movimiento.requestHash)
      .query<Movimiento>(`INSERT INTO jm.movimiento
        (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante,
         motivo, referencia, clave_idempotencia, request_hash)
        VALUES (@product, @user, @type, @quantity, @before, @after, @reason, @reference, @key, @hash);
        SELECT ${movementColumns} FROM jm.movimiento WHERE id = CONVERT(int, SCOPE_IDENTITY());`);
    const row = result.recordset[0];
    if (!row) throw new Error('El movimiento no fue persistido.');
    return row;
  }
}

export function inventoryRepositories(transaction: sql.Transaction, driver: SqlDriver): Repositories {
  return {
    usuarios: {
      async obtener(id) {
        const result = await transaction.request().input('id', driver.Int, id)
          .query<UsuarioInventario>(`SELECT CONVERT(int, id) AS id, rol, activo,
            CONVERT(varchar(36), entra_tenant_id) AS entraTenantId,
            CONVERT(varchar(36), entra_object_id) AS entraObjectId FROM jm.usuario WHERE id = @id;`);
        return result.recordset[0];
      },
    },
    productos: {
      async obtenerParaMovimiento(id) {
        const result = await transaction.request().input('id', driver.Int, id)
          .query<ProductoInventario>(`SELECT CONVERT(int, p.id) AS id, p.activo, s.cantidad_actual AS stockActual,
            p.stock_minimo AS stockMinimo, p.sku, p.nombre
            FROM jm.producto AS p WITH (UPDLOCK, HOLDLOCK)
            JOIN jm.stock AS s WITH (UPDLOCK, HOLDLOCK) ON s.producto_id = p.id
            WHERE p.id = @id;`);
        return result.recordset[0];
      },
    },
    stock: {
      async actualizarCondicional(productoId, anterior, resultante) {
        const result = await transaction.request()
          .input('product', driver.Int, productoId).input('before', driver.Int, anterior)
          .input('after', driver.Int, resultante)
          .query(`UPDATE jm.stock SET cantidad_actual = @after, ultima_actualizacion = SYSUTCDATETIME()
            WHERE producto_id = @product AND cantidad_actual = @before AND @after >= 0;`);
        return result.rowsAffected[0] === 1;
      },
    },
    movimientos: new SqlMovimientoRepository(transaction, driver),
    auditoria: new SqlAuditRepository(transaction, driver),
    alertas: new SqlAlertaRepository(transaction, driver),
    outbox: new SqlOutboxRepository(transaction, driver),
  };
}

export class SqlInventoryUnitOfWork implements InventoryUnitOfWork {
  constructor(private readonly connection: SqlConnection) {}

  async ejecutar<T>(operation: (repositories: Repositories) => Promise<T>): Promise<T> {
    return withSqlTransaction(this.connection, (transaction) => operation(inventoryRepositories(transaction, this.connection.driver)));
  }
}
