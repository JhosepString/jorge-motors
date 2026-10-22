import { z } from 'zod';
import { PurchaseError } from './purchase-error.js';

const id = z.number().int().positive().max(2_147_483_647);
export const invoiceVersionSchema = z.string().regex(/^[0-9A-F]{16}$/);
const date = z.string().regex(/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
});
export const invoiceLineSchema = z.object({
  productoId: id, cantidad: id,
  precioUnitario: z.string().regex(/^(0|[1-9][0-9]{0,15})\.[0-9]{2}$/),
}).strict();
export const invoiceEditSchema = z.object({ fecha: date,
  lineas: z.array(invoiceLineSchema).min(1).max(50),
}).strict().refine((input) => new Set(input.lineas.map((line) => line.productoId)).size === input.lineas.length,
  'Un producto solo puede aparecer una vez.');
export const invoiceCreateSchema = z.object({
  proveedorId: id, numero: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9/-]{0,39}$/),
  moneda: z.literal('PEN'), fecha: date, lineas: z.array(invoiceLineSchema).min(1).max(50),
}).strict().refine((input) => new Set(input.lineas.map((line) => line.productoId)).size === input.lineas.length,
  'Un producto solo puede aparecer una vez.');
export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;
export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;
export type InvoiceEditInput = z.infer<typeof invoiceEditSchema>;
export type InvoiceStatus = 'BORRADOR' | 'RECIBIDA' | 'ANULADA';
const maxCents = 999_999_999_999_999_999n; // DECIMAL(18,2).
function money(cents: bigint): string { return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`; }
export function calculateInvoice(lines: InvoiceLineInput[]) {
  let total = 0n;
  const calculated = lines.map((line) => {
    const unit = BigInt(line.precioUnitario.replace('.', ''));
    const amount = unit * BigInt(line.cantidad);
    total += amount;
    if (amount > maxCents || total > maxCents) throw new PurchaseError('INVOICE_AMOUNT_LIMIT', 'El importe supera el límite permitido.');
    return { ...line, importe: money(amount) };
  });
  return { lineas: calculated, total: money(total) };
}
// No se declara otro GoF State: estas reglas puras solo validan transiciones del documento.
export function requireDraft(status: InvoiceStatus): void {
  if (status !== 'BORRADOR') throw new PurchaseError('INVOICE_NOT_DRAFT', 'Solo un borrador admite esta operación.');
}
