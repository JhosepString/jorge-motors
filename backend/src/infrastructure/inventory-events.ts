import { TransactionalPublisher } from '../shared/transactional-publisher.js';
import { StockAlertObserver } from '../modules/alertas/application/stock-alert.observer.js';
import type { StockCambiado } from '../modules/alertas/application/contracts.js';
import type { Repositories } from '../modules/inventario/application/contracts.js';

// Composición de suscriptores fuera de la Facade: el emisor no conoce alertas ni correo.
export function inventoryEvents() {
  const publisher = new TransactionalPublisher<StockCambiado, Repositories>();
  publisher.suscribir(new StockAlertObserver());
  return publisher;
}
