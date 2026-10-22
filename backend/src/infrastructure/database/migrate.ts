import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { SqlConnection } from './sql-pool.js';

export const inventoryMigrationVersions = ['001_inventory', '002_audit', '003_alerts_outbox', '004_outbox_worker', '005_catalog', '006_suppliers', '007_purchase_invoices', '008_invoice_attachments'];

export async function migrateInventory(connection: SqlConnection): Promise<void> {
  const { pool, driver } = connection;
  const transaction = new driver.Transaction(pool);
  let rolledBack = false;
  transaction.on('rollback', () => { rolledBack = true; });
  await transaction.begin();
  try {
    await transaction.request().query(`IF DB_NAME() IN (N'master', N'model', N'msdb', N'tempdb')
      THROW 51000, 'No se permiten migraciones en bases del sistema.', 1;
      DECLARE @lock int;
      EXEC @lock = sys.sp_getapplock @Resource = N'jorge-motors:migrations',
        @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;
      IF @lock < 0 THROW 51003, 'No se obtuvo el bloqueo de migraciones.', 1;
      IF OBJECT_ID(N'dbo.jm_schema_migrations', N'U') IS NULL
        CREATE TABLE dbo.jm_schema_migrations (
          version VARCHAR(50) NOT NULL PRIMARY KEY,
          checksum CHAR(64) NOT NULL,
          applied_at DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
        );`);
    for (const version of inventoryMigrationVersions) {
      const url = new URL(`../../../../database/azure-sql/migrations/${version}.sql`, import.meta.url);
      const content = (await readFile(url, 'utf8')).replaceAll('\r\n', '\n');
      const checksum = createHash('sha256').update(content).digest('hex');
      const existing = await transaction.request().input('version', driver.VarChar(50), version)
        .query<{ checksum: string }>('SELECT checksum FROM dbo.jm_schema_migrations WHERE version = @version;');
      if (existing.recordset[0]) {
        if (existing.recordset[0].checksum !== checksum) throw new Error('Una migración aplicada fue modificada.');
      } else {
        for (const batch of content.split(/^\s*GO\s*$/gmi).filter((part) => part.trim())) {
          await transaction.request().batch(batch);
        }
        await transaction.request().input('checksum', driver.Char(64), checksum)
          .input('version', driver.VarChar(50), version)
          .query('INSERT INTO dbo.jm_schema_migrations (version, checksum) VALUES (@version, @checksum);');
      }
    }
    await transaction.commit();
  } catch (error) {
    if (!rolledBack) await transaction.rollback().catch(() => undefined);
    throw error;
  }
}
