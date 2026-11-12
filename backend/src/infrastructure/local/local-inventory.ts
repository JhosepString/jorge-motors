import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { InventoryError } from '../../modules/inventario/domain/inventory-error.js';
import { calcularStock } from '../../modules/inventario/domain/stock.js';

// The installed app supplies a path inside its per-user data directory.
// Never place the database next to the executable: updates replace that directory.
const migrations = [{ version: 1, sql: `
CREATE TABLE local_user (
  id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, object_id TEXT NOT NULL,
  name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('ADMINISTRADOR','MECANICO')),
  active INTEGER NOT NULL CHECK(active IN (0,1)), UNIQUE(tenant_id, object_id)
);
CREATE TABLE category (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE product (
  id INTEGER PRIMARY KEY, category_id INTEGER NOT NULL REFERENCES category(id),
  sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)),
  stock_minimum INTEGER NOT NULL CHECK(stock_minimum >= 0),
  confirmed_stock INTEGER NOT NULL CHECK(confirmed_stock >= 0),
  offline_quota INTEGER NOT NULL DEFAULT 0 CHECK(offline_quota >= 0)
);
CREATE TABLE local_movement (
  id TEXT PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES product(id),
  user_id INTEGER NOT NULL REFERENCES local_user(id),
  type TEXT NOT NULL CHECK(type IN ('ENTRADA','SALIDA')),
  quantity INTEGER NOT NULL CHECK(quantity > 0), reason TEXT NOT NULL,
  reference TEXT, idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL, created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','CONFIRMED','REJECTED')),
  remote_id INTEGER, UNIQUE(user_id, idempotency_key)
);
CREATE TRIGGER movement_no_update BEFORE UPDATE OF product_id,user_id,type,quantity,reason,reference,idempotency_key,request_hash,created_at
ON local_movement BEGIN SELECT RAISE(ABORT, 'movement is immutable'); END;
CREATE TRIGGER movement_no_delete BEFORE DELETE ON local_movement
BEGIN SELECT RAISE(ABORT, 'movement is immutable'); END;
CREATE TABLE sync_operation (
  operation_id TEXT PRIMARY KEY, device_id TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES local_user(id),
  kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','CONFIRMED','REJECTED')),
  error TEXT, remote_id INTEGER
);
CREATE INDEX sync_pending ON sync_operation(status, created_at);
CREATE TABLE sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE local_audit (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, action TEXT NOT NULL,
  entity_id TEXT NOT NULL, created_at TEXT NOT NULL
);
` }];

export interface CachedUser { id: number; tenantId: string; objectId: string; name: string; role: 'ADMINISTRADOR' | 'MECANICO'; active: boolean }
export interface CachedProduct { id: number; categoryId: number; sku: string; name: string; active: boolean; stockMinimum: number; confirmedStock: number; offlineQuota: number }
export interface LocalMovementInput { productId: number; userId: number; type: 'ENTRADA' | 'SALIDA'; quantity: number; reason: string; reference?: string; idempotencyKey: string }
export interface LocalMovementResult { id: string; repeated: boolean; status: 'PENDING' | 'CONFIRMED' | 'REJECTED' }
export interface PendingSyncOperation { operationId: string; deviceId: string; kind: string; payload: string }
const bootstrapPageSchema = z.object({ deviceId: z.uuid(), user: z.object({ id: z.number().int().positive(),
  tenantId: z.uuid(), objectId: z.uuid(), name: z.string().min(1),
  role: z.enum(['ADMINISTRADOR', 'MECANICO']), active: z.boolean() }),
  products: z.array(z.object({ id: z.number().int().positive(), categoryId: z.number().int().positive(),
    categoryName: z.string().min(1), sku: z.string().min(1), name: z.string().min(1),
    active: z.boolean(), stockMinimum: z.number().int().min(0), confirmedStock: z.number().int().min(0),
    offlineQuota: z.number().int().min(0) })).max(100),
  nextAfter: z.number().int().positive().nullable() });

export class LocalInventoryStore {
  readonly db: DatabaseSync;

