import { SqlPoolSingleton } from '../infrastructure/database/sql-pool.js';
import { parseSqlSettings } from '../infrastructure/database/sql-settings.js';

// Consulta de evidencia: no modifica datos y no imprime credenciales ni tokens.
const provider = SqlPoolSingleton.getInstance();
try {
  const { pool } = await provider.getConnection(parseSqlSettings(process.env));
  const result = await pool.request().query(`
    SELECT DB_NAME() AS base, COUNT(*) AS productos FROM jm.producto;
    SELECT p.id, p.sku, p.stock_minimo AS minimo, s.cantidad_actual AS stock
      FROM jm.producto p JOIN jm.stock s ON s.producto_id = p.id ORDER BY p.id;
    SELECT estado, COUNT(*) AS total FROM jm.alerta GROUP BY estado ORDER BY estado;
    SELECT estado, COUNT(*) AS total FROM jm.notificacion_outbox GROUP BY estado ORDER BY estado;
    SELECT TOP (10) accion, resultado, codigo, http_status AS http
      FROM jm.auditoria ORDER BY id DESC;`);
  const sets = Array.isArray(result.recordsets) ? result.recordsets : Object.values(result.recordsets);
  for (const [i, label] of ['Base', 'Stock', 'Alertas', 'Outbox', 'Auditoría reciente'].entries()) {
    console.info(`${label}: ${JSON.stringify(sets[i])}`);
  }
} catch {
  console.error('No se pudo consultar la evidencia. Revise la conexión SQL y la identidad de Azure.');
  process.exitCode = 1;
} finally {
  await provider.close();
}
