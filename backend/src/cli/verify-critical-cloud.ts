import { SqlPoolSingleton } from '../infrastructure/database/sql-pool.js';
import { parseSqlSettings } from '../infrastructure/database/sql-settings.js';

const provider = SqlPoolSingleton.getInstance();
try {
  const { pool } = await provider.getConnection(parseSqlSettings(process.env));
  const types = await pool.request().query<{ tipo: string; total: number }>(`SELECT tipo,COUNT(*) AS total
    FROM jm.producto WHERE sku LIKE 'SIM-%' GROUP BY tipo ORDER BY tipo`);
  const guard = await pool.request().query<{ exists: number }>(`SELECT CASE WHEN OBJECT_ID(N'jm.tr_bloquear_salida_herramienta',N'TR') IS NULL
    THEN 0 ELSE 1 END AS [exists]`);
  const counts = Object.fromEntries(types.recordset.map((row) => [row.tipo, row.total]));
  const result = { counts, toolExitGuard: guard.recordset[0]?.exists === 1 };
  console.log(JSON.stringify(result));
  if ((counts.REPUESTO ?? 0) < 480 || counts.HERRAMIENTA !== 100 || counts.CONSUMIBLE !== 20 ||
    !result.toolExitGuard) throw new Error('Clasificación o protección de herramientas incompleta.');
} finally { await provider.close(); }
