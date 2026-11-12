import { z } from 'zod';
import type { SqlConnection } from './sql-pool.js';
import { AppError } from '../../shared/app-error.js';
import type { UserProfile, VerifiedIdentity } from '../../modules/auth/application/contracts.js';
import { normalizeDevicePublicKey, verifyDeviceProof, type DeviceProof } from '../../modules/auth/application/device-proof.js';
import { SqlAuditRepository } from './sql-audit.js';

export const deviceRegistrationInput = z.object({ deviceId: z.uuid(), publicKey: z.string().min(100).max(512) }).strict();
export const deviceRevocationInput = z.object({ reason: z.string().trim().min(10).max(300) }).strict();
export type DeviceRegistration = z.infer<typeof deviceRegistrationInput>;

export class SqlDeviceService {
  constructor(private readonly connection: SqlConnection) {}

  async register(input: DeviceRegistration, identity: VerifiedIdentity, proof: DeviceProof,
    actor: UserProfile, requestId: string): Promise<void> {
    let publicKey: string;
    try { publicKey = normalizeDevicePublicKey(input.publicKey); }
    catch { throw new AppError(400, 'INVALID_DEVICE_KEY', 'La clave del equipo no es válida.'); }
    if (proof.deviceId.toLowerCase() !== input.deviceId.toLowerCase() ||
      !verifyDeviceProof(publicKey, proof, 'POST', '/api/v1/sync/devices', input))
      throw new AppError(403, 'INVALID_DEVICE_PROOF', 'No se pudo comprobar la identidad del equipo.');
    const { pool, driver } = this.connection;
    const tx = new driver.Transaction(pool);
    let rolledBack = false;
    tx.on('rollback', () => { rolledBack = true; });
    await tx.begin();
    try {
      const prior = await tx.request().input('device', driver.UniqueIdentifier, input.deviceId)
        .query<{ tenantId: string; publicKey: string; active: boolean }>(`SELECT
          CONVERT(varchar(36),tenant_id) AS tenantId, public_key AS publicKey, activo AS active
          FROM jm.dispositivo_registrado WITH (UPDLOCK,HOLDLOCK) WHERE device_id=@device;`);
      const row = prior.recordset[0];
      if (row) {
        if (!row.active || row.tenantId.toLowerCase() !== identity.tenantId.toLowerCase() || row.publicKey !== publicKey)
          throw new AppError(403, 'DEVICE_ALREADY_REGISTERED', 'El equipo ya tiene otra identidad registrada.');
      } else {
        await tx.request().input('device', driver.UniqueIdentifier, input.deviceId)
          .input('tenant', driver.UniqueIdentifier, identity.tenantId)
          .input('key', driver.VarChar(512), publicKey)
          .query(`INSERT INTO jm.dispositivo_registrado(device_id,tenant_id,public_key)
            VALUES (@device,@tenant,@key);`);
      }
      await new SqlAuditRepository(tx, driver).registrar({ requestId, action: 'DISPOSITIVO_REGISTRADO',
        result: 'EXITO', userId: actor.id, tenantId: identity.tenantId, objectId: identity.objectId,
        entityId: input.deviceId, code: row ? 'DEVICE_REGISTRATION_REPLAY' : 'DEVICE_REGISTERED',
        httpStatus: 200, before: null, after: { deviceId: input.deviceId } });
      await tx.commit();
    } catch (error) { if (!rolledBack) await tx.rollback(); throw error; }
  }

  async assertRegistered(deviceId: string, identity: VerifiedIdentity): Promise<string> {
    const { pool, driver } = this.connection;
    const result = await pool.request().input('device', driver.UniqueIdentifier, deviceId)
      .input('tenant', driver.UniqueIdentifier, identity.tenantId)
      .query<{ publicKey: string }>(`SELECT public_key AS publicKey FROM jm.dispositivo_registrado
        WHERE device_id=@device AND tenant_id=@tenant AND activo=1;`);
    if (!result.recordset[0]) throw new AppError(403, 'DEVICE_NOT_REGISTERED', 'El equipo no está registrado.');
    return result.recordset[0].publicKey;
  }

