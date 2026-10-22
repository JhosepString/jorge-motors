import { AttachmentCleanup } from '../modules/compras/application/adjuntos.facade.js';
import { LocalAttachmentStore } from '../infrastructure/storage/local-attachment-store.js';
import { SqlAttachmentUnitOfWork } from '../infrastructure/database/sql-attachments.js';
import { SqlPoolSingleton } from '../infrastructure/database/sql-pool.js';
import { parseSqlSettings } from '../infrastructure/database/sql-settings.js';

const pool = SqlPoolSingleton.getInstance();
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) throw new Error('Argumentos inválidos.');
  const settings = parseSqlSettings(process.env);
  if (process.env.NODE_ENV === 'production' || settings.SQL_DRIVER !== 'windows'
    || settings.SQL_SERVER !== 'localhost' || settings.SQL_DATABASE !== 'jorge_motors_dev') throw new Error('Solo demostración local.');
  const cleanup = new AttachmentCleanup(new SqlAttachmentUnitOfWork(await pool.getConnection(settings)),
    new LocalAttachmentStore(process.env.ATTACHMENT_LOCAL_ROOT));
  if (args[0] === '--apply') {
    console.info('Limpieza LOCAL: elimina solo archivos de cargas PENDIENTES caducadas (30 min), máximo 25. Conserva la trazabilidad.');
    console.info(await cleanup.ejecutar());
  } else {
    console.info('Solo consulta: no borra archivos ni cambia SQL. Para aplicar, use --apply.');
    console.table(await cleanup.pendientes());
  }
} catch {
  console.error('No se completó la revisión/limpieza. Revise migración 008, conexión local y almacenamiento privado.'); process.exitCode = 1;
} finally { await pool.close(); }
