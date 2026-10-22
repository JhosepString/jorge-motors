import { z } from 'zod';
import { PurchaseError } from '../domain/purchase-error.js';
import type { Proveedor, SupplierRepositories, SupplierUnitOfWork } from './contracts.js';
import type { UsuarioInventario } from '../../inventario/application/contracts.js';
import type { AuditEvent } from '../../auditoria/application/contracts.js';

const idSchema = z.number().int().positive().max(2_147_483_647);
export const supplierVersionSchema = z.string().regex(/^[0-9A-F]{16}$/);
const nameSchema = z.string().trim().min(1).max(150).regex(/^[^\u0000-\u001f\u007f]+$/);
const emailSchema = z.string().trim().max(254).pipe(z.email()).nullable();
export const newSupplierSchema = z.object({
  codigo: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{0,39}$/),
  razonSocial: nameSchema, correo: emailSchema,
}).strict();
export const editSupplierSchema = z.object({ razonSocial: nameSchema, correo: emailSchema, activo: z.boolean() }).strict();
const pageSchema = z.object({
  despuesDe: z.coerce.number().int().min(0).max(2_147_483_647).default(0),
  limite: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
function valid<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new PurchaseError('INVALID_SUPPLIER_INPUT', 'Revise los datos del proveedor.');
  return parsed.data;
}
// El correo no se replica en auditoría. Su presencia no es consentimiento ni habilita envíos.
function snapshot(p: Proveedor): NonNullable<AuditEvent['after']> {
  return { id: p.id, codigo: p.codigo, razonSocial: p.razonSocial, correoConfigurado: p.correo !== null,
    activo: p.activo, version: p.version };
}
export class ProveedoresFacade {
  constructor(private readonly uow: SupplierUnitOfWork) {}
  private async run<T>(userId: number, requestId: string,
    operation: (repos: SupplierRepositories, actor: UsuarioInventario) => Promise<T>): Promise<T> {
    valid(idSchema, userId); valid(z.uuid(), requestId);
    return this.uow.ejecutar(async (repos) => {
      const actor = await repos.usuarios.obtener(userId);
      if (!actor?.activo || actor.rol !== 'ADMINISTRADOR') {
        throw new PurchaseError('SUPPLIER_FORBIDDEN', 'Solo un administrador habilitado puede gestionar proveedores.');
      }
      return operation(repos, actor);
    });
  }
  private audit(repos: SupplierRepositories, actor: UsuarioInventario, requestId: string,
    action: AuditEvent['action'], entityId: number | null, before: AuditEvent['before'], after: AuditEvent['after']) {
    return repos.auditoria.registrar({ requestId, action, result: 'EXITO', userId: actor.id,
      tenantId: actor.entraTenantId, objectId: actor.entraObjectId,
      entityId: entityId === null ? null : String(entityId), code: action,
      httpStatus: action === 'PROVEEDOR_CREADO' ? 201 : 200, before, after });
  }
  async listar(query: unknown, userId: number, requestId: string) {
    const page = valid(pageSchema, query);
    return this.run(userId, requestId, async (repos, actor) => {
      const rows = await repos.proveedores.listar(page.despuesDe, page.limite + 1);
      const data = rows.slice(0, page.limite);
      await this.audit(repos, actor, requestId, 'PROVEEDOR_CONSULTADO', null, null, { cantidad: data.length });
      return { data, siguiente: rows.length > page.limite ? data.at(-1)!.id : null };
    });
  }
  async obtener(id: number, userId: number, requestId: string) {
    valid(idSchema, id);
    return this.run(userId, requestId, async (repos, actor) => {
      const row = await repos.proveedores.obtener(id, false);
      if (!row) throw new PurchaseError('SUPPLIER_NOT_FOUND', 'El proveedor no existe.');
      await this.audit(repos, actor, requestId, 'PROVEEDOR_CONSULTADO', id, null, { tipo: 'proveedor' });
      return row;
    });
  }
  async crear(input: unknown, userId: number, requestId: string) {
    const data = valid(newSupplierSchema, input);
    return this.run(userId, requestId, async (repos, actor) => {
      const row = await repos.proveedores.crear(data);
      await this.audit(repos, actor, requestId, 'PROVEEDOR_CREADO', row.id, null, snapshot(row));
      return row;
    });
  }
  async actualizar(id: number, input: unknown, version: string, userId: number, requestId: string) {
    valid(idSchema, id); const data = valid(editSupplierSchema, input); valid(supplierVersionSchema, version);
    return this.run(userId, requestId, async (repos, actor) => {
      const previous = await repos.proveedores.obtener(id, true);
      if (!previous) throw new PurchaseError('SUPPLIER_NOT_FOUND', 'El proveedor no existe.');
      const row = await repos.proveedores.actualizar(id, data, version);
      await this.audit(repos, actor, requestId, 'PROVEEDOR_ACTUALIZADO', id, snapshot(previous), snapshot(row));
      return row;
    });
  }
}
