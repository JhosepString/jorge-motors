// One-time, guarded copy of the academic demo database. Run from backend/ with
// JM_SQL_TOKEN set to an Azure SQL access token; no token is written to disk.
import sql from 'mssql';
import windowsSql from 'mssql/msnodesqlv8.js';

const tables = [
  'usuario', 'categoria', 'producto', 'stock', 'movimiento', 'alerta',
  'notificacion_outbox', 'proveedor', 'factura_compra',
  'factura_compra_linea', 'factura_adjunto', 'auditoria',
];
const server = process.env.JM_AZURE_SQL_SERVER;
const database = process.env.JM_AZURE_SQL_DATABASE;
if (!server?.endsWith('.database.windows.net') || !/^[a-zA-Z][\w]*$/.test(database ?? '') || !process.env.JM_SQL_TOKEN) {
  throw new Error('Faltan JM_AZURE_SQL_SERVER, JM_AZURE_SQL_DATABASE o JM_SQL_TOKEN.');
}

const local = new windowsSql.ConnectionPool({
  connectionString: 'Driver={ODBC Driver 18 for SQL Server};Server=lpc:localhost;Database=jorge_motors_dev;Trusted_Connection=Yes;Encrypt=Yes;TrustServerCertificate=Yes;',
});
const cloud = new sql.ConnectionPool({
  server, database, port: 1433,
  authentication: { type: 'azure-active-directory-access-token', options: { token: process.env.JM_SQL_TOKEN } },
  options: { encrypt: true, trustServerCertificate: false },
  connectionTimeout: 30000, requestTimeout: 30000,
});
let transaction;
try {
  await Promise.all([local.connect(), cloud.connect()]);
  const copies = [];
  for (const name of tables) {
    const columns = (await local.request().input('name', sql.NVarChar, name).query(`
      SELECT c.name, c.is_identity FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'jm.' + @name) AND c.system_type_id <> 189
      ORDER BY c.column_id`)).recordset;
    if (!columns.length) throw new Error(`Tabla local ausente: jm.${name}`);
    const projection = columns.map(c => `[${c.name}]`).join(', ');
    const rows = (await local.request().query(`SELECT ${projection} FROM jm.[${name}]`)).recordset;
    copies.push({ name, columns, projection, rows });
  }

  transaction = new sql.Transaction(cloud);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  for (const { name } of copies) {
    const result = await new sql.Request(transaction).query(`SELECT COUNT_BIG(*) AS count FROM jm.[${name}]`);
    if (Number(result.recordset[0].count) !== 0) throw new Error(`Destino con datos: jm.${name}; no se copiará encima.`);
  }
  for (const { name, columns, projection, rows } of copies) {
    const identity = columns.some(c => c.is_identity);
    console.log(`Copiando jm.${name}: identity=${identity}, filas=${rows.length}`);
    const placeholders = columns.map((_, i) => `@v${i}`).join(', ');
    for (const row of rows) {
      const request = new sql.Request(transaction);
      columns.forEach((c, i) => request.input(`v${i}`, row[c.name]));
      await request.query(`${identity ? `SET IDENTITY_INSERT jm.[${name}] ON;` : ''}
        INSERT INTO jm.[${name}] (${projection}) VALUES (${placeholders});
        ${identity ? `SET IDENTITY_INSERT jm.[${name}] OFF;` : ''}`);
    }
    const result = await new sql.Request(transaction).query(`SELECT COUNT_BIG(*) AS count FROM jm.[${name}]`);
    if (Number(result.recordset[0].count) !== rows.length) throw new Error(`Conteo desigual en jm.${name}`);
    console.log(`jm.${name}: ${rows.length}`);
  }
  await transaction.commit();
  transaction = undefined;
  console.log('Copia confirmada; identidades y claves originales conservadas.');
} catch (error) {
  if (transaction) await transaction.rollback().catch(() => undefined);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await Promise.allSettled([local.close(), cloud.close()]);
}
