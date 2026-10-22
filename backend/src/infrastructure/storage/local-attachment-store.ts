import { createHash } from 'node:crypto';
import { mkdir, lstat, realpath, open, readFile, unlink } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AttachmentStore } from '../../modules/compras/application/attachment-contracts.js';
import { MAX_ATTACHMENT_BYTES } from '../../modules/compras/domain/attachment.js';
import { PurchaseError } from '../../modules/compras/domain/purchase-error.js';

export const defaultAttachmentRoot = fileURLToPath(new URL('../../../.local-data/attachments/', import.meta.url));
// Adapter local: solo recibe UUIDs internos. Nunca usa el nombre del cliente como ruta.
export class LocalAttachmentStore implements AttachmentStore {
  private readonly root: string;
  constructor(root: string = defaultAttachmentRoot) {
    if (!isAbsolute(root)) throw new Error('El almacén privado requiere una ruta absoluta.');
    this.root = resolve(root);
  }
  private async path(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('ID de objeto inválido.');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const actual = await realpath(this.root);
    const canonical = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
    if ((await lstat(this.root)).isSymbolicLink() || canonical(actual) !== canonical(this.root)) {
      throw new Error('No se admite un almacén redirigido.');
    }
    return join(this.root, `${id}.bin`);
  }
  private async regular(path: string) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_ATTACHMENT_BYTES) throw new Error('Objeto privado inválido.');
  }
  async putIfAbsent(id: string, contents: Buffer): Promise<void> {
    try {
      if (contents.length < 1 || contents.length > MAX_ATTACHMENT_BYTES) throw new Error('Tamaño inválido.');
      const path = await this.path(id);
      try {
        const handle = await open(path, 'wx', 0o600);
        try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
        await this.regular(path);
        const previous = await readFile(path);
        if (previous.length !== contents.length || createHash('sha256').update(previous).digest('hex') !== createHash('sha256').update(contents).digest('hex')) {
          throw new Error('El objeto existente no coincide.');
        }
      }
    } catch {
      throw new PurchaseError('ATTACHMENT_STORAGE_UNAVAILABLE', 'No se pudo completar la escritura del archivo privado.');
    }
  }
  async read(id: string): Promise<Buffer> {
    try {
      const path = await this.path(id); await this.regular(path);
      const contents = await readFile(path);
      if (contents.length > MAX_ATTACHMENT_BYTES) throw new Error('Tamaño inválido.');
      return contents;
    } catch { throw new PurchaseError('ATTACHMENT_STORAGE_UNAVAILABLE', 'El archivo privado no está disponible.'); }
  }
  async remove(id: string): Promise<void> {
    try {
      const path = await this.path(id);
      try { await this.regular(path); await unlink(path); }
      catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    } catch { throw new PurchaseError('ATTACHMENT_STORAGE_UNAVAILABLE', 'No se pudo limpiar el archivo privado.'); }
  }
}
