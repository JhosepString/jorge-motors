import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { calculateInvoice, invoiceCreateSchema, invoiceEditSchema, requireDraft } from '../src/modules/compras/domain/invoice.js';
import { FacturasFacade } from '../src/modules/compras/application/facturas.facade.js';
import type { InvoiceUnitOfWork } from '../src/modules/compras/application/invoice-contracts.js';
import { inventoryEvents } from '../src/infrastructure/inventory-events.js';
import { invoiceCommand } from '../src/cli/invoice-command.js';

const line = { productoId: 1, cantidad: 3, precioUnitario: '0.10' };
const input = { proveedorId: 1, numero: ' f001-001 ', fecha: '2026-10-21', moneda: 'PEN', lineas: [line] };
test('Facturas: fecha real, moneda PEN, número normalizado y datos estrictos', () => {
  assert.equal(invoiceCreateSchema.parse(input).numero, 'F001-001');
  assert.equal(invoiceCreateSchema.safeParse({ ...input, fecha: '2024-02-29' }).success, true);
  for (const extra of [{ moneda: 'USD' }, { fecha: '2026-02-29' }, { fecha: '2026-04-31' }, { fecha: '2026-13-01' },
    { total: '0.30' }, { usuarioId: 1 }, { estado: 'RECIBIDA' }, { numero: 'X\r\nY' }]) {
    assert.equal(invoiceCreateSchema.safeParse({ ...input, ...extra }).success, false);
  }
});
test('Facturas: importes exactos sin coma flotante, incluidos DECIMAL(18,2) y cero', () => {
  assert.equal(calculateInvoice([line, { ...line, productoId: 2, precioUnitario: '0.20' }]).total, '0.90');
  assert.equal(calculateInvoice([{ ...line, cantidad: 1, precioUnitario: '9999999999999999.99' }]).total, '9999999999999999.99');
  assert.equal(calculateInvoice([{ ...line, precioUnitario: '0.00' }]).total, '0.00');
});
test('Facturas: rechaza desbordamiento por línea y por suma antes de SQL', () => {
  assert.throws(() => calculateInvoice([{ ...line, cantidad: 2, precioUnitario: '9999999999999999.99' }]), { code: 'INVOICE_AMOUNT_LIMIT' });
  assert.throws(() => calculateInvoice([{ ...line, cantidad: 1, precioUnitario: '9999999999999999.99' },
    { ...line, productoId: 2, cantidad: 1 }]), { code: 'INVOICE_AMOUNT_LIMIT' });
});
test('Facturas: 1–50 líneas únicas, unidades enteras y precios finales de dos decimales', () => {
  for (const lines of [[], [line, line], Array.from({ length: 51 }, (_, i) => ({ ...line, productoId: i + 1 })),
    [{ ...line, cantidad: 0 }], [{ ...line, cantidad: 1.5 }], [{ ...line, precioUnitario: 20 }], [{ ...line, precioUnitario: '0.001' }]]) {
    assert.equal(invoiceCreateSchema.safeParse({ ...input, lineas: lines }).success, false);
  }
  assert.equal(invoiceEditSchema.safeParse({ fecha: input.fecha, lineas: [line], proveedorId: 2 }).success, false);
});
test('Facturas: finalizadas no admiten transiciones de borrador', () => {
  requireDraft('BORRADOR');
  for (const state of ['RECIBIDA', 'ANULADA'] as const) assert.throws(() => requireDraft(state), { code: 'INVOICE_NOT_DRAFT' });
});
test('Facturas: entrada inválida o desbordada no abre transacción', async () => {
  let calls = 0;
  const uow: InvoiceUnitOfWork = { ejecutar: async () => { calls++; throw new Error('No debe acceder.'); } };
  const facade = new FacturasFacade(uow, inventoryEvents());
  await assert.rejects(facade.crear({}, 1, randomUUID()), { code: 'INVALID_INVOICE_INPUT' });
  await assert.rejects(facade.crear({ ...input, lineas: [{ ...line, precioUnitario: '9999999999999999.99' }] }, 1, randomUUID()), { code: 'INVOICE_AMOUNT_LIMIT' });
  assert.equal(calls, 0);
});
test('Facturas CLI: JSON local, destinos acotados y clave explícita estable para reintentos', () => {
  assert.deepEqual(invoiceCommand(['listar']), { method: 'GET', path: '' });
  assert.equal(invoiceCommand(['crear', 'archivo.json']).file, 'archivo.json');
  const key = randomUUID();
  const command = invoiceCommand(['confirmar', '1', '00000000000007D4', key]);
  assert.equal(command.key, key); assert.equal(command.path, '/1/confirmar');
  for (const args of [['ver', '../'], ['confirmar', '1', '00000000000007D4'], ['confirmar', '1', '00000000000007D4', 'invalida']]) {
    assert.throws(() => invoiceCommand(args));
  }
});
