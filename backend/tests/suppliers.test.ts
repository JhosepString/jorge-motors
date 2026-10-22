import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { editSupplierSchema, newSupplierSchema, ProveedoresFacade } from '../src/modules/compras/application/proveedores.facade.js';
import { supplierCommand } from '../src/cli/supplier-command.js';
import type { SupplierUnitOfWork } from '../src/modules/compras/application/contracts.js';

const input = { codigo: ' prov-001 ', razonSocial: ' Proveedor ficticio Ñ ', correo: 'demo@example.invalid' };
test('Proveedores: normaliza código y nombre; admite contacto sin correo', () => {
  const data = newSupplierSchema.parse(input);
  assert.equal(data.codigo, 'PROV-001'); assert.equal(data.razonSocial, 'Proveedor ficticio Ñ');
  assert.equal(newSupplierSchema.parse({ ...input, correo: null }).correo, null);
});
test('Proveedores: rechaza correo inválido, controles, exceso de longitud y campos de identidad', () => {
  for (const extra of [{ correo: 'a\r\nBcc:x@y.com' }, { correo: 'no-es-correo' }, { razonSocial: '\t' },
    { razonSocial: 'x'.repeat(151) }, { razonSocial: 'Hola\nOtra línea' }, { usuarioId: 1 }, { activo: false },
    { codigo: '../escape' }, { correo: undefined }]) assert.equal(newSupplierSchema.safeParse({ ...input, ...extra }).success, false);
  assert.equal(editSupplierSchema.safeParse({ razonSocial: 'Demo', correo: null, activo: true, codigo: 'OTRO' }).success, false);
});
test('Proveedores: DTO inválido no abre transacción', async () => {
  let calls = 0;
  const uow: SupplierUnitOfWork = { ejecutar: async () => { calls++; throw new Error('No debe acceder.'); } };
  await assert.rejects(new ProveedoresFacade(uow).crear({}, 1, randomUUID()), { code: 'INVALID_SUPPLIER_INPUT' });
  assert.equal(calls, 0);
});
test('Proveedores CLI: restringe rutas, valida booleano explícito y admite sin-correo', () => {
  assert.deepEqual(supplierCommand(['listar']), { method: 'GET', path: '' });
  assert.equal(supplierCommand(['crear', 'p-1', 'Demo', 'sin-correo']).method, 'POST');
  const cmd = supplierCommand(['editar', '1', '00000000000007D4', 'Demo', 'sin-correo', 'false']);
  assert.deepEqual(cmd.body, { razonSocial: 'Demo', correo: null, activo: false });
  for (const args of [['ver', '../'], ['listar', 'extra'], ['editar', '1', '00000000000007D4', 'Demo', 'sin-correo', 'False']]) {
    assert.throws(() => supplierCommand(args));
  }
});
