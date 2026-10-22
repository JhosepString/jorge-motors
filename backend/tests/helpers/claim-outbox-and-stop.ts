import { connectSql } from '../../src/infrastructure/database/sql-pool.js';
import { parseSqlSettings } from '../../src/infrastructure/database/sql-settings.js';
import { SqlNotificationDispatch } from '../../src/infrastructure/database/sql-notification-dispatch.js';

// Proceso hijo de pruebas: abandona una reserva; no acepta bases reales ni envía avisos.
const database = process.argv[2] ?? '';
if (!/^jm_test_[a-f0-9]{32}$/.test(database)) throw new Error('Solo base efímera de pruebas.');
const connection = await connectSql(parseSqlSettings({
  SQL_DRIVER: 'windows', SQL_SERVER: 'localhost', SQL_DATABASE: database, SQL_TRUST_CERTIFICATE: 'true',
}));
try {
  const task = await new SqlNotificationDispatch(connection).reclamar();
  if (!task) throw new Error('Falta tarea ficticia.');
  console.info(JSON.stringify({ id: task.id }));
  // Termina el proceso sin enviar, aceptar ni devolver la reserva.
} finally { await connection.pool.close(); }
