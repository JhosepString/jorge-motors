import { migrateInventory, inventoryMigrationVersions } from '../infrastructure/database/migrate.js';
import { SqlPoolSingleton } from '../infrastructure/database/sql-pool.js';
import { parseSqlSettings } from '../infrastructure/database/sql-settings.js';

const provider = SqlPoolSingleton.getInstance();
try {
  const connection = await provider.getConnection(parseSqlSettings(process.env));
  await migrateInventory(connection);
  console.info(`Migraciones ${inventoryMigrationVersions.join(', ')} aplicadas o verificadas correctamente.`);
} catch {
  console.error('No se pudo migrar. Revise servidor, base, acceso y que la migración no haya sido modificada.');
  process.exitCode = 1;
} finally {
  await provider.close();
}
