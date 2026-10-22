import { z } from 'zod';
import { invoiceVersionSchema } from '../modules/compras/domain/invoice.js';

export interface InvoiceCommand {
  method: 'GET' | 'POST' | 'PUT'; path: string; file?: string; version?: string; key?: string; body?: object;
}
export function invoiceCommand(args: string[]): InvoiceCommand {
  const [kind, ...values] = args;
  const id = (value: unknown) => z.coerce.number().int().positive().max(2_147_483_647).parse(value);
  const file = (value: unknown) => z.string().min(1).parse(value);
  if (kind === 'listar' && values.length === 0) return { method: 'GET', path: '' };
  if (kind === 'ver' && values.length === 1) return { method: 'GET', path: `/${id(values[0])}` };
  if (kind === 'crear' && values.length === 1) return { method: 'POST', path: '', file: file(values[0]) };
  if (kind === 'editar' && values.length === 3) return { method: 'PUT', path: `/${id(values[0])}`,
    version: invoiceVersionSchema.parse(values[1]), file: file(values[2]) };
  if (kind === 'confirmar' && values.length === 3) return { method: 'POST', path: `/${id(values[0])}/confirmar`,
    version: invoiceVersionSchema.parse(values[1]), key: z.uuid().parse(values[2]).toLowerCase(), body: {} };
  if (kind === 'anular' && values.length === 2) return { method: 'POST', path: `/${id(values[0])}/anular`,
    version: invoiceVersionSchema.parse(values[1]), body: {} };
  throw new Error('Comando de facturas no válido.');
}
