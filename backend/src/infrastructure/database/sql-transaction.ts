import type sql from 'mssql';
import type { SqlConnection } from './sql-pool.js';

export async function withSqlTransaction<T>(connection: SqlConnection,
  operation: (transaction: sql.Transaction) => Promise<T>): Promise<T> {
  const transaction = new connection.driver.Transaction(connection.pool);
  let rolledBack = false;
  transaction.on('rollback', () => { rolledBack = true; });
  await transaction.begin(connection.driver.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    await transaction.request().query('SET XACT_ABORT ON;');
    const result = await operation(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    if (!rolledBack) await transaction.rollback().catch(() => undefined);
    throw error;
  }
}
