import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { UserProfile } from '../../modules/auth/application/contracts.js';
import { InventoryError } from '../../modules/inventario/domain/inventory-error.js';
import { registrarMovimientoEnTransaccion } from '../../modules/inventario/application/inventario.facade.js';
import { inventoryEvents } from '../inventory-events.js';
import type { SqlConnection } from './sql-pool.js';
import { withSqlTransaction } from './sql-transaction.js';
import { inventoryRepositories } from './sql-inventory.js';

const movement = z.object({ productId: z.number().int().positive(), type: z.enum(['ENTRADA', 'SALIDA']),
  quantity: z.number().int().positive().max(2_147_483_647), reason: z.string().trim().min(1).max(300),
  reference: z.string().trim().min(1).max(120).nullable(), idempotencyKey: z.uuid() }).strict();
export const syncInput = z.object({ operationId: z.uuid(), deviceId: z.uuid(),
  kind: z.literal('INVENTORY_MOVEMENT'), payload: movement }).strict();
export type SyncInput = z.infer<typeof syncInput>;
export const quotaInput = z.object({ allocationId: z.uuid(), deviceId: z.uuid(), productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(2_147_483_647) }).strict();
export const bootstrapInput = z.object({ deviceId: z.uuid(), after: z.number().int().min(0).max(2_147_483_647),
  limit: z.number().int().min(1).max(100) }).strict();

export class SqlSyncService {
  constructor(private readonly connection: SqlConnection) {}

  async bootstrap(input: z.infer<typeof bootstrapInput>, actor: UserProfile) {
    const parsed = bootstrapInput.parse(input);
    if (!actor.activo) throw new InventoryError('USER_NOT_ACTIVE', 'Usuario inactivo.');
    return withSqlTransaction(this.connection, async (tx) => {
      const d = this.connection.driver;
      const rows = await tx.request().input('device', d.UniqueIdentifier, parsed.deviceId)
        .input('after', d.Int, parsed.after).input('limit', d.Int, parsed.limit + 1)
        .query<{ id: number; categoryId: number; categoryName: string; sku: string; name: string;
          active: boolean; stockMinimum: number; confirmedStock: number; offlineQuota: number }>(`
          SELECT TOP (@limit) CONVERT(int,p.id) AS id,CONVERT(int,p.categoria_id) AS categoryId,
            c.nombre AS categoryName,p.sku,p.nombre AS name,p.activo AS active,
            p.stock_minimo AS stockMinimum,s.cantidad_actual AS confirmedStock,
            COALESCE(q.restante,0) AS offlineQuota
          FROM jm.producto p JOIN jm.categoria c ON c.id=p.categoria_id
            JOIN jm.stock s ON s.producto_id=p.id
            LEFT JOIN jm.cupo_dispositivo q ON q.producto_id=p.id AND q.device_id=@device
          WHERE p.id>@after ORDER BY p.id;`);
      const hasMore = rows.recordset.length > parsed.limit;
      const products = rows.recordset.slice(0, parsed.limit);
      return { deviceId: parsed.deviceId, user: { id: actor.id, tenantId: actor.entraTenantId,
        objectId: actor.entraObjectId, name: actor.nombres, role: actor.rol, active: actor.activo },
        products, nextAfter: hasMore ? products.at(-1)!.id : null };
    });
  }

  async assignQuota(input: z.infer<typeof quotaInput>, actor: UserProfile, requestId = randomUUID()): Promise<number> {
    const parsed = quotaInput.parse(input);
    if (!actor.activo || actor.rol !== 'ADMINISTRADOR') throw new InventoryError('FORBIDDEN_MOVEMENT', 'Solo un administrador asigna cupos.');
    return withSqlTransaction(this.connection, async (tx) => {
      const d = this.connection.driver; const repos = inventoryRepositories(tx, d);
      const registered = await tx.request().input('device', d.UniqueIdentifier, parsed.deviceId)
        .input('tenant', d.UniqueIdentifier, actor.entraTenantId)
        .query<{ active: boolean }>(`SELECT activo AS active FROM jm.dispositivo_registrado WITH (UPDLOCK,HOLDLOCK)
          WHERE device_id=@device AND tenant_id=@tenant;`);
      if (!registered.recordset[0]?.active)
        throw new InventoryError('DEVICE_NOT_REGISTERED', 'El equipo no está habilitado.');
      const prior = await tx.request().input('allocation', d.UniqueIdentifier, parsed.allocationId)
        .query<{ device_id: string; producto_id: number; cantidad: number; restante_resultante: number }>(`SELECT
          CONVERT(varchar(36),device_id) AS device_id, producto_id,cantidad,restante_resultante
          FROM jm.cupo_asignacion WITH (UPDLOCK,HOLDLOCK) WHERE allocation_id=@allocation;`);
      if (prior.recordset[0]) {
        const row = prior.recordset[0];
        if (row.device_id.toLowerCase() !== parsed.deviceId.toLowerCase() || row.producto_id !== parsed.productId ||
          row.cantidad !== parsed.quantity) throw new InventoryError('IDEMPOTENCY_CONFLICT', 'La asignación ya tiene otros datos.');
        return row.restante_resultante;
      }
      const product = await repos.productos.obtenerParaMovimiento(parsed.productId);
      if (!product?.activo) throw new InventoryError('PRODUCT_NOT_ACTIVE', 'Producto no disponible.');
      const reserved = await tx.request().input('product', d.Int, parsed.productId)
        .query<{ total: number }>(`SELECT COALESCE(SUM(CONVERT(bigint,restante)),0) AS total
          FROM jm.cupo_dispositivo WHERE producto_id=@product;`);
      if (product.stockActual - Number(reserved.recordset[0]!.total) < parsed.quantity)
        throw new InventoryError('INSUFFICIENT_STOCK', 'No hay stock libre para asignar ese cupo.');
      await tx.request().input('device', d.UniqueIdentifier, parsed.deviceId).input('product', d.Int, parsed.productId)
        .input('quantity', d.Int, parsed.quantity).query(`UPDATE jm.cupo_dispositivo
          SET restante=restante+@quantity, actualizado_en=SYSUTCDATETIME()
          WHERE device_id=@device AND producto_id=@product;
          IF @@ROWCOUNT=0 INSERT INTO jm.cupo_dispositivo(device_id,producto_id,restante)
            VALUES (@device,@product,@quantity);`);
      const current = await tx.request().input('device', d.UniqueIdentifier, parsed.deviceId)
        .input('product', d.Int, parsed.productId)
        .query<{ restante: number }>('SELECT restante FROM jm.cupo_dispositivo WHERE device_id=@device AND producto_id=@product;');
      const remaining = current.recordset[0]!.restante;
      await tx.request().input('allocation', d.UniqueIdentifier, parsed.allocationId)
        .input('device', d.UniqueIdentifier, parsed.deviceId).input('product', d.Int, parsed.productId)
        .input('quantity', d.Int, parsed.quantity).input('remaining', d.Int, remaining)
        .query(`INSERT INTO jm.cupo_asignacion(allocation_id,device_id,producto_id,cantidad,restante_resultante)
          VALUES (@allocation,@device,@product,@quantity,@remaining);`);
      await repos.auditoria.registrar({ requestId, action: 'CUPO_ASIGNADO', result: 'EXITO', userId: actor.id,
        tenantId: actor.entraTenantId, objectId: actor.entraObjectId, entityId: String(parsed.productId),
        code: 'OFFLINE_QUOTA_ASSIGNED', httpStatus: 201, before: null,
        after: { quantity: parsed.quantity, remaining, deviceId: parsed.deviceId } });
      return remaining;
    });
  }

