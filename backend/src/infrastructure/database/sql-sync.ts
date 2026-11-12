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
  reference: z.string().trim().min(1).max(120).nullable(), idempotencyKey: z.uuid(),
  policyVersion: z.literal(2).optional() }).strict();
export const syncInput = z.object({ operationId: z.uuid(), deviceId: z.uuid(),
  kind: z.literal('INVENTORY_MOVEMENT'), payload: movement }).strict();
export type SyncInput = z.infer<typeof syncInput>;
export const quotaInput = z.object({ allocationId: z.uuid(), deviceId: z.uuid(), productId: z.number().int().positive(),
  quantity: z.number().int().positive().max(2_147_483_647), userId: z.number().int().positive().optional() }).strict();
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
        .input('user', d.Int, actor.id).input('role', d.VarChar(20), actor.rol)
        .input('after', d.Int, parsed.after).input('limit', d.Int, parsed.limit + 1)
        .query<{ id: number; categoryId: number; categoryName: string; sku: string; name: string;
          active: boolean; stockMinimum: number; confirmedStock: number; offlineQuota: number }>(`
          SELECT TOP (@limit) CONVERT(int,p.id) AS id,CONVERT(int,p.categoria_id) AS categoryId,
            c.nombre AS categoryName,p.sku,p.nombre AS name,p.activo AS active,
            p.stock_minimo AS stockMinimum,s.cantidad_actual AS confirmedStock,
            CONVERT(int,CASE WHEN @role='MECANICO' THEN COALESCE(u.restante,0)
              ELSE COALESCE(q.restante,0)-COALESCE(assigned.total,0) END) AS offlineQuota
          FROM jm.producto p JOIN jm.categoria c ON c.id=p.categoria_id
            JOIN jm.stock s ON s.producto_id=p.id
            LEFT JOIN jm.cupo_dispositivo q ON q.producto_id=p.id AND q.device_id=@device
            LEFT JOIN jm.cupo_usuario_dispositivo u ON u.producto_id=p.id AND u.device_id=@device AND u.usuario_id=@user
            OUTER APPLY (SELECT SUM(CONVERT(bigint,x.restante)) AS total FROM jm.cupo_usuario_dispositivo x
              WHERE x.producto_id=p.id AND x.device_id=@device) assigned
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
      if (parsed.userId) {
        const target = await tx.request().input('user', d.Int, parsed.userId)
          .input('tenant', d.UniqueIdentifier, actor.entraTenantId)
          .query<{ rol: string; activo: boolean }>(`SELECT rol,activo FROM jm.usuario
            WHERE id=@user AND entra_tenant_id=@tenant;`);
        if (!target.recordset[0]?.activo || target.recordset[0].rol !== 'MECANICO')
          throw new InventoryError('USER_NOT_ACTIVE', 'Seleccione un mecánico activo del directorio.');
      }
      const prior = await tx.request().input('allocation', d.UniqueIdentifier, parsed.allocationId)
        .query<{ device_id: string; producto_id: number; cantidad: number; restante_resultante: number; usuario_id: number | null }>(`SELECT
          CONVERT(varchar(36),device_id) AS device_id, producto_id,cantidad,restante_resultante,usuario_id
          FROM jm.cupo_asignacion WITH (UPDLOCK,HOLDLOCK) WHERE allocation_id=@allocation;`);
      if (prior.recordset[0]) {
        const row = prior.recordset[0];
        if (row.device_id.toLowerCase() !== parsed.deviceId.toLowerCase() || row.producto_id !== parsed.productId ||
          row.cantidad !== parsed.quantity || row.usuario_id !== (parsed.userId ?? null))
          throw new InventoryError('IDEMPOTENCY_CONFLICT', 'La asignación ya tiene otros datos.');
        return row.restante_resultante;
      }
      const product = await repos.productos.obtenerParaMovimiento(parsed.productId);
      if (!product?.activo) throw new InventoryError('PRODUCT_NOT_ACTIVE', 'Producto no disponible.');
      if (product.tipo === 'HERRAMIENTA')
        throw new InventoryError('TOOL_LOAN_REQUIRED', 'Las herramientas no usan cupos de consumo.');
      const userQuotas = await tx.request().input('product', d.Int, parsed.productId)
        .input('device', d.UniqueIdentifier, parsed.deviceId).input('user', d.Int, parsed.userId ?? null)
        .query<{ userTotal: number; userDeviceRemaining: number; deviceTotal: number; deviceReserved: number }>(`
          SELECT
            (SELECT COALESCE(SUM(CONVERT(bigint,restante)),0) FROM jm.cupo_usuario_dispositivo
              WHERE producto_id=@product AND usuario_id=@user) AS userTotal,
            (SELECT COALESCE(SUM(CONVERT(bigint,restante)),0) FROM jm.cupo_usuario_dispositivo
              WHERE producto_id=@product AND device_id=@device) AS deviceReserved,
            COALESCE((SELECT restante FROM jm.cupo_usuario_dispositivo
              WHERE producto_id=@product AND device_id=@device AND usuario_id=@user),0) AS userDeviceRemaining,
            COALESCE((SELECT restante FROM jm.cupo_dispositivo
              WHERE producto_id=@product AND device_id=@device),0) AS deviceTotal;`);
      const balances = userQuotas.recordset[0]!;
      if (parsed.userId && Number(balances.userTotal) + parsed.quantity > 20)
        throw new InventoryError('OFFLINE_MECHANIC_LIMIT', 'El mecánico solo puede reservar 20 unidades de cada producto entre todos sus equipos.');
      const freeOnDevice = balances.deviceTotal - balances.deviceReserved;
      const additionalReservation = parsed.userId ? Math.max(0, parsed.quantity - freeOnDevice) : parsed.quantity;
      const reserved = await tx.request().input('product', d.Int, parsed.productId)
        .query<{ total: number }>(`SELECT COALESCE(SUM(CONVERT(bigint,restante)),0) AS total
          FROM jm.cupo_dispositivo WHERE producto_id=@product;`);
      if (product.stockActual - Number(reserved.recordset[0]!.total) < additionalReservation)
        throw new InventoryError('INSUFFICIENT_STOCK', 'No hay stock libre para asignar ese cupo.');
      if (additionalReservation) await tx.request().input('device', d.UniqueIdentifier, parsed.deviceId)
        .input('product', d.Int, parsed.productId)
        .input('quantity', d.Int, additionalReservation).query(`UPDATE jm.cupo_dispositivo
          SET restante=restante+@quantity, actualizado_en=SYSUTCDATETIME()
          WHERE device_id=@device AND producto_id=@product;
          IF @@ROWCOUNT=0 INSERT INTO jm.cupo_dispositivo(device_id,producto_id,restante)
            VALUES (@device,@product,@quantity);`);
      if (parsed.userId) await tx.request().input('user', d.Int, parsed.userId)
        .input('device', d.UniqueIdentifier, parsed.deviceId).input('product', d.Int, parsed.productId)
        .input('quantity', d.Int, parsed.quantity).query(`UPDATE jm.cupo_usuario_dispositivo
          SET restante=restante+@quantity, actualizado_en=SYSUTCDATETIME()
          WHERE usuario_id=@user AND device_id=@device AND producto_id=@product;
          IF @@ROWCOUNT=0 INSERT INTO jm.cupo_usuario_dispositivo(usuario_id,device_id,producto_id,restante)
            VALUES (@user,@device,@product,@quantity);`);
      const remaining = parsed.userId ? balances.userDeviceRemaining + parsed.quantity
        : freeOnDevice + additionalReservation;
      await tx.request().input('allocation', d.UniqueIdentifier, parsed.allocationId)
        .input('device', d.UniqueIdentifier, parsed.deviceId).input('product', d.Int, parsed.productId)
        .input('quantity', d.Int, parsed.quantity).input('remaining', d.Int, remaining)
        .input('user', d.Int, parsed.userId ?? null)
        .query(`INSERT INTO jm.cupo_asignacion(allocation_id,device_id,producto_id,cantidad,restante_resultante,usuario_id)
          VALUES (@allocation,@device,@product,@quantity,@remaining,@user);`);
      await repos.auditoria.registrar({ requestId, action: 'CUPO_ASIGNADO', result: 'EXITO', userId: actor.id,
        tenantId: actor.entraTenantId, objectId: actor.entraObjectId, entityId: String(parsed.productId),
        code: 'OFFLINE_QUOTA_ASSIGNED', httpStatus: 201, before: null,
        after: { quantity: parsed.quantity, remaining, deviceId: parsed.deviceId, mechanicUserId: parsed.userId ?? null } });
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
        if (actor.rol === 'MECANICO' && parsed.payload.policyVersion === 2) {
          const personal = await tx.request().input('user', d.Int, actor.id)
            .input('device', d.UniqueIdentifier, parsed.deviceId)
            .input('product', d.Int, parsed.payload.productId).input('quantity', d.Int, parsed.payload.quantity)
            .query(`UPDATE jm.cupo_usuario_dispositivo SET restante=restante-@quantity,
              actualizado_en=SYSUTCDATETIME() WHERE usuario_id=@user AND device_id=@device
              AND producto_id=@product AND restante>=@quantity;`);
          if (personal.rowsAffected[0] !== 1)
            throw new InventoryError('NO_OFFLINE_QUOTA', 'El mecánico no tiene cupo personal suficiente en este equipo.');
        }
        const quota = await tx.request().input('device', d.UniqueIdentifier, parsed.deviceId)
          .input('product', d.Int, parsed.payload.productId).input('quantity', d.Int, parsed.payload.quantity)
          .input('admin', d.Bit, actor.rol === 'ADMINISTRADOR')
          .query(`UPDATE jm.cupo_dispositivo SET restante=restante-@quantity, actualizado_en=SYSUTCDATETIME()
            WHERE device_id=@device AND producto_id=@product AND restante>=@quantity
              AND (@admin=0 OR restante-@quantity >= (SELECT COALESCE(SUM(CONVERT(bigint,u.restante)),0)
                FROM jm.cupo_usuario_dispositivo u WHERE u.device_id=@device AND u.producto_id=@product));`);
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
