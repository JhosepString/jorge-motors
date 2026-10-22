import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { InventoryError } from '../domain/inventory-error.js';
import { calcularStock, MAX_STOCK, type TipoMovimiento } from '../domain/stock.js';
import type { InventoryUnitOfWork, Movimiento, Repositories, UsuarioInventario } from './contracts.js';
import type { StockCambiado } from '../../alertas/application/contracts.js';
import type { TransactionalPublisher } from '../../../shared/transactional-publisher.js';

export const movimientoInputSchema = z.object({
  productoId: z.number().int().positive().max(MAX_STOCK),
  cantidad: z.number().int().positive().max(MAX_STOCK),
  motivo: z.string().trim().min(1).max(300),
  referencia: z.string().trim().min(1).max(120).optional(),
  claveIdempotencia: z.uuid().transform((value) => value.toLowerCase()),
}).strict();

export type MovimientoInput = z.input<typeof movimientoInputSchema>;
export interface ResultadoMovimiento { movimiento: Movimiento; repetido: boolean }

// Facade: una operación pública coordina permisos de negocio, repositorios,
// reglas del stock e historial dentro de una sola transacción.
export class InventarioFacade {
  constructor(
    private readonly unitOfWork: InventoryUnitOfWork,
    private readonly events: TransactionalPublisher<StockCambiado, Repositories>,
  ) {}

  registrarSalida(input: MovimientoInput, usuarioId: number, requestId = randomUUID()): Promise<ResultadoMovimiento> {
    return this.registrar(input, usuarioId, 'SALIDA', requestId);
  }

  registrarEntrada(input: MovimientoInput, usuarioId: number, requestId = randomUUID()): Promise<ResultadoMovimiento> {
    return this.registrar(input, usuarioId, 'ENTRADA', requestId);
  }

  private async registrar(input: MovimientoInput, usuarioId: number, tipo: TipoMovimiento, requestId: string): Promise<ResultadoMovimiento> {
    const parsed = movimientoInputSchema.safeParse(input);
    if (!parsed.success || !z.uuid().safeParse(requestId).success || !Number.isInteger(usuarioId) || usuarioId <= 0 || usuarioId > MAX_STOCK) {
      throw new InventoryError('INVALID_INPUT', 'Los datos del movimiento no son válidos.');
    }
    return this.unitOfWork.ejecutar(async (repositories) => {
      const usuario = await repositories.usuarios.obtener(usuarioId);
      if (!usuario?.activo) throw new InventoryError('USER_NOT_ACTIVE', 'El usuario no está habilitado.');
      return registrarMovimientoEnTransaccion(parsed.data, usuario, tipo, repositories, this.events, requestId);
    });
  }
}

// Operación compartida: NO abre otra transacción. Compras puede componer varias
// entradas, auditoría y alertas usando exactamente la misma Unit of Work.
export async function registrarMovimientoEnTransaccion(input: MovimientoInput, usuario: UsuarioInventario,
  tipo: TipoMovimiento, repositories: Repositories, events: TransactionalPublisher<StockCambiado, Repositories>,
  requestId: string): Promise<ResultadoMovimiento> {
  const parsed = movimientoInputSchema.safeParse(input);
  if (!parsed.success || !z.uuid().safeParse(requestId).success || !Number.isInteger(usuario.id) || usuario.id <= 0 || usuario.id > MAX_STOCK) {
    throw new InventoryError('INVALID_INPUT', 'Los datos del movimiento no son válidos.');
  }
  const data = parsed.data; const usuarioId = usuario.id;
  const referencia = data.referencia ?? null;
  const requestHash = createHash('sha256').update(JSON.stringify([
    usuarioId, tipo, data.productoId, data.cantidad, data.motivo, referencia,
  ])).digest('hex');
  if (!usuario.activo) throw new InventoryError('USER_NOT_ACTIVE', 'El usuario no está habilitado.');
  if (tipo === 'ENTRADA' && usuario.rol !== 'ADMINISTRADOR') {
    throw new InventoryError('FORBIDDEN_MOVEMENT', 'Solo el administrador puede registrar entradas.');
  }
  await repositories.movimientos.bloquearClave(usuarioId, data.claveIdempotencia);
  const existente = await repositories.movimientos.buscarPorClave(usuarioId, data.claveIdempotencia);
  if (existente) {
    if (existente.requestHash !== requestHash) {
      throw new InventoryError('IDEMPOTENCY_CONFLICT', 'La clave ya se usó con otros datos.');
    }
    await repositories.auditoria.registrar({
      requestId, action: 'MOVIMIENTO_REINTENTO', result: 'EXITO', userId: usuarioId,
      tenantId: usuario.entraTenantId, objectId: usuario.entraObjectId,
      entityId: String(existente.id), code: 'IDEMPOTENT_REPLAY', httpStatus: 200, before: null, after: null,
    });
    return { movimiento: existente, repetido: true };
  }
  const producto = await repositories.productos.obtenerParaMovimiento(data.productoId);
  if (!producto) throw new InventoryError('PRODUCT_NOT_FOUND', 'El producto o su stock no existe.');
  if (!producto.activo) throw new InventoryError('PRODUCT_NOT_ACTIVE', 'El producto está inactivo.');
  const resultante = calcularStock(producto.stockActual, data.cantidad, tipo);
  const actualizado = await repositories.stock.actualizarCondicional(producto.id, producto.stockActual, resultante);
  if (!actualizado) throw new InventoryError('STOCK_CONFLICT', 'El stock cambió; vuelva a consultar.');
  const movimiento = await repositories.movimientos.crear({
    productoId: producto.id, usuarioId, tipo, cantidad: data.cantidad,
    stockAnterior: producto.stockActual, stockResultante: resultante,
    motivo: data.motivo, referencia, claveIdempotencia: data.claveIdempotencia, requestHash,
  });
  // Auditoría de éxito en la MISMA transacción: si falla, no se confirma el movimiento.
  await repositories.auditoria.registrar({
    requestId, action: tipo === 'SALIDA' ? 'INVENTARIO_SALIDA' : 'INVENTARIO_ENTRADA',
    result: 'EXITO', userId: usuarioId, tenantId: usuario.entraTenantId, objectId: usuario.entraObjectId,
    entityId: String(movimiento.id), code: 'MOVEMENT_CREATED', httpStatus: 201,
    before: { stock: producto.stockActual }, after: { stock: resultante },
  });
  // Observer esperado antes de commit; un replay retorna antes sin publicar otra vez.
  await events.publicar({ movimientoId: movimiento.id, stockActual: resultante, producto, usuario, requestId, httpStatus: 201 }, repositories);
  return { movimiento, repetido: false };
}
