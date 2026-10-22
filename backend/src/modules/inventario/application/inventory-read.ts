import { z } from 'zod';
import type { UsuarioInventario } from './contracts.js';
import type { AuditRepository, AuditEvent } from '../../auditoria/application/contracts.js';
import { AppError } from '../../../shared/app-error.js';
const int = z.coerce.number().int().min(0).max(2_147_483_647);
export const readPageSchema = z.object({ despuesDe: int.default(0), limite: z.coerce.number().int().min(1).max(100).default(25) }).strict();
export const stockQuerySchema = readPageSchema.extend({ buscar: z.string().trim().max(100).default(''),
  categoriaId: int.refine((n) => n > 0).optional(), estado: z.enum(['TODOS', 'BAJO_MINIMO', 'AGOTADO', 'NORMAL']).default('TODOS') });
export const movementQuerySchema = readPageSchema.extend({ productoId: int.refine((n) => n > 0).optional() });
export interface StockView { id: number; sku: string; nombre: string; categoriaId: number; categoria: string; stockActual: number; stockMinimo: number }
export interface MovementView { id: number; productoId: number; sku: string; nombre: string; usuarioId: number;
  tipo: 'ENTRADA' | 'SALIDA'; cantidad: number; stockAnterior: number; stockResultante: number; motivo: string; referencia: string | null; fecha: Date }
export interface ReadRepositories {
  usuarios: { obtener(id: number): Promise<UsuarioInventario | undefined> }; auditoria: AuditRepository;
  stock(filter: z.output<typeof stockQuerySchema>): Promise<StockView[]>;
  movimientos(filter: z.output<typeof movementQuerySchema>, ownUser: number | null): Promise<MovementView[]>;
  categorias(after: number, limit: number): Promise<{ id: number; nombre: string }[]>;
}
export interface ReadUnitOfWork { ejecutar<T>(operation: (repos: ReadRepositories) => Promise<T>): Promise<T> }
export class InventoryReadFacade {
  constructor(private readonly uow: ReadUnitOfWork) {}
  private async read<F extends { limite: number }, T extends { id: number }>(query: unknown, schema: z.ZodType<F>, userId: number, requestId: string,
    action: AuditEvent['action'], load: (repos: ReadRepositories, actor: UsuarioInventario, input: F) => Promise<T[]>) {
    const parsed = schema.safeParse(query);
    if (!parsed.success || !z.number().int().positive().max(2_147_483_647).safeParse(userId).success || !z.uuid().safeParse(requestId).success) {
      throw new AppError(400, 'INVALID_READ_INPUT', 'Revise búsqueda, filtros y paginación.');
    }
    const page = parsed.data;
    return this.uow.ejecutar(async (repos) => {
      const actor = await repos.usuarios.obtener(userId);
      if (!actor?.activo || !['ADMINISTRADOR', 'MECANICO'].includes(actor.rol)) throw new AppError(403, 'READ_FORBIDDEN', 'Usuario no habilitado.');
      const rows = await load(repos, actor, parsed.data); const data = rows.slice(0, page.limite);
      await repos.auditoria.registrar({ requestId, action, result: 'EXITO', userId, tenantId: actor.entraTenantId, objectId: actor.entraObjectId,
        entityId: null, code: action, httpStatus: 200, before: null, after: { cantidad: data.length, propios: action === 'MOVIMIENTOS_CONSULTADOS' && actor.rol === 'MECANICO' } });
      return { data, siguiente: rows.length > page.limite ? data.at(-1)!.id : null };
    });
  }
  stock(query: unknown, userId: number, requestId: string) {
    return this.read(query, stockQuerySchema, userId, requestId, 'INVENTARIO_CONSULTADO',
      (repos, _actor, input) => repos.stock(input));
  }
  movimientos(query: unknown, userId: number, requestId: string) {
    return this.read(query, movementQuerySchema, userId, requestId, 'MOVIMIENTOS_CONSULTADOS',
      (repos, actor, input) => repos.movimientos(input, actor.rol === 'MECANICO' ? actor.id : null));
  }
  categorias(query: unknown, userId: number, requestId: string) {
    return this.read(query, readPageSchema, userId, requestId, 'INVENTARIO_CONSULTADO',
      (repos, _actor, page) => repos.categorias(page.despuesDe, page.limite + 1));
  }
}
