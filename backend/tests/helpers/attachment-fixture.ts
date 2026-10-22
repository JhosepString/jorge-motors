import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';

// Ficticio: prueba firmas básicas, no se presenta como un examen antivirus/estructural.
export const pdfFixture = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
export const pngFixture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=', 'base64');
export async function tempAttachmentRoot() { return mkdtemp(join(tmpdir(), 'jm-attachments-')); }
export async function removeAttachmentRoot(root: string) {
  const resolved = resolve(root);
  if (dirname(resolved) !== resolve(tmpdir()) || !basename(resolved).startsWith('jm-attachments-')) {
    throw new Error('Se rechazó una limpieza fuera de la carpeta temporal de pruebas.');
  }
  await rm(resolved, { recursive: true, force: true });
}