  async accept(input: SyncInput, actor: UserProfile, requestId = randomUUID()) {
    const parsed = syncInput.parse(input);
    if (!actor.activo) throw new InventoryError('USER_NOT_ACTIVE', 'Usuario inactivo.');
    if (parsed.payload.type === 'ENTRADA' && actor.rol !== 'ADMINISTRADOR')
      throw new InventoryError('FORBIDDEN_MOVEMENT', 'Solo un administrador registra entradas.');
    const hash = createHash('sha256').update(JSON.stringify([actor.id, parsed.deviceId, parsed.kind, parsed.payload])).digest('hex');
    return withSqlTransaction(this.connection, async (tx) => {
      const d = this.connection.driver; const repos = inventoryRepositories(tx, d);
      const receipt = await tx.request().input('operation', d.UniqueIdentifier, parsed.operationId)
        .query<{ request_hash: string; movimiento_id: number }>(`SELECT request_hash,movimiento_id FROM jm.sync_receipt
          WITH (UPDLOCK,HOLDLOCK) WHERE operation_id=@operation;`);
      const previous = receipt.recordset[0];
      if (previous) {
        if (previous.request_hash !== hash) throw new InventoryError('IDEMPOTENCY_CONFLICT', 'La operación ya tiene otro contenido.');
        return { operationId: parsed.operationId, status: 'CONFIRMED' as const, remoteId: previous.movimiento_id };
      }
      await repos.movimientos.bloquearClave(actor.id, parsed.payload.idempotencyKey);
      if (await repos.movimientos.buscarPorClave(actor.id, parsed.payload.idempotencyKey))
        throw new InventoryError('IDEMPOTENCY_CONFLICT', 'La clave ya pertenece a otro movimiento.');
      const product = await repos.productos.obtenerParaMovimiento(parsed.payload.productId);
      if (!product?.activo) throw new InventoryError('PRODUCT_NOT_ACTIVE', 'Producto no disponible.');
      if (parsed.payload.type === 'SALIDA') {
        const quota = await tx.request().input('device', d.UniqueIdentifier, parsed.deviceId)
          .input('product', d.Int, parsed.payload.productId).input('quantity', d.Int, parsed.payload.quantity)
          .query(`UPDATE jm.cupo_dispositivo SET restante=restante-@quantity, actualizado_en=SYSUTCDATETIME()
            WHERE device_id=@device AND producto_id=@product AND restante>=@quantity;`);
        if (quota.rowsAffected[0] !== 1) throw new InventoryError('NO_OFFLINE_QUOTA', 'El equipo no tiene cupo suficiente.');
      }
      const result = await registrarMovimientoEnTransaccion({ productoId: parsed.payload.productId,
        cantidad: parsed.payload.quantity, motivo: parsed.payload.reason,
        ...(parsed.payload.reference ? { referencia: parsed.payload.reference } : {}),
        claveIdempotencia: parsed.payload.idempotencyKey }, actor, parsed.payload.type, repos, inventoryEvents(), requestId);
      if (result.repetido) throw new InventoryError('IDEMPOTENCY_CONFLICT', 'La clave ya pertenece a otro movimiento.');
      await tx.request().input('operation', d.UniqueIdentifier, parsed.operationId)
        .input('device', d.UniqueIdentifier, parsed.deviceId).input('user', d.Int, actor.id)
        .input('hash', d.Char(64), hash).input('movement', d.Int, result.movimiento.id)
        .query(`INSERT INTO jm.sync_receipt(operation_id,device_id,usuario_id,request_hash,movimiento_id)
          VALUES (@operation,@device,@user,@hash,@movement);`);
      return { operationId: parsed.operationId, status: 'CONFIRMED' as const, remoteId: result.movimiento.id };
    });
  }
}
