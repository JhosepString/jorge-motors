import type { AttachmentMime } from '../domain/attachment.js';
import type { AuditRepository } from '../../auditoria/application/contracts.js';
import type { UsuarioInventario } from '../../inventario/application/contracts.js';

export interface Attachment {
  id: string; facturaId: number; nombre: string; contentType: AttachmentMime; bytes: number; sha256: string;
  estado: 'PENDIENTE' | 'LISTO' | 'ELIMINADO'; usuarioId: number; creadoEn: Date;
}
export interface StoredAttachment extends Attachment { caducado: boolean }
// Puerto: no rutas de disco, URLs públicas, SAS ni tipos del SDK en el caso de uso.
export interface AttachmentStore {
  putIfAbsent(id: string, contents: Buffer): Promise<void>;
  read(id: string): Promise<Buffer>;
  remove(id: string): Promise<void>;
}
export interface AttachmentRepositories {
  usuarios: { obtener(id: number): Promise<UsuarioInventario | undefined> };
  auditoria: AuditRepository;
  facturas: { obtener(id: number): Promise<{ id: number; estado: string } | undefined> };
  adjuntos: {
    bloquear(resource: string): Promise<void>;
    obtener(id: string): Promise<StoredAttachment | undefined>;
    buscarClave(userId: number, key: string): Promise<StoredAttachment | undefined>;
    contarActivos(invoiceId: number): Promise<number>;
    crear(data: Omit<Attachment, 'estado' | 'creadoEn'>, key: string): Promise<StoredAttachment>;
    finalizar(id: string): Promise<StoredAttachment>;
    eliminar(id: string): Promise<void>;
    listar(invoiceId: number): Promise<StoredAttachment[]>;
    caducados(): Promise<StoredAttachment[]>;
  };
}
export interface AttachmentUnitOfWork { ejecutar<T>(operation: (repos: AttachmentRepositories) => Promise<T>): Promise<T> }
