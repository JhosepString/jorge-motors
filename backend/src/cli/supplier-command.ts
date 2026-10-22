import { z } from 'zod';
import { editSupplierSchema, newSupplierSchema, supplierVersionSchema } from '../modules/compras/application/proveedores.facade.js';

export interface SupplierCommand { method: 'GET' | 'POST' | 'PUT'; path: string; body?: unknown; version?: string }
export function supplierCommand(args: string[]): SupplierCommand {
  const [kind, ...values] = args;
  const id = (value: unknown) => z.coerce.number().int().positive().max(2_147_483_647).parse(value);
  const email = (value: string | undefined) => value === 'sin-correo' ? null : value;
  if (kind === 'listar' && values.length === 0) return { method: 'GET', path: '' };
  if (kind === 'ver' && values.length === 1) return { method: 'GET', path: `/${id(values[0])}` };
  if (kind === 'crear' && values.length === 3) return { method: 'POST', path: '',
    body: newSupplierSchema.parse({ codigo: values[0], razonSocial: values[1], correo: email(values[2]) }) };
  if (kind === 'editar' && values.length === 5) {
    if (!['true', 'false'].includes(values[4]!)) throw new Error('Use true o false para activo.');
    return { method: 'PUT', path: `/${id(values[0])}`, version: supplierVersionSchema.parse(values[1]),
      body: editSupplierSchema.parse({ razonSocial: values[2], correo: email(values[3]), activo: values[4] === 'true' }) };
  }
  throw new Error('Comando de proveedores no válido.');
}
