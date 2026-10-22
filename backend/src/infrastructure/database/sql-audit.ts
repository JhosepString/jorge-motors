import type sql from 'mssql';
import type { AuditEvent, AuditRepository } from '../../modules/auditoria/application/contracts.js';
import type { SqlDriver } from './sql-pool.js';

export class SqlAuditRepository implements AuditRepository {
  constructor(private readonly session: sql.Transaction | sql.ConnectionPool, private readonly driver: SqlDriver) {}

  async registrar(event: AuditEvent): Promise<void> {
    await this.session.request()
      .input('request', this.driver.UniqueIdentifier, event.requestId)
      .input('action', this.driver.VarChar(40), event.action)
      .input('result', this.driver.VarChar(10), event.result)
      .input('user', this.driver.Int, event.userId)
      .input('tenant', this.driver.UniqueIdentifier, event.tenantId)
      .input('object', this.driver.UniqueIdentifier, event.objectId)
      .input('entity', this.driver.VarChar(40), event.entityId)
      .input('code', this.driver.VarChar(60), event.code)
      .input('status', this.driver.Int, event.httpStatus)
      .input('before', this.driver.NVarChar(2000), event.before ? JSON.stringify(event.before) : null)
      .input('after', this.driver.NVarChar(2000), event.after ? JSON.stringify(event.after) : null)
      .query(`INSERT INTO jm.auditoria
        (request_id, accion, resultado, usuario_id, entra_tenant_id, entra_object_id,
         entidad_id, codigo, http_status, valores_anteriores, valores_nuevos)
        VALUES (@request, @action, @result, @user, @tenant, @object, @entity, @code, @status, @before, @after);`);
  }
}
