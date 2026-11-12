import type { SqlConnection } from './sql-pool.js';
import { SqlAuditRepository } from './sql-audit.js';
import { withSqlTransaction } from './sql-transaction.js';
import { AppError } from '../../shared/app-error.js';

export interface ManagedUser { id: number; objectId: string; nombres: string; rol: 'ADMINISTRADOR' | 'MECANICO'; activo: boolean }
export interface UserChange { nombres: string; rol: 'ADMINISTRADOR' | 'MECANICO'; activo: boolean }
export interface AdminActor { id: number; tenantId: string; objectId: string; requestId: string }

export class SqlUserManagement {
  constructor(private readonly connection: SqlConnection) {}

  async list(actor: AdminActor): Promise<ManagedUser[]> {
    const { pool, driver } = this.connection;
    const allowed = await pool.request().input('id', driver.Int, actor.id)
      .query<{ id: number }>(`SELECT id FROM jm.usuario WHERE id=@id AND rol='ADMINISTRADOR' AND activo=1`);
    if (!allowed.recordset.length) throw new AppError(403, 'USER_MANAGEMENT_FORBIDDEN', 'Solo un administrador habilitado gestiona perfiles.');
    const rows = await pool.request().input('tenant', driver.UniqueIdentifier, actor.tenantId)
      .query<ManagedUser>(`SELECT CONVERT(int,id) AS id,CONVERT(varchar(36),entra_object_id) AS objectId,
        nombres,rol,activo FROM jm.usuario WHERE entra_tenant_id=@tenant ORDER BY id`);
    return rows.recordset;
  }

  async create(actor: AdminActor, input: UserChange & { objectId: string }): Promise<ManagedUser> {
    const { driver } = this.connection;
    return withSqlTransaction(this.connection, async (tx) => {
      await this.assertAdmin(tx, actor);
      const found = await tx.request().input('tenant', driver.UniqueIdentifier, actor.tenantId)
        .input('object', driver.UniqueIdentifier, input.objectId)
        .query(`SELECT id FROM jm.usuario WITH (UPDLOCK,HOLDLOCK) WHERE entra_tenant_id=@tenant AND entra_object_id=@object`);
      if (found.recordset.length) throw new AppError(409, 'USER_PROFILE_EXISTS', 'Este usuario ya tiene perfil.');
      const result = await tx.request().input('tenant', driver.UniqueIdentifier, actor.tenantId)
        .input('object', driver.UniqueIdentifier, input.objectId).input('name', driver.NVarChar(150), input.nombres)
        .input('role', driver.VarChar(20), input.rol).input('active', driver.Bit, input.activo)
        .query<ManagedUser>(`INSERT INTO jm.usuario(entra_tenant_id,entra_object_id,nombres,rol,activo)
          VALUES (@tenant,@object,@name,@role,@active);
          SELECT CONVERT(int,id) AS id,CONVERT(varchar(36),entra_object_id) AS objectId,nombres,rol,activo
          FROM jm.usuario WHERE id=CONVERT(int,SCOPE_IDENTITY())`);
      const user = result.recordset[0]!;
      await this.audit(tx, actor, 'USUARIO_REGISTRADO', user.id, null, { rol: user.rol, activo: user.activo });
      return user;
    });
  }

  async update(actor: AdminActor, id: number, input: UserChange): Promise<ManagedUser> {
    const { driver } = this.connection;
    return withSqlTransaction(this.connection, async (tx) => {
      await this.assertAdmin(tx, actor);
      const previous = await tx.request().input('id', driver.Int, id).input('tenant', driver.UniqueIdentifier, actor.tenantId)
        .query<ManagedUser>(`SELECT CONVERT(int,id) AS id,CONVERT(varchar(36),entra_object_id) AS objectId,
          nombres,rol,activo FROM jm.usuario WITH (UPDLOCK,HOLDLOCK) WHERE id=@id AND entra_tenant_id=@tenant`);
      const before = previous.recordset[0];
      if (!before) throw new AppError(404, 'USER_PROFILE_NOT_FOUND', 'No se encontró el perfil.');
      if (id === actor.id && (!input.activo || input.rol !== 'ADMINISTRADOR'))
        throw new AppError(409, 'SELF_ADMIN_CHANGE_FORBIDDEN', 'No puedes retirar tu propio acceso de administrador.');
      const result = await tx.request().input('id', driver.Int, id)
        .input('name', driver.NVarChar(150), input.nombres).input('role', driver.VarChar(20), input.rol)
        .input('active', driver.Bit, input.activo)
        .query<ManagedUser>(`UPDATE jm.usuario SET nombres=@name,rol=@role,activo=@active WHERE id=@id;
          SELECT CONVERT(int,id) AS id,CONVERT(varchar(36),entra_object_id) AS objectId,nombres,rol,activo
          FROM jm.usuario WHERE id=@id`);
      const user = result.recordset[0]!;
      await this.audit(tx, actor, 'USUARIO_ACTUALIZADO', user.id,
        { rol: before.rol, activo: before.activo }, { rol: user.rol, activo: user.activo });
      return user;
    });
  }

  private async assertAdmin(tx: import('mssql').Transaction, actor: AdminActor): Promise<void> {
    const { driver } = this.connection;
    const result = await tx.request().input('id', driver.Int, actor.id)
      .input('tenant', driver.UniqueIdentifier, actor.tenantId)
      .query(`SELECT id FROM jm.usuario WITH (UPDLOCK,HOLDLOCK)
        WHERE id=@id AND entra_tenant_id=@tenant AND rol='ADMINISTRADOR' AND activo=1`);
    if (!result.recordset.length) throw new AppError(403, 'USER_MANAGEMENT_FORBIDDEN', 'Solo un administrador habilitado gestiona perfiles.');
  }

  private audit(tx: import('mssql').Transaction, actor: AdminActor,
    action: 'USUARIO_REGISTRADO' | 'USUARIO_ACTUALIZADO', id: number,
    before: { rol: string; activo: boolean } | null, after: { rol: string; activo: boolean }) {
    return new SqlAuditRepository(tx, this.connection.driver).registrar({ requestId: actor.requestId,
      action, result: 'EXITO', userId: actor.id, tenantId: actor.tenantId, objectId: actor.objectId,
      entityId: String(id), code: action, httpStatus: action === 'USUARIO_REGISTRADO' ? 201 : 200,
      before, after });
  }
}
