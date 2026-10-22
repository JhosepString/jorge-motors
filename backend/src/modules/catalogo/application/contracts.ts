import type { Repositories } from '../../inventario/application/contracts.js';

export interface Categoria { id: number; nombre: string; version: string }
export interface ProductoCatalogo {
  id: number; sku: string; nombre: string; categoriaId: number; stockMinimo: number;
  precioCompra: string; activo: boolean; stockActual: number; version: string;
}
export interface ProductoEditable { nombre: string; categoriaId: number; stockMinimo: number; precioCompra: string }
export interface ProductoNuevo extends ProductoEditable { sku: string }
export interface CatalogRepositories {
  inventario: Repositories;
  categorias: {
    obtener(id: number, bloquear?: boolean): Promise<Categoria | undefined>;
    listar(despuesDe: number, limite: number): Promise<Categoria[]>;
    crear(nombre: string): Promise<Categoria>;
    actualizar(id: number, nombre: string, version: string): Promise<Categoria>;
  };
  productos: {
    obtener(id: number, bloquear: boolean): Promise<ProductoCatalogo | undefined>;
    listar(despuesDe: number, limite: number): Promise<ProductoCatalogo[]>;
    crear(input: ProductoNuevo): Promise<ProductoCatalogo>;
    actualizar(id: number, input: ProductoEditable, version: string): Promise<ProductoCatalogo>;
  };
}
export interface CatalogUnitOfWork {
  ejecutar<T>(operation: (repositories: CatalogRepositories) => Promise<T>): Promise<T>;
}
