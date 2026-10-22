import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { Attachment, AttachmentRepositories, AttachmentStore, AttachmentUnitOfWork, StoredAttachment } from './attachment-contracts.js';
import { inspectAttachment, attachmentIdSchema, MAX_INVOICE_ATTACHMENTS } from '../domain/attachment.js';
import { PurchaseError } from '../domain/purchase-error.js';
import type { AuditEvent } from '../../auditoria/application/contracts.js';
import type { UsuarioInventario } from '../../inventario/application/contracts.js';

const idSchema = z.number().int().positive().max(2_147_483_647);
function valid<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new PurchaseError('INVALID_ATTACHMENT', 'Revise los datos del adjunto.');
  return result.data;
}
export function publicAttachment(row: StoredAttachment): Attachment {
  const { caducado: _expired, ...data } = row; return data;
}
export class AdjuntosFacade {
  constructor(private readonly uow: AttachmentUnitOfWork, private readonly store: AttachmentStore) {}
  private async actor(repos: AttachmentRepositories, userId: number) {
    const actor = await repos.usuarios.obtener(userId);
    if (!actor?.activo || actor.rol !== 'ADMINISTRADOR') throw new PurchaseError('ATTACHMENT_FORBIDDEN', 'Solo Administrador habilitado puede gestionar adjuntos.');
    return actor;
  }
  private async invoice(repos: AttachmentRepositories, id: number, write = false) {
    const invoice = await repos.facturas.obtener(id);
    if (!invoice) throw new PurchaseError('INVOICE_NOT_FOUND', 'La factura no existe.');
    if (write && invoice.estado === 'ANULADA') throw new PurchaseError('ATTACHMENT_INVOICE_CANCELLED', 'No se adjuntan nuevos archivos a una factura anulada.');
    return invoice;
  }
  private audit(repos: AttachmentRepositories, actor: UsuarioInventario, requestId: string, action: AuditEvent['action'], row: Attachment, status: number) {
    return repos.auditoria.registrar({ requestId, action, result: 'EXITO', userId: actor.id,
      tenantId: actor.entraTenantId, objectId: actor.entraObjectId, entityId: row.id, code: action,
      httpStatus: status, before: null, after: { facturaId: row.facturaId, estado: row.estado, bytes: row.bytes, sha256: row.sha256 } });
  }
  async subir(invoiceId: number, name: unknown, mime: unknown, contents: unknown, key: string, userId: number, requestId: string) {
    valid(idSchema, invoiceId); valid(idSchema, userId); valid(z.uuid(), requestId);
    const receiptKey = valid(attachmentIdSchema, key);
    const file = inspectAttachment(name, mime, contents);
    // Primera transacción: intención durable. Si el proceso cae después, el objeto
    // (completo o parcial) sigue teniendo un ID registrado y recuperable.
    const reserved = await this.uow.ejecutar(async (repos) => {
      const actor = await this.actor(repos, userId);
      await repos.adjuntos.bloquear(`clave:${userId}:${receiptKey}`);
      const previous = await repos.adjuntos.buscarClave(userId, receiptKey);
      if (previous) {
        if (previous.facturaId !== invoiceId || previous.nombre !== file.nombre || previous.contentType !== file.contentType
          || previous.sha256 !== file.sha256 || previous.bytes !== file.bytes) {
          throw new PurchaseError('IDEMPOTENCY_CONFLICT', 'La clave corresponde a otro archivo o factura.');
        }
        return previous;
      }
      await this.invoice(repos, invoiceId, true);
      if (await repos.adjuntos.contarActivos(invoiceId) >= MAX_INVOICE_ATTACHMENTS) {
        throw new PurchaseError('ATTACHMENT_LIMIT', 'La factura ya tiene cinco adjuntos activos o pendientes.');
      }
      const row = await repos.adjuntos.crear({ id: randomUUID(), facturaId: invoiceId, nombre: file.nombre,
        contentType: file.contentType, bytes: file.bytes, sha256: file.sha256, usuarioId: userId }, receiptKey);
      await this.audit(repos, actor, requestId, 'ADJUNTO_RESERVADO', row, 201); return row;
    });
    // Segunda transacción: bloqueo del ID serializa subida/reintento/limpieza.
    // Para el adaptador LOCAL acotado se conserva el lock durante la E/S.
    // Un fallo de commit no revierte el disco: queda PENDIENTE para reconciliar.
    return this.uow.ejecutar(async (repos) => {
      const actor = await this.actor(repos, userId);
      await this.invoice(repos, invoiceId);
      await repos.adjuntos.bloquear(`objeto:${reserved.id.toLowerCase()}`);
      const row = await repos.adjuntos.obtener(reserved.id);
      if (!row) throw new Error('Reserva no encontrada.');
      if (row.estado === 'LISTO') {
        await this.audit(repos, actor, requestId, 'ADJUNTO_REINTENTO', row, 200);
        return { adjunto: publicAttachment(row), repetido: true };
      }
      if (row.estado === 'ELIMINADO' || row.caducado) throw new PurchaseError('ATTACHMENT_EXPIRED', 'La carga caducó. Consulte la limpieza antes de usar una nueva clave.');
      await this.invoice(repos, invoiceId, true);
      await this.store.putIfAbsent(row.id.toLowerCase(), file.contents);
      const ready = await repos.adjuntos.finalizar(row.id);
      await this.audit(repos, actor, requestId, 'ADJUNTO_LISTO', ready, 201);
      return { adjunto: publicAttachment(ready), repetido: false };
    });
  }
  async listar(invoiceId: number, userId: number, requestId: string) {
    valid(idSchema, invoiceId); valid(idSchema, userId); valid(z.uuid(), requestId);
    return this.uow.ejecutar(async (repos) => {
      const actor = await this.actor(repos, userId); await this.invoice(repos, invoiceId);
      const rows = await repos.adjuntos.listar(invoiceId);
      await repos.auditoria.registrar({ requestId, action: 'ADJUNTOS_CONSULTADOS', result: 'EXITO', userId,
        tenantId: actor.entraTenantId, objectId: actor.entraObjectId, entityId: String(invoiceId), code: 'ADJUNTOS_CONSULTADOS',
        httpStatus: 200, before: null, after: { cantidad: rows.length } });
      return { data: rows.map(publicAttachment) };
    });
  }
  async descargar(invoiceId: number, attachmentId: string, userId: number, requestId: string) {
    valid(idSchema, invoiceId); valid(idSchema, userId); valid(z.uuid(), requestId);
    const id = valid(attachmentIdSchema, attachmentId);
    return this.uow.ejecutar(async (repos) => {
      const actor = await this.actor(repos, userId); await this.invoice(repos, invoiceId);
      const row = await repos.adjuntos.obtener(id);
      if (!row || row.facturaId !== invoiceId || row.estado !== 'LISTO') throw new PurchaseError('ATTACHMENT_NOT_FOUND', 'El adjunto no está disponible en esta factura.');
      const contents = await this.store.read(id);
      if (contents.length !== row.bytes || createHash('sha256').update(contents).digest('hex') !== row.sha256) {
        throw new PurchaseError('ATTACHMENT_INTEGRITY', 'El contenido no coincide con su registro.');
      }
      // Se audita autorización y preparación, no se afirma que el cliente recibió todos los bytes.
      await this.audit(repos, actor, requestId, 'ADJUNTO_DESCARGA_AUTORIZADA', row, 200);
      return { adjunto: publicAttachment(row), contents };
    });
  }
}

export class AttachmentCleanup {
  constructor(private readonly uow: AttachmentUnitOfWork, private readonly store: AttachmentStore) {}
  async pendientes() { return this.uow.ejecutar(async (repos) => (await repos.adjuntos.caducados()).map(publicAttachment)); }
  async ejecutar() {
    const candidates = await this.pendientes(); let deleted = 0;
    for (const item of candidates) {
      await this.uow.ejecutar(async (repos) => {
        await repos.adjuntos.bloquear(`objeto:${item.id.toLowerCase()}`);
        const row = await repos.adjuntos.obtener(item.id);
        if (!row || row.estado !== 'PENDIENTE' || !row.caducado) return;
        await this.store.remove(row.id.toLowerCase());
        await repos.adjuntos.eliminar(row.id);
        await repos.auditoria.registrar({ requestId: randomUUID(), action: 'ADJUNTO_LIMPIADO', result: 'EXITO',
          userId: null, tenantId: null, objectId: null, entityId: row.id, code: 'EXPIRED_UPLOAD_CLEANED', httpStatus: 200,
          before: { estado: 'PENDIENTE' }, after: { estado: 'ELIMINADO' } });
        deleted++;
      });
    }
    return { candidatos: candidates.length, eliminados: deleted };
  }
}
