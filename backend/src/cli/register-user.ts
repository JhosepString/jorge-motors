import { z } from 'zod';
import { parseEntraSettings } from '../modules/auth/infrastructure/entra.js';
import { parseSqlSettings } from '../infrastructure/database/sql-settings.js';
import { SqlPoolSingleton } from '../infrastructure/database/sql-pool.js';
import { SqlAuditRepository } from '../infrastructure/database/sql-audit.js';
import { randomUUID } from 'node:crypto';

const provider = SqlPoolSingleton.getInstance();
try {
  // Operación administrativa local explícita; no crea usuarios en Entra.
  const [objectId, role, name] = process.argv.slice(2);
  const input = z.object({ objectId: z.uuid(), role: z.enum(['ADMINISTRADOR', 'MECANICO']), name: z.string().trim().min(1).max(150) })
    .parse({ objectId, role, name });
  const entra = parseEntraSettings(process.env);
  const settings = parseSqlSettings(process.env);
  if (!entra || settings.SQL_DRIVER !== 'windows' || settings.SQL_SERVER !== 'localhost') {
    throw new Error('Este comando solo provisiona un perfil en SQL Server Windows local.');
  }
  const { pool, driver } = await provider.getConnection(settings);
  const transaction = new driver.Transaction(pool);
  await transaction.begin();
  try {
    const result = await transaction.request().input('tenant', driver.UniqueIdentifier, entra.tenantId)
      .input('object', driver.UniqueIdentifier, input.objectId).input('role', driver.VarChar(20), input.role)
      .input('name', driver.NVarChar(150), input.name)
      .query<{ id: number }>(`INSERT INTO jm.usuario(entra_tenant_id, entra_object_id, nombres, rol)
        VALUES (@tenant, @object, @name, @role); SELECT CONVERT(int, SCOPE_IDENTITY()) AS id;`);
    const id = result.recordset[0]!.id;
    await new SqlAuditRepository(transaction, driver).registrar({
      requestId: randomUUID(), action: 'USUARIO_REGISTRADO', result: 'EXITO',
      // Bootstrap autorizado por la sesión Windows, no por un usuario Entra autenticado.
      // No atribuir esta acción a la persona cuyo perfil se acaba de crear.
      userId: null, tenantId: null, objectId: null, entityId: String(id),
      code: 'LOCAL_BOOTSTRAP_PROFILE_CREATED', httpStatus: 201, before: null, after: null,
    });
    await transaction.commit();
    console.info(`Perfil local creado con ID ${id}. Su asignación de rol en Entra se realiza por separado.`);
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
} catch {
  console.error('No se creó el perfil. Uso: db:user:add OBJECT_ID ADMINISTRADOR|MECANICO "Nombre". Revise configuración, migraciones y duplicados.');
  process.exitCode = 1;
} finally {
  await provider.close();
}
