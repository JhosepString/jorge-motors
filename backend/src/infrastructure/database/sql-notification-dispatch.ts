import { randomUUID } from 'node:crypto';
import type sql from 'mssql';
import type { SqlConnection } from './sql-pool.js';
import { SqlAuditRepository } from './sql-audit.js';
import { Alerta, type NombreEstadoAlerta } from '../../modules/alertas/domain/alerta.js';
import { MAX_NOTIFICATION_ATTEMPTS, NOTIFICATION_LEASE_SECONDS,
  type ClaimedNotification, type NotificationDispatchRepository, type NotificationErrorCode,
} from '../../modules/alertas/application/notification-worker.js';
import type { AuditEvent } from '../../modules/auditoria/application/contracts.js';

// Las columnas de disponibilidad y lease son datetime2(3). Comparar con un reloj
// de escala 7 puede ver un alta redondeada como futura dentro del mismo tick.
// Fragmento SQL fijo, nunca procedente de configuración ni de entradas del usuario.
export const OUTBOX_UTC_NOW_SQL = 'CONVERT(datetime2(3),SYSUTCDATETIME())';

export class SqlNotificationDispatch implements NotificationDispatchRepository {
  constructor(private readonly connection: SqlConnection) {}

  private async atomic<T>(operation: (transaction: sql.Transaction) => Promise<T>): Promise<T> {
    const { pool, driver } = this.connection;
    const transaction = new driver.Transaction(pool);
    let rolledBack = false;
    transaction.on('rollback', () => { rolledBack = true; });
    await transaction.begin(driver.ISOLATION_LEVEL.READ_COMMITTED);
    try {
      const result = await operation(transaction);
      await transaction.commit();
      return result;
    } catch (error) {
      if (!rolledBack) await transaction.rollback().catch(() => undefined);
      throw error;
    }
  }

  private audit(transaction: sql.Transaction, task: Pick<ClaimedNotification, 'id' | 'leaseToken'>,
    action: AuditEvent['action'], code: string, before: string, after: string) {
    return new SqlAuditRepository(transaction, this.connection.driver).registrar({
      requestId: task.leaseToken, action,
      result: ['NOTIFICACION_AGOTADA', 'NOTIFICACION_REINTENTO'].includes(action) ? 'ERROR' : 'EXITO',
      // Actor de servicio, no atribuir al empleado que originó el movimiento.
      userId: null, tenantId: null, objectId: null, entityId: task.id,
      code, httpStatus: 200, before: { estado: before }, after: { estado: after },
    });
  }

  async reclamar(): Promise<ClaimedNotification | undefined> {
    const { driver } = this.connection;
    return this.atomic(async (transaction) => {
      // Cola pequeña: serializar SOLO la reclamación corta, no el envío externo.
      // Funciona tanto con SQL local como con READ_COMMITTED_SNAPSHOT de Azure SQL.
      await transaction.request().query(`DECLARE @lock int;
        EXEC @lock = sys.sp_getapplock @Resource=N'jm:outbox:claim', @LockMode='Exclusive',
          @LockOwner='Transaction', @LockTimeout=10000;
        IF @lock < 0 THROW 51012, 'No se pudo reclamar Outbox.', 1;`);
      const expired = await transaction.request().input('max', driver.Int, MAX_NOTIFICATION_ATTEMPTS)
        .query<{ id: string }>(`SELECT TOP (100) CONVERT(varchar(36), id) AS id
          FROM jm.notificacion_outbox WITH (UPDLOCK, HOLDLOCK)
          WHERE estado='PROCESANDO' AND lease_hasta <= ${OUTBOX_UTC_NOW_SQL} AND intentos >= @max;`);
      for (const row of expired.recordset) {
        await transaction.request().input('id', driver.UniqueIdentifier, row.id)
          .query(`UPDATE jm.notificacion_outbox SET estado='AGOTADA', lease_token=NULL, lease_hasta=NULL,
            ultimo_error='LEASE_EXPIRED_LIMIT', actualizada_en=SYSUTCDATETIME() WHERE id=@id;`);
        await this.audit(transaction, { id: row.id, leaseToken: randomUUID() }, 'NOTIFICACION_AGOTADA',
          'LEASE_EXPIRED_LIMIT', 'PROCESANDO', 'AGOTADA');
      }
      const candidate = await transaction.request().input('max', driver.Int, MAX_NOTIFICATION_ATTEMPTS)
        .query<{ id: string; alertaId: number; intento: number; payload: string; estado: string; version: number }>(`SELECT TOP (1)
          CONVERT(varchar(36), id) AS id, alerta_id AS alertaId, intentos AS intento, payload, estado, version_payload AS version
          FROM jm.notificacion_outbox WITH (UPDLOCK, HOLDLOCK)
          WHERE intentos < @max AND ((estado='PENDIENTE' AND disponible_en <= ${OUTBOX_UTC_NOW_SQL})
            OR (estado='PROCESANDO' AND lease_hasta <= ${OUTBOX_UTC_NOW_SQL}))
          ORDER BY disponible_en, creada_en, id;`);
      const row = candidate.recordset[0];
      if (!row) return undefined;
      const task: ClaimedNotification = { id: row.id.toLowerCase(), alertaId: row.alertaId,
        intento: row.intento + 1, payload: row.payload, leaseToken: randomUUID(), version: row.version };
      await transaction.request().input('id', driver.UniqueIdentifier, task.id)
        .input('token', driver.UniqueIdentifier, task.leaseToken)
        .input('seconds', driver.Int, NOTIFICATION_LEASE_SECONDS)
        .query(`UPDATE jm.notificacion_outbox SET estado='PROCESANDO', intentos=intentos+1,
          lease_token=@token, lease_hasta=DATEADD(SECOND,@seconds,SYSUTCDATETIME()),
          actualizada_en=SYSUTCDATETIME() WHERE id=@id;`);
      await this.audit(transaction, task, 'NOTIFICACION_RECLAMADA',
        row.estado === 'PROCESANDO' ? 'LEASE_RECOVERED' : 'WORKER_CLAIMED', row.estado, 'PROCESANDO');
      return task;
    });
  }

