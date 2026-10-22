import { Alerta, requiereAlerta } from '../domain/alerta.js';
import type { StockCambiado } from './contracts.js';
import type { Repositories } from '../../inventario/application/contracts.js';
import type { TransactionalObserver } from '../../../shared/transactional-publisher.js';

export class StockAlertObserver implements TransactionalObserver<StockCambiado, Repositories> {
  async actualizar(event: Readonly<StockCambiado>, repositories: Repositories): Promise<void> {
    const { producto, stockActual, usuario, requestId } = event;
    const abierta = await repositories.alertas.buscarAbierta(producto.id);
    const bajo = requiereAlerta(stockActual, producto.stockMinimo);
    if (bajo && !abierta) {
      const alerta = await repositories.alertas.crear(event);
      // Outbox: pendiente durable en la misma transacción que movimiento y alerta.
      // Nunca se llama a SMTP/ACS ni a servicios externos desde este suscriptor.
      await repositories.outbox.encolar(alerta.id, event);
      await repositories.auditoria.registrar({
        requestId, action: 'ALERTA_CREADA', result: 'EXITO', userId: usuario.id,
        tenantId: usuario.entraTenantId, objectId: usuario.entraObjectId,
        entityId: String(alerta.id), code: 'LOW_STOCK_ALERT_CREATED', httpStatus: event.httpStatus,
        before: null, after: { estado: alerta.estado, stock: stockActual },
      });
    } else if (!bajo && abierta) {
      const alerta = new Alerta(abierta.estado);
      alerta.atender();
      await repositories.alertas.atender(abierta.id, abierta.estado);
      await repositories.outbox.cancelarNoAceptada(abierta.id);
      await repositories.auditoria.registrar({
        requestId, action: 'ALERTA_ATENDIDA', result: 'EXITO', userId: usuario.id,
        tenantId: usuario.entraTenantId, objectId: usuario.entraObjectId,
        entityId: String(abierta.id), code: event.movimientoId === null ? 'CATALOG_THRESHOLD_RESOLVED' : 'STOCK_REPLENISHED', httpStatus: event.httpStatus,
        before: { estado: abierta.estado }, after: { estado: alerta.estado, stock: stockActual },
      });
    }
  }
}