  constructor(filePath: string, readonly deviceId: string) {
    if (!filePath || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId))
      throw new Error('Local database path and UUID device ID are required.');
    mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    try {
      this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
      this.migrate();
      const bound = this.db.prepare("SELECT value FROM sync_state WHERE key='device_id'").get() as { value: string } | undefined;
      if (bound && bound.value !== deviceId) throw new Error('Local database belongs to another device.');
      if (!bound) this.db.prepare("INSERT INTO sync_state(key,value) VALUES ('device_id',?)").run(deviceId);
    } catch (error) { this.db.close(); throw error; }
  }

  close(): void { this.db.close(); }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS local_migration (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)');
    for (const migration of migrations) {
      const checksum = createHash('sha256').update(migration.sql).digest('hex');
      const existing = this.db.prepare('SELECT checksum FROM local_migration WHERE version = ?').get(migration.version) as { checksum: string } | undefined;
      if (existing) {
        if (existing.checksum !== checksum) throw new Error(`Local migration ${migration.version} has changed.`);
        continue;
      }
      this.transaction(() => {
        this.db.exec(migration.sql);
        this.db.prepare('INSERT INTO local_migration(version, checksum) VALUES (?, ?)').run(migration.version, checksum);
      });
    }
  }

  // Only trusted initial download/sync code may hydrate these caches. The UI must not call them directly.
  cacheUser(user: CachedUser): void {
    this.db.prepare(`INSERT INTO local_user(id,tenant_id,object_id,name,role,active) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET tenant_id=excluded.tenant_id, object_id=excluded.object_id,
      name=excluded.name, role=excluded.role, active=excluded.active`).run(
      user.id, user.tenantId, user.objectId, user.name, user.role, Number(user.active));
  }

  cacheCategory(id: number, name: string): void {
    this.db.prepare('INSERT INTO category(id,name) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name').run(id, name);
  }

  cacheProduct(product: CachedProduct): void {
    const pending = this.db.prepare(`SELECT 1 FROM local_movement
      WHERE product_id=? AND type='SALIDA' AND status='PENDING' LIMIT 1`).get(product.id);
    if (pending) throw new Error('Cannot replace product quota while local exits are pending.');
    this.db.prepare(`INSERT INTO product(id,category_id,sku,name,active,stock_minimum,confirmed_stock,offline_quota)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id,
      sku=excluded.sku,name=excluded.name,active=excluded.active,stock_minimum=excluded.stock_minimum,
      confirmed_stock=excluded.confirmed_stock,offline_quota=excluded.offline_quota`).run(
      product.id, product.categoryId, product.sku, product.name, Number(product.active), product.stockMinimum,
      product.confirmedStock, product.offlineQuota);
  }

  bootstrapCursor(userId: number): number | null {
    const value = this.db.prepare('SELECT value FROM sync_state WHERE key=?')
      .get(`bootstrap:${userId}`) as { value: string } | undefined;
    return value?.value === 'complete' ? null : Number(value?.value ?? 0);
  }

  applyBootstrapPage(raw: unknown, userId: number, expectedAfter: number): void {
    const parsed = bootstrapPageSchema.parse(raw);
    if (parsed.deviceId !== this.deviceId || parsed.user.id !== userId || !parsed.user.active ||
      this.bootstrapCursor(userId) !== expectedAfter ||
      parsed.products.some((item, index) => item.id <= expectedAfter ||
        (index > 0 && item.id <= parsed.products[index - 1]!.id)) ||
      (parsed.nextAfter !== null && parsed.nextAfter !== parsed.products.at(-1)?.id)) {
      throw new Error('Invalid or stale bootstrap page.');
    }
    this.transaction(() => {
      this.cacheUser(parsed.user);
      for (const item of parsed.products) {
        this.cacheCategory(item.categoryId, item.categoryName);
        this.cacheProduct(item);
      }
      this.db.prepare('INSERT INTO sync_state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .run(`bootstrap:${userId}`, parsed.nextAfter === null ? 'complete' : String(parsed.nextAfter));
    });
  }

  refreshCursor(userId: number): number | null {
    const value = this.db.prepare('SELECT value FROM sync_state WHERE key=?')
      .get(`refresh:${userId}`) as { value: string } | undefined;
    return value?.value === 'complete' ? null : Number(value?.value ?? 0);
  }

  beginRefresh(userId: number): void {
    if (this.bootstrapCursor(userId) !== null) throw new Error('Initial download is incomplete.');
    if (this.refreshCursor(userId) === null)
      this.db.prepare('UPDATE sync_state SET value=? WHERE key=?').run('0', `refresh:${userId}`);
  }

  applyRefreshPage(raw: unknown, userId: number, expectedAfter: number): void {
    const parsed = bootstrapPageSchema.parse(raw);
    if (this.bootstrapCursor(userId) !== null || parsed.deviceId !== this.deviceId ||
      parsed.user.id !== userId || !parsed.user.active || this.refreshCursor(userId) !== expectedAfter ||
      parsed.products.some((item, index) => item.id <= expectedAfter ||
        (index > 0 && item.id <= parsed.products[index - 1]!.id)) ||
      (parsed.nextAfter !== null && parsed.nextAfter !== parsed.products.at(-1)?.id))
      throw new Error('Invalid or stale refresh page.');
    this.transaction(() => {
      this.cacheUser(parsed.user);
      for (const item of parsed.products) {
        this.cacheCategory(item.categoryId, item.categoryName);
        const unsettled = this.db.prepare(`SELECT COALESCE(SUM(quantity),0) AS units FROM local_movement
          WHERE product_id=? AND type='SALIDA' AND status IN ('PENDING','REJECTED')`)
          .get(item.id) as { units: number };
        const quota = item.offlineQuota - unsettled.units;
        if (quota < 0) throw new Error('Cloud quota is lower than unsettled local exits.');
        this.db.prepare(`INSERT INTO product(id,category_id,sku,name,active,stock_minimum,confirmed_stock,offline_quota)
          VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id,
          sku=excluded.sku,name=excluded.name,active=excluded.active,stock_minimum=excluded.stock_minimum,
          confirmed_stock=excluded.confirmed_stock,offline_quota=excluded.offline_quota`).run(
          item.id, item.categoryId, item.sku, item.name, Number(item.active), item.stockMinimum,
          item.confirmedStock, quota);
      }
      this.db.prepare('INSERT INTO sync_state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .run(`refresh:${userId}`, parsed.nextAfter === null ? 'complete' : String(parsed.nextAfter));
      if (parsed.nextAfter === null) this.db.prepare(`INSERT INTO sync_state(key,value) VALUES (?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(`refreshed_at:${userId}`, new Date().toISOString());
    });
  }

  registerMovement(input: LocalMovementInput): LocalMovementResult {
    if (!Number.isInteger(input.userId) || input.userId <= 0 || !Number.isInteger(input.productId) || input.productId <= 0 ||
      !Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > 2_147_483_647 ||
      !input.reason.trim() || input.reason.length > 300 || (input.reference?.length ?? 0) > 120 ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(input.idempotencyKey)) {
      throw new InventoryError('INVALID_INPUT', 'Datos de movimiento no válidos.');
    }
    const key = input.idempotencyKey.toLowerCase();
    const reference = input.reference ?? null;
    const hash = createHash('sha256').update(JSON.stringify([
      input.userId, input.type, input.productId, input.quantity, input.reason, reference,
    ])).digest('hex');
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT id,request_hash,status FROM local_movement WHERE user_id=? AND idempotency_key=?')
        .get(input.userId, key) as { id: string; request_hash: string; status: string } | undefined;
      if (existing) {
        if (existing.request_hash !== hash) throw new InventoryError('IDEMPOTENCY_CONFLICT', 'La clave ya se usó con otros datos.');
        return { id: existing.id, repeated: true, status: existing.status as LocalMovementResult['status'] };
      }
      const user = this.db.prepare('SELECT role,active FROM local_user WHERE id=?').get(input.userId) as { role: string; active: number } | undefined;
      if (!user?.active) throw new InventoryError('USER_NOT_ACTIVE', 'Usuario local no habilitado.');
      if (input.type === 'ENTRADA' && user.role !== 'ADMINISTRADOR') throw new InventoryError('FORBIDDEN_MOVEMENT', 'Solo el administrador registra entradas.');
      if (input.type !== 'ENTRADA' && input.type !== 'SALIDA') throw new InventoryError('INVALID_MOVEMENT_TYPE', 'Tipo de movimiento inválido.');
      const product = this.db.prepare('SELECT active,offline_quota,sku FROM product WHERE id=?').get(input.productId) as { active: number; offline_quota: number; sku: string } | undefined;
      if (!product?.active) throw new InventoryError('PRODUCT_NOT_ACTIVE', 'Producto local no disponible.');
      if (input.type === 'SALIDA' && /^SIM-(HMA|HMO|DIA|ELEVA|TAL)-/.test(product.sku))
        throw new InventoryError('TOOL_LOAN_REQUIRED', 'Las herramientas requieren préstamo y devolución.');
      if (input.type === 'SALIDA') {
        calcularStock(product.offline_quota, input.quantity, 'SALIDA');
        this.db.prepare('UPDATE product SET offline_quota=offline_quota-? WHERE id=?').run(input.quantity, input.productId);
      }
      const id = randomUUID(); const createdAt = new Date().toISOString();
      this.db.prepare(`INSERT INTO local_movement(id,product_id,user_id,type,quantity,reason,reference,idempotency_key,request_hash,created_at,status)
        VALUES (?,?,?,?,?,?,?,?,?,?,'PENDING')`).run(id, input.productId, input.userId, input.type, input.quantity,
        input.reason, reference, key, hash, createdAt);
      this.db.prepare(`INSERT INTO sync_operation(operation_id,device_id,user_id,kind,payload,created_at,status)
        VALUES (?,?,?,?,?,?,'PENDING')`).run(id, this.deviceId, input.userId, 'INVENTORY_MOVEMENT', JSON.stringify({
        productId: input.productId, type: input.type, quantity: input.quantity, reason: input.reason,
        reference, idempotencyKey: key,
      }), createdAt);
      this.db.prepare('INSERT INTO local_audit(id,user_id,action,entity_id,created_at) VALUES (?,?,?,?,?)')
        .run(randomUUID(), input.userId, `INVENTORY_${input.type}`, id, createdAt);
      return { id, repeated: false, status: 'PENDING' };
    });
  }

  pendingOperations(userId: number, limit = 25): PendingSyncOperation[] {
    if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Invalid sync selection.');
    return this.db.prepare(`SELECT operation_id AS operationId,device_id AS deviceId,kind,payload
      FROM sync_operation WHERE status='PENDING' AND user_id=? ORDER BY created_at,operation_id LIMIT ?`)
      .all(userId, limit).map((row) => ({ operationId: String(row.operationId), deviceId: String(row.deviceId),
        kind: String(row.kind), payload: String(row.payload) }));
  }

  pendingCount(userId: number): number {
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('Invalid user ID.');
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM sync_operation WHERE status='PENDING' AND user_id=?")
      .get(userId) as { n: number }).n);
  }

  confirmOperation(operationId: string, remoteId: number): void {
    if (!Number.isInteger(remoteId) || remoteId <= 0) throw new Error('Invalid remote movement ID.');
    this.transaction(() => {
      const operation = this.db.prepare('SELECT status,remote_id FROM sync_operation WHERE operation_id=?')
        .get(operationId) as { status: string; remote_id: number | null } | undefined;
      if (!operation) throw new Error('Unknown local operation.');
      if (operation.status === 'CONFIRMED') {
        if (operation.remote_id !== remoteId) throw new Error('Conflicting remote receipt.');
        return;
      }
      if (operation.status !== 'PENDING') throw new Error('Rejected operation cannot be confirmed.');
      this.db.prepare(`UPDATE sync_operation SET status='CONFIRMED',remote_id=? WHERE operation_id=?`).run(remoteId, operationId);
      this.db.prepare(`UPDATE local_movement SET status='CONFIRMED',remote_id=? WHERE id=?`).run(remoteId, operationId);
    });
  }

  rejectOperation(operationId: string, code: string): void {
    if (!/^[A-Z][A-Z0-9_]{2,60}$/.test(code)) throw new Error('Invalid rejection code.');
    this.transaction(() => {
      const result = this.db.prepare(`UPDATE sync_operation SET status='REJECTED',error=?
        WHERE operation_id=? AND status='PENDING'`).run(code, operationId);
      if (result.changes !== 1) throw new Error('Pending operation not found.');
      this.db.prepare(`UPDATE local_movement SET status='REJECTED' WHERE id=?`).run(operationId);
      // Physical stock may already have left the workshop; do not restore quota automatically.
    });
  }
}