  async assertProof(deviceId: string, identity: VerifiedIdentity, proof: DeviceProof,
    method: string, path: string, body?: unknown): Promise<void> {
    if (proof.deviceId.toLowerCase() !== deviceId.toLowerCase())
      throw new AppError(403, 'INVALID_DEVICE_PROOF', 'El equipo no coincide con la solicitud.');
    const key = await this.assertRegistered(deviceId, identity);
    if (!verifyDeviceProof(key, proof, method, path, body))
      throw new AppError(403, 'INVALID_DEVICE_PROOF', 'No se pudo comprobar la identidad del equipo.');
  }

  async list(identity: VerifiedIdentity) {
    const { pool, driver } = this.connection;
    const result = await pool.request().input('tenant', driver.UniqueIdentifier, identity.tenantId)
      .query<{ deviceId: string; active: boolean; createdAt: Date; revokedAt: Date | null;
        quotaRemaining: string; productsWithQuota: number }>(`SELECT CONVERT(varchar(36),d.device_id) AS deviceId,
        d.activo AS active,d.creado_en AS createdAt,d.revocado_en AS revokedAt,
        COALESCE(SUM(CONVERT(bigint,q.restante)),0) AS quotaRemaining,
        COUNT(CASE WHEN q.restante>0 THEN 1 END) AS productsWithQuota
        FROM jm.dispositivo_registrado d LEFT JOIN jm.cupo_dispositivo q ON q.device_id=d.device_id
        WHERE d.tenant_id=@tenant GROUP BY d.device_id,d.activo,d.creado_en,d.revocado_en
        ORDER BY d.creado_en DESC,d.device_id;`);
    return result.recordset;
  }

  async revoke(deviceId: string, reason: string, identity: VerifiedIdentity,
    actor: UserProfile, requestId: string) {
    const { pool, driver } = this.connection;
    const tx = new driver.Transaction(pool);
    let rolledBack = false;
    tx.on('rollback', () => { rolledBack = true; });
    await tx.begin();
    try {
      const result = await tx.request().input('device', driver.UniqueIdentifier, deviceId)
        .input('tenant', driver.UniqueIdentifier, identity.tenantId)
        .query<{ active: boolean }>(`SELECT activo AS active FROM jm.dispositivo_registrado WITH (UPDLOCK,HOLDLOCK)
          WHERE device_id=@device AND tenant_id=@tenant;`);
      const row = result.recordset[0];
      if (!row) throw new AppError(404, 'DEVICE_NOT_FOUND', 'El equipo no está registrado.');
      if (row.active) {
        await tx.request().input('device', driver.UniqueIdentifier, deviceId)
          .input('reason', driver.NVarChar(300), reason).input('user', driver.Int, actor.id)
          .query(`UPDATE jm.dispositivo_registrado SET activo=0,revocado_en=SYSUTCDATETIME(),
            revocado_por=@user,motivo_revocacion=@reason WHERE device_id=@device;`);
      }
      const quota = await tx.request().input('device', driver.UniqueIdentifier, deviceId)
        .query<{ remaining: string }>(`SELECT COALESCE(SUM(CONVERT(bigint,restante)),0) AS remaining
          FROM jm.cupo_dispositivo WHERE device_id=@device;`);
      const remaining = String(quota.recordset[0]!.remaining);
      await new SqlAuditRepository(tx, driver).registrar({ requestId, action: 'DISPOSITIVO_REVOCADO',
        result: 'EXITO', userId: actor.id, tenantId: identity.tenantId, objectId: identity.objectId,
        entityId: deviceId, code: row.active ? 'DEVICE_REVOKED' : 'DEVICE_REVOCATION_REPLAY',
        httpStatus: 200, before: { active: row.active }, after: { active: false, quotaRemaining: remaining, reason } });
      await tx.commit();
      return { deviceId, active: false, quotaRemaining: remaining };
    } catch (error) { if (!rolledBack) await tx.rollback(); throw error; }
  }
}