  async vigente(task: ClaimedNotification): Promise<boolean> {
    const { driver } = this.connection;
    return this.atomic(async (transaction) => {
      const alert = await transaction.request().input('alert', driver.Int, task.alertaId)
        .query<{ estado: string }>('SELECT estado FROM jm.alerta WITH (UPDLOCK,HOLDLOCK) WHERE id=@alert;');
      if (alert.recordset[0]?.estado !== 'PENDIENTE') return false;
      const result = await transaction.request().input('id', driver.UniqueIdentifier, task.id)
        .input('token', driver.UniqueIdentifier, task.leaseToken).input('alert', driver.Int, task.alertaId)
        .query(`SELECT id FROM jm.notificacion_outbox WHERE id=@id AND alerta_id=@alert
          AND estado='PROCESANDO' AND lease_token=@token AND lease_hasta>${OUTBOX_UTC_NOW_SQL};`);
      return result.recordset.length === 1;
    });
  }

  async aceptar(task: ClaimedNotification, providerId: string): Promise<boolean> {
    if (!providerId.trim() || providerId.length > 200) throw new Error('Identificador de aceptación inválido.');
    const { driver } = this.connection;
    return this.atomic(async (transaction) => {
      // Orden compatible con inventario: alerta → Outbox; jamás Outbox → alerta.
      const result = await transaction.request().input('id', driver.Int, task.alertaId)
        .query<{ estado: NombreEstadoAlerta }>('SELECT estado FROM jm.alerta WITH (UPDLOCK,HOLDLOCK) WHERE id=@id;');
      const row = result.recordset[0];
      if (row?.estado !== 'PENDIENTE') return false;
      const alert = new Alerta(row.estado);
      alert.notificacionAceptada();
      const saved = await transaction.request().input('id', driver.UniqueIdentifier, task.id)
        .input('alert', driver.Int, task.alertaId).input('token', driver.UniqueIdentifier, task.leaseToken)
        .input('provider', driver.NVarChar(200), providerId)
        .query(`UPDATE jm.notificacion_outbox SET estado='ENVIADA', aceptada_en=SYSUTCDATETIME(),
          proveedor_id=@provider, ultimo_error=NULL, lease_token=NULL, lease_hasta=NULL,
          actualizada_en=SYSUTCDATETIME() WHERE id=@id AND alerta_id=@alert AND estado='PROCESANDO'
          AND lease_token=@token AND lease_hasta>${OUTBOX_UTC_NOW_SQL};`);
      if (saved.rowsAffected[0] !== 1) return false;
      await transaction.request().input('id', driver.Int, task.alertaId)
        .input('state', driver.VarChar(10), alert.estado)
        .query('UPDATE jm.alerta SET estado=@state WHERE id=@id;');
      await this.audit(transaction, task, 'NOTIFICACION_ACEPTADA', 'PROVIDER_ACCEPTED', 'PROCESANDO', 'ENVIADA');
      await new SqlAuditRepository(transaction, driver).registrar({
        requestId: task.leaseToken, action: 'ALERTA_ENVIADA', result: 'EXITO',
        userId: null, tenantId: null, objectId: null, entityId: String(task.alertaId),
        code: 'NOTIFICATION_ACCEPTED', httpStatus: 200, before: { estado: row.estado }, after: { estado: alert.estado },
      });
      return true;
    });
  }

  async fallar(task: ClaimedNotification, code: NotificationErrorCode, retrySeconds: number | null): Promise<boolean> {
    if (!['INVALID_PAYLOAD','TRANSPORT_TIMEOUT','TEMPORARY_FAILURE','PERMANENT_FAILURE'].includes(code)
      || (retrySeconds !== null && (!Number.isInteger(retrySeconds) || retrySeconds < 1 || retrySeconds > 3600))) {
      throw new Error('Política de fallo inválida.');
    }
    const { driver } = this.connection;
    const terminal = retrySeconds === null || task.intento >= MAX_NOTIFICATION_ATTEMPTS;
    return this.atomic(async (transaction) => {
      const result = await transaction.request().input('id', driver.UniqueIdentifier, task.id)
        .input('token', driver.UniqueIdentifier, task.leaseToken).input('error', driver.VarChar(40), code)
        .input('state', driver.VarChar(12), terminal ? 'AGOTADA' : 'PENDIENTE')
        .input('seconds', driver.Int, retrySeconds ?? 0)
        .query(`UPDATE jm.notificacion_outbox SET estado=@state, ultimo_error=@error,
          disponible_en=DATEADD(SECOND,@seconds,SYSUTCDATETIME()), lease_token=NULL, lease_hasta=NULL,
          actualizada_en=SYSUTCDATETIME() WHERE id=@id AND estado='PROCESANDO'
          AND lease_token=@token AND lease_hasta>${OUTBOX_UTC_NOW_SQL};`);
      if (result.rowsAffected[0] !== 1) return false;
      await this.audit(transaction, task, terminal ? 'NOTIFICACION_AGOTADA' : 'NOTIFICACION_REINTENTO',
        code, 'PROCESANDO', terminal ? 'AGOTADA' : 'PENDIENTE');
      return true;
    });
  }
}
