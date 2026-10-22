import { z } from 'zod';
import { categorySchema, editProductSchema, newProductSchema, categoryVersionSchema, productVersionSchema } from '../modules/catalogo/application/catalogo.facade.js';

export interface CatalogCommand { method: 'GET' | 'POST' | 'PUT'; path: string; body?: unknown; version?: string }
export function catalogCommand(args: string[]): CatalogCommand {
  const [kind, ...values] = args;
  const id = (value: unknown) => z.coerce.number().int().positive().max(2_147_483_647).parse(value);
  if (kind === 'categorias' && values.length === 0) return { method: 'GET', path: '/categorias' };
  if (kind === 'productos' && values.length === 0) return { method: 'GET', path: '/productos' };
  if (kind === 'producto' && values.length === 1) return { method: 'GET', path: `/productos/${id(values[0])}` };
  if (kind === 'crear-categoria' && values.length === 1) {
    return { method: 'POST', path: '/categorias', body: categorySchema.parse({ nombre: values[0] }) };
  }
  if (kind === 'editar-categoria' && values.length === 3) {
    return { method: 'PUT', path: `/categorias/${id(values[0])}`, version: categoryVersionSchema.parse(values[1]),
      body: categorySchema.parse({ nombre: values[2] }) };
  }
  if (kind === 'crear-producto' && values.length === 5) {
    return { method: 'POST', path: '/productos', body: newProductSchema.parse({
      sku: values[0], nombre: values[1], categoriaId: id(values[2]), stockMinimo: Number(values[3]), precioCompra: values[4],
    }) };
  }
  if (kind === 'editar-producto' && values.length === 6) {
    return { method: 'PUT', path: `/productos/${id(values[0])}`, version: productVersionSchema.parse(values[1]),
      body: editProductSchema.parse({ nombre: values[2], categoriaId: id(values[3]), stockMinimo: Number(values[4]), precioCompra: values[5] }) };
  }
  throw new Error('Comando de catálogo no válido.');
}
