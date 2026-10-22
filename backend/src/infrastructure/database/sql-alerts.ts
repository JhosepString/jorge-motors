import type sql from 'mssql';
import type { SqlDriver } from './sql-pool.js';
import type { AlertaPersistida, AlertaRepository, OutboxRepository, StockCambiado } from '../../modules/alertas/application/contracts.js';
import type { NombreEstadoAlerta } from '../../modules/alertas/domain/alerta.js';

export class SqlAlertaRepository implements AlertaRepository {
  constructor(private readonly transaction: sql.Transaction, private readonly driver: SqlDriver) {}

  async buscarAbierta(productoId: number): Promise<AlertaPersistida | undefined> {
    // La UoW ya bloqueó producto/stock. Mantener el mismo orden en futuros workers.
    const result = await this.transaction.request().input('product', this.driver.Int, productoId)
      .query<AlertaPersistida>(`SELECT CONVERT(int, id) AS id, estado FROM jm.alerta WITH (UPDLOCK, HOLDLOCK)
        WHERE producto_id = @product AND estado <> 'ATENDIDA';`);
    return result.recordset[0];
  }

  async crear(event: StockCambiado): Promise<AlertaPersistida> {
    const result = await this.transaction.request()
      .input('product', this.driver.Int, event.producto.id)
      .input('movement', this.driver.Int, event.movimientoId)
      .input('stock', this.driver.Int, event.stockActual)
      .input('minimum', this.driver.Int, event.producto.stockMinimo)
      .query<AlertaPersistida>(`INSERT INTO jm.alerta(producto_id, movimiento_origen_id, stock_detectado, stock_minimo)
        VALUES (@product, @movement, @stock, @minimum);
        SELECT CONVERT(int, id) AS id, estado FROM jm.alerta WHERE id = CONVERT(int, SCOPE_IDENTITY());`);
    if (!result.recordset[0]) throw new Error('No se pudo guardar la alerta.');
    return result.recordset[0];
  }

  async atender(id: number, esperado: NombreEstadoAlerta): Promise<void> {
    const result = await this.transaction.request().input('id', this.driver.Int, id)
      .input('expected', this.driver.VarChar(10), esperado)
      .query(`UPDATE jm.alerta SET estado = 'ATENDIDA', atendida_en = SYSUTCDATETIME()
        WHERE id = @id AND estado = @expected AND estado <> 'ATENDIDA';`);
    if (result.rowsAffected[0] !== 1) throw new Error('La alerta cambió de estado.');
  }
}

export class SqlOutboxRepository implements OutboxRepository {
  constructor(private readonly transaction: sql.Transaction, private readonly driver: SqlDriver) {}

  async encolar(alertaId: number, event: StockCambiado): Promise<void> {
    const payload = JSON.stringify({
      alertaId, productoId: event.producto.id, movimientoId: event.movimientoId,
      sku: event.producto.sku, nombre: event.producto.nombre,
      stock: event.stockActual, minimo: event.producto.stockMinimo,
      ...(event.movimientoId === null ? { origen: 'CATALOGO' } : {}),
    });
    await this.transaction.request().input('alert', this.driver.Int, alertaId)
      .input('payload', this.driver.NVarChar(2000), payload)
      .input('version', this.driver.Int, event.movimientoId === null ? 2 : 1)
      .query(`INSERT INTO jm.notificacion_outbox(alerta_id, tipo, payload, version_payload)
        VALUES (@alert, 'ALERTA_STOCK_BAJO', @payload, @version);`);
  }

  async cancelarNoAceptada(alertaId: number): Promise<void> {
    await this.transaction.request().input('alert', this.driver.Int, alertaId)
      .query(`UPDATE jm.notificacion_outbox SET estado = 'CANCELADA', actualizada_en = SYSUTCDATETIME(),
        lease_token = NULL, lease_hasta = NULL
        WHERE alerta_id = @alert AND estado IN ('PENDIENTE', 'PROCESANDO', 'AGOTADA');`);
  }
}
