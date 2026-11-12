import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { cp, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

export function localUninstallSummary(dataDir) {
  if (!existsSync(join(dataDir, 'inventory.sqlite')))
    return { pending: 0, rejected: 0, known: true };
  let db;
  try {
    db = new DatabaseSync(join(dataDir, 'inventory.sqlite'), { readOnly: true });
    const rows = db.prepare(`SELECT status, COUNT(*) AS count FROM sync_operation
      WHERE status IN ('PENDING','REJECTED') GROUP BY status`).all();
    return { pending: Number(rows.find((row) => row.status === 'PENDING')?.count ?? 0),
      rejected: Number(rows.find((row) => row.status === 'REJECTED')?.count ?? 0), known: true };
  } catch {
    return { pending: 0, rejected: 0, known: false };
  } finally { db?.close(); }
}

export async function exportLocalData(dataDir, folder) {
  const source = resolve(dataDir);
  const target = resolve(folder, `JorgeMotors-respaldo-${new Date().toISOString().slice(0, 10)}-${randomBytes(4).toString('hex')}`);
  if (target.toLowerCase().startsWith(source.toLowerCase() + sep) || target.toLowerCase() === source.toLowerCase())
    throw new Error('El respaldo debe guardarse fuera de los datos de la aplicación.');
  await stat(source);
  await cp(source, target, { recursive: true, force: false, errorOnExist: true });
  return target;
}

export async function reviewUninstall(dataDir, dialog) {
  const summary = localUninstallSummary(dataDir);
  const count = summary.known
    ? `${summary.pending} operaciones pendientes y ${summary.rejected} rechazadas.`
    : 'No se pudo comprobar la base local; podría contener operaciones sin sincronizar.';
  for (;;) {
    const choice = dialog.showMessageBoxSync({ type: 'question', title: 'Desinstalar Jorge Motors',
      message: '¿Qué desea hacer con los datos de este equipo?',
      detail: `${count}\nLa desinstalación no borra datos de Azure ni usuarios de Microsoft.`,
      buttons: ['Conservar datos', 'Exportar copia', 'Eliminar todo', 'Cancelar'],
      defaultId: 0, cancelId: 3, noLink: true });
    if (choice === 0) return 0;
    if (choice === 3) return 1;
    if (choice === 1) {
      const folders = dialog.showOpenDialogSync({ title: 'Guardar copia local', properties: ['openDirectory', 'createDirectory'] });
      if (!folders?.[0]) continue;
      try {
        const target = await exportLocalData(dataDir, folders[0]);
        dialog.showMessageBoxSync({ type: 'info', title: 'Copia guardada', message: 'Se guardó una copia local.',
          detail: target, buttons: ['Continuar'], noLink: true });
      } catch {
        dialog.showMessageBoxSync({ type: 'error', title: 'No se guardó la copia',
          message: 'Elija otra carpeta e inténtelo de nuevo.', buttons: ['Continuar'], noLink: true });
      }
      continue;
    }
    if (choice === 2) {
      const confirm = dialog.showMessageBoxSync({ type: 'warning', title: 'Borrado irreversible',
        message: '¿Eliminar permanentemente todos los datos locales de Jorge Motors?',
        detail: `${count}\nLas operaciones no sincronizadas podrían perderse. Esta acción no se puede deshacer.`,
        buttons: ['Volver', 'Eliminar permanentemente'], defaultId: 0, cancelId: 0, noLink: true });
      if (confirm === 1) return 2;
    }
  }
}
