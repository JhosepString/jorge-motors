import { InventoryError } from './inventory-error.js';

export type TipoMovimiento = 'ENTRADA' | 'SALIDA';
export const MAX_STOCK = 2_147_483_647;

// Regla pura del dominio: no depende de Express, SQL, Azure ni de un ORM.
export function calcularStock(actual: number, cantidad: number, tipo: TipoMovimiento): number {
  if (!Number.isInteger(actual) || actual < 0 || actual > MAX_STOCK) {
    throw new InventoryError('INVALID_STOCK', 'El stock actual es inválido.');
  }
  if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > MAX_STOCK) {
    throw new InventoryError('INVALID_QUANTITY', 'La cantidad debe ser un entero positivo válido.');
  }
  if (tipo !== 'ENTRADA' && tipo !== 'SALIDA') {
    throw new InventoryError('INVALID_MOVEMENT_TYPE', 'Tipo de movimiento inválido.');
  }
  const resultado = tipo === 'ENTRADA' ? actual + cantidad : actual - cantidad;
  if (resultado < 0) throw new InventoryError('INSUFFICIENT_STOCK', 'Stock insuficiente.');
  if (resultado > MAX_STOCK) throw new InventoryError('STOCK_LIMIT_EXCEEDED', 'Se excede el máximo de unidades.');
  return resultado;
}
