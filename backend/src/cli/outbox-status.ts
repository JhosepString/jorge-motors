import { SqlPoolSingleton } from '../infrastructure/database/sql-pool.js';
import { parseSqlSettings } from '../infrastructure/database/sql-settings.js';

const provider = SqlPoolSingleton.getInstance();
try {
  const settings = parseSqlSettings(process.env);
  if (settings.SQL_DRIVER !== 'windows' || settings.SQL_SERVER !== 'localhost' || settings.SQL_DATABASE !== 'jorge_motors_dev') {
    throw new Error('Esta inspección corresponde solo a la demostración local.');
  }
  const { pool } = await provider.getConnection(settings);
  const result = await pool.request().query(`SELECT TOP (20) CONVERT(varchar(36), o.id) AS tarea,
    o.alerta_id, a.estado AS alerta, o.estado AS envio, o.intentos, o.disponible_en,
    o.lease_hasta, o.ultimo_error FROM jm.notificacion_outbox o JOIN jm.alerta a ON a.id=o.alerta_id
    ORDER BY o.creada_en DESC, o.id;`);
  console.info('Solo consulta: no reclama tareas, no cambia estados y no envía correos.');
  console.table(result.recordset);
} catch {
  console.error('No se pudo consultar Outbox. Revise configuración local y migración 004.');
  process.exitCode = 1;
} finally { await provider.close(); }
