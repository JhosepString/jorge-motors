import { z } from 'zod';
import type { CatalogRepositories, CatalogUnitOfWork, ProductoCatalogo } from './contracts.js';
import { CatalogError } from '../domain/catalog-error.js';
import type { UsuarioInventario, Repositories } from '../../inventario/application/contracts.js';
import type { AuditEvent } from '../../auditoria/application/contracts.js';
import type { StockCambiado } from '../../alertas/application/contracts.js';
import type { TransactionalPublisher } from '../../../shared/transactional-publisher.js';

const idSchema = z.number().int().positive().max(2_147_483_647);
export const categoryVersionSchema = z.string().regex(/^[0-9a-fA-F]{16}$/).transform((value) => value.toUpperCase());
export const productVersionSchema = z.string().regex(/^[0-9a-fA-F]{32}$/).transform((value) => value.toUpperCase());
export const versionSchema = z.union([categoryVersionSchema, productVersionSchema]);
export const categorySchema = z.object({ nombre: z.string().trim().min(1).max(100) }).strict();
export const editProductSchema = z.object({
  nombre: z.string().trim().min(1).max(150), categoriaId: idSchema,
  stockMinimo: z.number().int().min(0).max(2_147_483_647),
  // DECIMAL(18,2) exacto: no convertir dinero a Number en JavaScript.
  precioCompra: z.string().regex(/^(0|[1-9][0-9]{0,15})\.[0-9]{2}$/),
}).strict();
export const newProductSchema = editProductSchema.extend({
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{0,39}$/),
});
export const pageSchema = z.object({
  despuesDe: z.coerce.number().int().min(0).max(2_147_483_647).default(0),
  limite: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
function valid<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new CatalogError('INVALID_CATALOG_INPUT', 'Revise los campos del catálogo.');
  return result.data;
}

export class CatalogoFacade {
  constructor(private readonly uow: CatalogUnitOfWork,
    private readonly events: TransactionalPublisher<StockCambiado, Repositories>) {}

  private async run<T>(userId: number, requestId: string,
    operation: (repos: CatalogRepositories, actor: UsuarioInventario) => Promise<T>): Promise<T> {
    valid(idSchema, userId); valid(z.uuid(), requestId);
    return this.uow.ejecutar(async (repos) => {
      const actor = await repos.inventario.usuarios.obtener(userId);
      if (!actor?.activo || actor.rol !== 'ADMINISTRADOR') {
        throw new CatalogError('CATALOG_FORBIDDEN', 'Solo un administrador habilitado puede gestionar el catálogo.');
      }
      return operation(repos, actor);
    });
  }

  private audit(repos: CatalogRepositories, actor: UsuarioInventario, requestId: string,
    action: AuditEvent['action'], entityId: number | null, before: AuditEvent['before'], after: AuditEvent['after']) {
    return repos.inventario.auditoria.registrar({
      requestId, action, result: 'EXITO', userId: actor.id, tenantId: actor.entraTenantId, objectId: actor.entraObjectId,
      entityId: entityId === null ? null : String(entityId), code: action,
      httpStatus: action.endsWith('_CREADA') || action === 'PRODUCTO_CREADO' ? 201 : 200, before, after,
    });
  }

  async listar(tipo: 'categorias' | 'productos', query: unknown, userId: number, requestId: string) {
    const page = valid(pageSchema, query);
    return this.run(userId, requestId, async (repos, actor) => {
      const rows = await repos[tipo].listar(page.despuesDe, page.limite + 1);
      const data = rows.slice(0, page.limite);
      await this.audit(repos, actor, requestId, 'CATALOGO_CONSULTADO', null, null, { tipo, cantidad: data.length });
      return { data, siguiente: rows.length > page.limite ? data.at(-1)!.id : null };
    });
  }

  async obtenerProducto(id: number, userId: number, requestId: string) {
    valid(idSchema, id);
    return this.run(userId, requestId, async (repos, actor) => {
      const product = await repos.productos.obtener(id, false);
      if (!product) throw new CatalogError('CATALOG_PRODUCT_NOT_FOUND', 'El producto no existe.');
      await this.audit(repos, actor, requestId, 'CATALOGO_CONSULTADO', id, null, { tipo: 'producto' });
      return product;
    });
  }

  async crearCategoria(input: unknown, userId: number, requestId: string) {
    const data = valid(categorySchema, input);
    return this.run(userId, requestId, async (repos, actor) => {
      const created = await repos.categorias.crear(data.nombre);
      await this.audit(repos, actor, requestId, 'CATEGORIA_CREADA', created.id, null, { ...created });
      return created;
    });
  }

  async actualizarCategoria(id: number, input: unknown, version: string, userId: number, requestId: string) {
    valid(idSchema, id); const data = valid(categorySchema, input); const expected = valid(categoryVersionSchema, version);
    return this.run(userId, requestId, async (repos, actor) => {
      const previous = await repos.categorias.obtener(id, true);
      if (!previous) throw new CatalogError('CATEGORY_NOT_FOUND', 'La categoría no existe.');
      const updated = await repos.categorias.actualizar(id, data.nombre, expected);
      await this.audit(repos, actor, requestId, 'CATEGORIA_ACTUALIZADA', id, { ...previous }, { ...updated });
      return updated;
    });
  }

  private evaluate(repos: CatalogRepositories, product: ProductoCatalogo, actor: UsuarioInventario, requestId: string, httpStatus: 200 | 201) {
    return this.events.publicar({ movimientoId: null, stockActual: product.stockActual,
      producto: product, usuario: actor, requestId, httpStatus }, repos.inventario);
  }

  async crearProducto(input: unknown, userId: number, requestId: string) {
    const data = valid(newProductSchema, input);
    return this.run(userId, requestId, async (repos, actor) => {
      if (!await repos.categorias.obtener(data.categoriaId)) throw new CatalogError('CATEGORY_NOT_FOUND', 'La categoría no existe.');
      const product = await repos.productos.crear(data); // Stock inicial siempre cero.
      await this.audit(repos, actor, requestId, 'PRODUCTO_CREADO', product.id, null, { ...product });
      await this.evaluate(repos, product, actor, requestId, 201);
      return product;
    });
  }

  async actualizarProducto(id: number, input: unknown, version: string, userId: number, requestId: string) {
    valid(idSchema, id); const data = valid(editProductSchema, input); const expected = valid(productVersionSchema, version);
    return this.run(userId, requestId, async (repos, actor) => {
      const previous = await repos.productos.obtener(id, true);
      if (!previous) throw new CatalogError('CATALOG_PRODUCT_NOT_FOUND', 'El producto no existe.');
      if (!previous.activo) throw new CatalogError('CATALOG_PRODUCT_INACTIVE', 'El producto está inactivo.');
      if (!await repos.categorias.obtener(data.categoriaId)) throw new CatalogError('CATEGORY_NOT_FOUND', 'La categoría no existe.');
      const product = await repos.productos.actualizar(id, data, expected);
      await this.audit(repos, actor, requestId, 'PRODUCTO_ACTUALIZADO', id, { ...previous }, { ...product });
      await this.evaluate(repos, product, actor, requestId, 200);
      return product;
    });
  }
}
