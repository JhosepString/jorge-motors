import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(await fs.readFile(new URL('deployment/fixtures/inventario-demo-5000.preview.json', root), 'utf8'));
const workbook = Workbook.create();
const summary = workbook.worksheets.add('Resumen');
const products = workbook.worksheets.add('Productos');
const categories = workbook.worksheets.add('Categorías');
const suppliers = workbook.worksheets.add('Proveedores');
for (const sheet of [summary, products, categories, suppliers]) sheet.showGridLines = false;

const navy = '#1D2932';
const brown = '#956E50';
const pale = '#F5F1ED';
function header(sheet, range) {
  sheet.getRange(range).format = { fill: navy, font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' }, rowHeight: 25 };
}
function body(sheet, range) {
  sheet.getRange(range).format.font = { name: 'Arial', size: 10, color: navy };
}

summary.getRange('A2').values = [['Inventario ficticio de Jorge Motors']];
summary.getRange('A2').format.font = { name: 'Arial', size: 15, bold: true, color: navy };
summary.getRange('A4:B4').values = [['Estado de esta propuesta', 'VISTA PREVIA · SIN CARGAR']];
summary.getRange('B4').format = { fill: pale, font: { name: 'Arial', size: 10, bold: true, color: brown } };
summary.getRange('A6:B11').values = [
  ['Indicador', 'Cantidad'],
  ['SKU propuestos', manifest.summary.products],
  ['Categorías propuestas', manifest.summary.categories],
  ['Proveedores ficticios', manifest.summary.suppliers],
  ['Unidades iniciales propuestas', manifest.summary.initialUnits],
  ['Entradas iniciales si se carga', manifest.products.filter((p) => p.stockInicial > 0).length],
];
header(summary, 'A6:B6');
body(summary, 'A7:B11');
summary.getRange('B7:B11').setNumberFormat('#,##0');
summary.getRange('A14:B17').values = [
  ['Estado de stock', 'Productos'],
  ['Normal', manifest.summary.states.NORMAL],
  ['Bajo mínimo', manifest.summary.states.BAJO_MINIMO],
  ['Agotado', manifest.summary.states.AGOTADO],
];
header(summary, 'A14:B14');
body(summary, 'A15:B17');
summary.getRange('B15:B17').setNumberFormat('#,##0');
summary.getRange('A20').values = [['Alcance del catálogo']];
summary.getRange('A20').format.font = { name: 'Arial', size: 11, bold: true, color: navy };
summary.getRange('A21').values = [['Datos sintéticos para pruebas de volumen, alertas, búsqueda y sincronización.']];
summary.getRange('A22').values = [['Los precios son ficticios; no representan una valoración contable.']];
summary.getRange('A23').values = [['La aplicación actual no guarda compatibilidad vehicular, ubicación ni relación producto-proveedor.']];
body(summary, 'A21:A23');
summary.getRange('A:A').format.columnWidth = 74;
summary.getRange('B:B').format.columnWidth = 24;
summary.getRange('A4:B4').format.rowHeight = 25;

products.getRange('A1:G1').values = [['SKU', 'Nombre', 'Categoría', 'Precio compra (PEN)', 'Stock mínimo', 'Stock inicial', 'Estado']];
for (let i = 0; i < manifest.products.length; i += 500) {
  const rows = manifest.products.slice(i, i + 500).map((p) => [
    p.sku, p.nombre, p.categoria, Number(p.precioCompra), p.stockMinimo, p.stockInicial, p.estado,
  ]);
  products.getRangeByIndexes(i + 1, 0, rows.length, 7).values = rows;
}
header(products, 'A1:G1');
body(products, 'A2:G5001');
products.getRange('A:A').format.columnWidth = 25;
products.getRange('B:B').format.columnWidth = 56;
products.getRange('C:C').format.columnWidth = 31;
products.getRange('D:D').format.columnWidth = 23;
products.getRange('E:F').format.columnWidth = 17;
products.getRange('G:G').format.columnWidth = 18;
products.getRange('D2:D5001').setNumberFormat('#,##0.00');
products.getRange('E2:F5001').setNumberFormat('#,##0');
products.freezePanes.freezeRows(1);
products.tables.add('A1:G5001', true, 'CatalogoVistaPrevia');

categories.getRange('A1:C1').values = [['Código', 'Categoría', 'SKU propuestos']];
categories.getRange('A2:C37').values = manifest.categories.map((c) => [
  c.code, c.name, manifest.products.filter((p) => p.categoria === c.name).length,
]);
header(categories, 'A1:C1');
body(categories, 'A2:C37');
categories.getRange('A:A').format.columnWidth = 18;
categories.getRange('B:B').format.columnWidth = 40;
categories.getRange('C:C').format.columnWidth = 19;
categories.freezePanes.freezeRows(1);

suppliers.getRange('A1:C1').values = [['Código', 'Razón social ficticia', 'Correo ficticio']];
suppliers.getRange('A2:C61').values = manifest.suppliers.map((s) => [s.codigo, s.razonSocial, s.correo]);
header(suppliers, 'A1:C1');
body(suppliers, 'A2:C61');
suppliers.getRange('A:A').format.columnWidth = 23;
suppliers.getRange('B:B').format.columnWidth = 48;
suppliers.getRange('C:C').format.columnWidth = 42;
suppliers.freezePanes.freezeRows(1);

workbook.recalculate();
for (const [sheetName, range, file] of [
  ['Resumen', 'A1:B23', 'resumen.png'],
  ['Productos', 'A1:G15', 'productos.png'],
  ['Categorías', 'A1:C18', 'categorias.png'],
  ['Proveedores', 'A1:C15', 'proveedores.png'],
]) {
  const preview = await workbook.render({ sheetName, range, scale: 1.3, format: 'png' });
  await fs.writeFile(new URL(file, import.meta.url), new Uint8Array(await preview.arrayBuffer()));
}
const check = await workbook.inspect({ kind: 'region', sheetId: 'Resumen', range: 'A6:B17', maxChars: 1300 });
console.log(check.ndjson);
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',
  options: { useRegex: true, maxResults: 20 }, summary: 'errores finales' });
console.log(errors.ndjson);
const output = new URL('../../deployment/fixtures/Inventario_Jorge_Motors_5000_vista_previa.xlsx', import.meta.url);
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(fileURLToPath(output));
console.log(`Libro exportado: ${output.pathname}`);
