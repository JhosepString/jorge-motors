import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { inventoryStatus, reportFilterSchema, ReportesFacade, type InventoryReportRow, type ReportUnitOfWork } from '../src/modules/reportes/application/inventory-report.js';

const row: InventoryReportRow = { id: 1, sku: 'F-1', nombre: 'Filtro', categoriaId: 1, categoria: 'Filtros', stockActual: 0,
  stockMinimo: 2, precioCompra: '20.00', activo: true };
test('Reportes: filtros estrictos, booleanos explícitos y sin filtros libres', () => {
  assert.deepEqual(reportFilterSchema.parse({}), { incluirInactivos: false, soloBajoMinimo: false });
  assert.equal(reportFilterSchema.parse({ incluirInactivos: 'false' }).incluirInactivos, false);
  for (const filter of [{ formato: 'pdf' }, { categoriaId: '1 OR 1=1' }, { incluirInactivos: '1' }]) assert.equal(reportFilterSchema.safeParse(filter).success, false);
});
test('Reportes: estado puro, mínimo inclusivo y producto inactivo distinguido de agotado', () => {
  assert.equal(inventoryStatus(row), 'AGOTADO'); assert.equal(inventoryStatus({ ...row, stockActual: 2 }), 'BAJO_MINIMO');
  assert.equal(inventoryStatus({ ...row, stockActual: 3 }), 'NORMAL'); assert.equal(inventoryStatus({ ...row, activo: false }), 'INACTIVO');
});
test('Reportes: datos inválidos no abren transacción', async () => {
  let calls = 0;
  const uow: ReportUnitOfWork = { ejecutar: async () => { calls++; throw new Error('No acceder.'); } };
  await assert.rejects(new ReportesFacade(uow).inventario({ sql: 'x' }, 1, randomUUID()), { code: 'INVALID_REPORT_INPUT' }); assert.equal(calls, 0);
});
