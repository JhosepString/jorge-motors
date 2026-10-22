import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PurchaseError } from '../domain/purchase-error.js';
import { calculateInvoice, invoiceCreateSchema, invoiceEditSchema, invoiceVersionSchema, requireDraft, type InvoiceEditInput } from '../domain/invoice.js';
import type { Invoice, InvoiceRepositories, InvoiceUnitOfWork, StoredInvoice } from './invoice-contracts.js';
import type { Repositories, UsuarioInventario } from '../../inventario/application/contracts.js';
import type { AuditEvent } from '../../auditoria/application/contracts.js';
import type { StockCambiado } from '../../alertas/application/contracts.js';
import type { TransactionalPublisher } from '../../../shared/transactional-publisher.js';
import { registrarMovimientoEnTransaccion } from '../../inventario/application/inventario.facade.js';

const idSchema = z.number().int().positive().max(2_147_483_647);
const pageSchema = z.object({ despuesDe: z.coerce.number().int().min(0).max(2_147_483_647).default(0),
  limite: z.coerce.number().int().min(1).max(100).default(25) }).strict();
function valid<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new PurchaseError('INVALID_INVOICE_INPUT', 'Revise los datos de la factura.');
  return parsed.data;
}
export function publicInvoice(row: StoredInvoice): Invoice {
  const { claveRecepcion: _key, versionConfirmacion: _version, ...invoice } = row;
  // La clave por línea queda interna: no puede usarse para fabricar movimientos desde HTTP.
  return { ...invoice, lineas: invoice.lineas.map((line) => {
    const { claveMovimiento: _movementKey, ...data } = line;
    return data;
  }) };
}
export class FacturasFacade {
  constructor(private readonly uow: InvoiceUnitOfWork, private readonly events: TransactionalPublisher<StockCambiado, Repositories>) {}
  private run<T>(userId: number, requestId: string,
    operation: (repos: InvoiceRepositories, actor: UsuarioInventario) => Promise<T>): Promise<T> {
    valid(idSchema, userId); valid(z.uuid(), requestId);
    return this.uow.ejecutar(async (repos) => {
      const actor = await repos.inventario.usuarios.obtener(userId);
      if (!actor?.activo || actor.rol !== 'ADMINISTRADOR') throw new PurchaseError('INVOICE_FORBIDDEN', 'Solo un administrador habilitado puede gestionar compras.');
      return operation(repos, actor);
    });
  }
  private audit(repos: InvoiceRepositories, actor: UsuarioInventario, requestId: string,
    action: AuditEvent['action'], row: StoredInvoice | null, status: 200 | 201, before: AuditEvent['before'] = null) {
    return repos.inventario.auditoria.registrar({ requestId, action, result: 'EXITO', userId: actor.id,
      tenantId: actor.entraTenantId, objectId: actor.entraObjectId, entityId: row ? String(row.id) : null,
      code: action, httpStatus: status, before, after: row ? {
        estado: row.estado, total: row.total, moneda: row.moneda, version: row.version, lineas: row.lineas.length,
        fecha: row.fecha, proveedorId: row.proveedorId, numero: row.numero,
      } : null });
  }
  private async lines(repos: InvoiceRepositories, data: InvoiceEditInput) {
    const amounts = calculateInvoice(data.lineas);
    const lineas = [];
    // Mismo orden para altas, ediciones y recepciones con productos compartidos.
    for (const line of [...amounts.lineas].sort((a, b) => a.productoId - b.productoId)) {
      const product = await repos.inventario.productos.obtenerParaMovimiento(line.productoId);
      if (!product) throw new PurchaseError('INVOICE_PRODUCT_NOT_FOUND', 'Un producto o su stock no existe.');
      if (!product.activo) throw new PurchaseError('INVOICE_PRODUCT_INACTIVE', 'Un producto está inactivo.');
      lineas.push({ ...line, sku: product.sku, nombre: product.nombre, claveMovimiento: randomUUID(), movimientoId: null });
    }
    return { total: amounts.total, lineas };
  }
  private async supplier(repos: InvoiceRepositories, id: number) {
    const supplier = await repos.proveedores.obtener(id, true);
    if (!supplier) throw new PurchaseError('SUPPLIER_NOT_FOUND', 'El proveedor no existe.');
    if (!supplier.activo) throw new PurchaseError('INVOICE_SUPPLIER_INACTIVE', 'El proveedor está inactivo.');
    return supplier;
  }
  async crear(input: unknown, userId: number, requestId: string) {
    const data = valid(invoiceCreateSchema, input); calculateInvoice(data.lineas);
    return this.run(userId, requestId, async (repos, actor) => {
      const supplier = await this.supplier(repos, data.proveedorId);
      const details = await this.lines(repos, data);
      const row = await repos.facturas.crear({ ...data, ...details, proveedorCodigo: supplier.codigo,
        proveedorNombre: supplier.razonSocial, usuarioCreacionId: actor.id });
      await this.audit(repos, actor, requestId, 'FACTURA_CREADA', row, 201);
      return publicInvoice(row);
    });
  }
  async obtener(id: number, userId: number, requestId: string) {
    valid(idSchema, id);
    return this.run(userId, requestId, async (repos, actor) => {
      const row = await repos.facturas.obtener(id, false);
      if (!row) throw new PurchaseError('INVOICE_NOT_FOUND', 'La factura no existe.');
      await this.audit(repos, actor, requestId, 'FACTURA_CONSULTADA', row, 200);
      return publicInvoice(row);
    });
  }
  async listar(query: unknown, userId: number, requestId: string) {
    const page = valid(pageSchema, query);
    return this.run(userId, requestId, async (repos, actor) => {
      const rows = await repos.facturas.listar(page.despuesDe, page.limite + 1);
      const data = rows.slice(0, page.limite);
      await this.audit(repos, actor, requestId, 'FACTURA_CONSULTADA', null, 200);
      return { data, siguiente: rows.length > page.limite ? data.at(-1)!.id : null };
    });
  }
  async editar(id: number, input: unknown, version: string, userId: number, requestId: string) {
    valid(idSchema, id); valid(invoiceVersionSchema, version);
    const data = valid(invoiceEditSchema, input); calculateInvoice(data.lineas);
    return this.run(userId, requestId, async (repos, actor) => {
      const previous = await repos.facturas.obtener(id, true);
      if (!previous) throw new PurchaseError('INVOICE_NOT_FOUND', 'La factura no existe.');
      requireDraft(previous.estado);
      if (previous.version !== version) throw new PurchaseError('STALE_VERSION', 'Consulte la versión vigente.');
      await this.supplier(repos, previous.proveedorId);
      const details = await this.lines(repos, data);
      const row = await repos.facturas.editar(id, data.fecha, details.total, details.lineas, version);
      // Los detalles editados se auditan individualmente, sin truncar JSON de 50 líneas.
      await this.auditLines(repos, actor, requestId, previous, row);
      await this.audit(repos, actor, requestId, 'FACTURA_ACTUALIZADA', row, 200,
        { fecha: previous.fecha, total: previous.total, version: previous.version, lineas: previous.lineas.length });
      return publicInvoice(row);
    });
  }
  private async auditLines(repos: InvoiceRepositories, actor: UsuarioInventario, requestId: string, previous: StoredInvoice, row: StoredInvoice) {
    const ids = new Set([...previous.lineas, ...row.lineas].map((line) => line.productoId));
    for (const id of ids) {
      const snapshot = (invoice: StoredInvoice) => {
        const line = invoice.lineas.find((item) => item.productoId === id);
        return line ? { productoId: id, cantidad: line.cantidad, precioUnitario: line.precioUnitario, importe: line.importe } : null;
      };
      await repos.inventario.auditoria.registrar({ requestId, action: 'FACTURA_DETALLE_CAMBIADO', result: 'EXITO',
        userId: actor.id, tenantId: actor.entraTenantId, objectId: actor.entraObjectId, entityId: String(row.id),
        code: 'FACTURA_DETALLE_CAMBIADO', httpStatus: 200, before: snapshot(previous), after: snapshot(row) });
    }
  }
  async anular(id: number, input: unknown, version: string, userId: number, requestId: string) {
    valid(idSchema, id); valid(invoiceVersionSchema, version); valid(z.object({}).strict(), input);
    return this.run(userId, requestId, async (repos, actor) => {
      const previous = await repos.facturas.obtener(id, true);
      if (!previous) throw new PurchaseError('INVOICE_NOT_FOUND', 'La factura no existe.');
      requireDraft(previous.estado);
      const row = await repos.facturas.anular(id, version);
      await this.audit(repos, actor, requestId, 'FACTURA_ANULADA', row, 200, { estado: previous.estado, version: previous.version });
      return publicInvoice(row);
    });
  }
  async confirmar(id: number, input: unknown, version: string, key: string, userId: number, requestId: string) {
    valid(idSchema, id); valid(invoiceVersionSchema, version); valid(z.object({}).strict(), input);
    const receiptKey = valid(z.uuid(), key).toLowerCase();
    return this.run(userId, requestId, async (repos, actor) => {
      await repos.facturas.bloquearClave(userId, receiptKey);
      const used = await repos.facturas.buscarClave(userId, receiptKey);
      if (used !== undefined && used !== id) throw new PurchaseError('IDEMPOTENCY_CONFLICT', 'La clave de recepción ya corresponde a otra factura.');
      const row = await repos.facturas.obtener(id, true);
      if (!row) throw new PurchaseError('INVOICE_NOT_FOUND', 'La factura no existe.');
      if (row.estado === 'RECIBIDA') {
        if (row.usuarioRecepcionId !== userId || row.claveRecepcion?.toLowerCase() !== receiptKey) {
          throw new PurchaseError('INVOICE_ALREADY_RECEIVED', 'La factura ya fue recibida. Consulte sus movimientos.');
        }
        if (row.versionConfirmacion !== version) throw new PurchaseError('IDEMPOTENCY_CONFLICT', 'El reintento debe conservar la versión original.');
        await this.audit(repos, actor, requestId, 'FACTURA_RECEPCION_REINTENTO', row, 200);
        return { factura: publicInvoice(row), repetido: true };
      }
      requireDraft(row.estado);
      if (row.version !== version) throw new PurchaseError('STALE_VERSION', 'Consulte la versión vigente.');
      await this.supplier(repos, row.proveedorId);
      for (const line of [...row.lineas].sort((a, b) => a.productoId - b.productoId)) {
        const result = await registrarMovimientoEnTransaccion({ productoId: line.productoId, cantidad: line.cantidad,
          motivo: 'Recepción de factura de compra', referencia: `FACTURA:${row.id}:${row.numero}`,
          claveIdempotencia: line.claveMovimiento }, actor, 'ENTRADA', repos.inventario, this.events, requestId);
        await repos.facturas.vincularMovimiento(id, line.productoId, result.movimiento.id);
      }
      const received = await repos.facturas.recibir(id, version, actor.id, receiptKey);
      await this.audit(repos, actor, requestId, 'FACTURA_RECIBIDA', received, 201, { estado: row.estado, version: row.version });
      return { factura: publicInvoice(received), repetido: false };
    });
  }
}
