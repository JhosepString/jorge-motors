import type { NombreEstadoAlerta } from '../domain/alerta.js';
import type { ProductoInventario, UsuarioInventario } from '../../inventario/application/contracts.js';

export interface AlertaPersistida {
  id: number;
  estado: NombreEstadoAlerta;
}
export interface AlertaRepository {
  buscarAbierta(productoId: number): Promise<AlertaPersistida | undefined>;
  crear(event: StockCambiado): Promise<AlertaPersistida>;
  atender(id: number, esperado: NombreEstadoAlerta): Promise<void>;
}
export interface StockCambiado {
  movimientoId: number | null;
  stockActual: number;
  producto: Readonly<ProductoInventario>;
  usuario: Readonly<UsuarioInventario>;
  requestId: string;
  httpStatus: 200 | 201;
}
export interface OutboxRepository {
  encolar(alertaId: number, event: StockCambiado): Promise<void>;
  cancelarNoAceptada(alertaId: number): Promise<void>;
}
