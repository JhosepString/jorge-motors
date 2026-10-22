import type { TipoMovimiento } from '../domain/stock.js';
import type { AuditRepository } from '../../auditoria/application/contracts.js';
import type { AlertaRepository, OutboxRepository } from '../../alertas/application/contracts.js';

export interface UsuarioInventario {
  id: number;
  rol: 'ADMINISTRADOR' | 'MECANICO';
  activo: boolean;
  entraTenantId: string;
  entraObjectId: string;
}

export interface ProductoInventario {
  id: number;
  activo: boolean;
  stockActual: number;
  stockMinimo: number;
  sku: string;
  nombre: string;
}

export interface Movimiento {
  id: number;
  productoId: number;
  usuarioId: number;
  tipo: TipoMovimiento;
  cantidad: number;
  stockAnterior: number;
  stockResultante: number;
  motivo: string;
  referencia: string | null;
  claveIdempotencia: string;
  requestHash: string;
  fecha: Date;
}

export type NuevoMovimiento = Omit<Movimiento, 'id' | 'fecha'>;

// Repository: los casos de uso conocen contratos, no consultas ni tipos SQL.
export interface UsuarioRepository {
  obtener(id: number): Promise<UsuarioInventario | undefined>;
}
export interface ProductoRepository {
  obtenerParaMovimiento(id: number): Promise<ProductoInventario | undefined>;
}
export interface StockRepository {
  actualizarCondicional(productoId: number, anterior: number, resultante: number): Promise<boolean>;
}
export interface MovimientoRepository {
  bloquearClave(usuarioId: number, clave: string): Promise<void>;
  buscarPorClave(usuarioId: number, clave: string): Promise<Movimiento | undefined>;
  crear(movimiento: NuevoMovimiento): Promise<Movimiento>;
}
export interface Repositories {
  usuarios: UsuarioRepository;
  productos: ProductoRepository;
  stock: StockRepository;
  movimientos: MovimientoRepository;
  auditoria: AuditRepository;
  alertas: AlertaRepository;
  outbox: OutboxRepository;
}
export interface InventoryUnitOfWork {
  ejecutar<T>(operation: (repositories: Repositories) => Promise<T>): Promise<T>;
}
