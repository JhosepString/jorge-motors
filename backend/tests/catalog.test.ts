import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { categorySchema, editProductSchema, newProductSchema, pageSchema, CatalogoFacade } from '../src/modules/catalogo/application/catalogo.facade.js';
import { catalogCommand } from '../src/cli/catalog-command.js';
import { inventoryEvents } from '../src/infrastructure/inventory-events.js';
import type { CatalogRepositories, CatalogUnitOfWork } from '../src/modules/catalogo/application/contracts.js';

const validProduct = { sku: 'fil-01', nombre: 'Filtro', categoriaId: 1, stockMinimo: 2, precioCompra: '25.00' };
test('Catálogo: normaliza SKU/nombres y rechaza campos de identidad, stock y activación', () => {
  assert.equal(newProductSchema.parse(validProduct).sku, 'FIL-01');
  assert.equal(categorySchema.parse({ nombre: ' Filtros ' }).nombre, 'Filtros');
  for (const field of ['stockActual', 'cantidad', 'usuarioId', 'activo', 'version', 'rol']) {
    assert.equal(newProductSchema.safeParse({ ...validProduct, [field]: 99 }).success, false);
  }
  assert.equal(editProductSchema.safeParse(validProduct).success, false); // SKU no editable.
});
test('Catálogo: dinero exacto como texto decimal, sin redondear ni aceptar notación exponencial', () => {
  for (const amount of ['0.00', '25.10', '9999999999999999.99']) {
    assert.equal(newProductSchema.parse({ ...validProduct, precioCompra: amount }).precioCompra, amount);
  }
  for (const amount of [25.1, '25.1', '1e3', '-1.00', '01.00', '10000000000000000.00']) {
    assert.equal(newProductSchema.safeParse({ ...validProduct, precioCompra: amount }).success, false);
  }
});
test('Catálogo: páginas acotadas y cantidades compatibles con INT de SQL', () => {
  assert.deepEqual(pageSchema.parse({}), { despuesDe: 0, limite: 25 });
  for (const input of [{ limite: 101 }, { limite: 0 }, { despuesDe: -1 }, { buscar: 'no soportado' }]) {
    assert.equal(pageSchema.safeParse(input).success, false);
  }
  for (const input of [{ stockMinimo: -1 }, { stockMinimo: 2.5 }, { categoriaId: 0 }, { stockMinimo: 2_147_483_648 }]) {
    assert.equal(newProductSchema.safeParse({ ...validProduct, ...input }).success, false);
  }
});
test('Catálogo: DTO inválido falla antes de acceder a SQL', async () => {
  let calls = 0;
  const uow: CatalogUnitOfWork = { ejecutar: async () => { calls++; throw new Error('No se debe ejecutar'); } };
  const facade = new CatalogoFacade(uow, inventoryEvents());
  await assert.rejects(facade.crearProducto({ ...validProduct, stockActual: 5 }, 1, randomUUID()), { code: 'INVALID_CATALOG_INPUT' });
  assert.equal(calls, 0);
});
test('Catálogo: la Facade también exige administrador activo sin depender del middleware', async () => {
  for (const actor of [undefined, { activo: false, rol: 'ADMINISTRADOR' }, { activo: true, rol: 'MECANICO' }]) {
    const uow: CatalogUnitOfWork = { ejecutar: async (operation) => operation({
      inventario: { usuarios: { obtener: async () => actor } },
    } as unknown as CatalogRepositories) };
    await assert.rejects(new CatalogoFacade(uow, inventoryEvents()).crearCategoria({ nombre: 'Ficticia' }, 1, randomUUID()), { code: 'CATALOG_FORBIDDEN' });
  }
});
test('Cliente catálogo: comandos locales acotados y precio conservado como texto', () => {
  assert.deepEqual(catalogCommand(['categorias']), { method: 'GET', path: '/categorias' });
  const command = catalogCommand(['crear-producto', 'fil-01', 'Filtro', '1', '2', '25.00']);
  assert.deepEqual(command.body, { ...validProduct, sku: 'FIL-01' });
  const edit = catalogCommand(['editar-categoria', '1', '00000000000000ab', 'Filtros']);
  assert.equal(edit.version, '00000000000000AB');
  for (const args of [['https://example.org'], ['producto', '../1'], ['crear-categoria'], ['productos', 'extra']]) {
    assert.throws(() => catalogCommand(args));
  }
});
