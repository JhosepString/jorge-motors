import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(await fs.readFile(new URL('deployment/fixtures/inventario-demo-diverso.preview.json', root), 'utf8'));
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

summary.getRange('A2').values = [['Inventario diverso de Jorge Motors']];
summary.getRange('A2').format.font = { name: 'Arial', size: 15, bold: true, color: navy };
summary.getRange('A4:B4').values = [['Estado', 'VISTA PREVIA · SIN CARGAR']];
summary.getRange('B4').format = { fill: pale, font: { name: 'Arial', size: 10, bold: true, color: brown } };
summary.getRange('A6:B14').values = [
  ['Indicador', 'Cantidad'],
  ['Artículos distintos', manifest.summary.products],
  ['Repuestos', manifest.summary.types.REPUESTO],
  ['Herramientas y equipos', manifest.summary.types.HERRAMIENTA],
  ['Consumibles', manifest.summary.types.CONSUMIBLE],
  ['Categorías', manifest.summary.categories],
  ['Proveedores ficticios', manifest.summary.suppliers],
  ['Unidades iniciales', manifest.summary.initialUnits],
  ['Artículos con existencias', manifest.products.filter((p) => p.stockInicial > 0).length],
];
header(summary, 'A6:B6');
body(summary, 'A7:B14');
summary.getRange('B7:B14').setNumberFormat('#,##0');
summary.getRange('A17:B20').values = [
  ['Estado de stock', 'Artículos'],
  ['Normal', manifest.summary.states.NORMAL],
  ['Bajo mínimo', manifest.summary.states.BAJO_MINIMO],
  ['Agotado', manifest.summary.states.AGOTADO],
];
header(summary, 'A17:B17');
body(summary, 'A18:B20');
summary.getRange('A23').values = [['Alcance y pendientes']];
summary.getRange('A23').format.font = { name: 'Arial', size: 11, bold: true, color: navy };
summary.getRange('A24').values = [['Todos los nombres, precios y existencias son ficticios. No se ha cargado nada en Azure SQL.']];
summary.getRange('A25').values = [['Las herramientas requieren préstamo y devolución; la aplicación aún no registra ese ciclo.']];
summary.getRange('A26').values = [['También faltan compatibilidad vehicular, ubicación física y relación producto-proveedor.']];
body(summary, 'A24:A26');
summary.getRange('A:A').format.columnWidth = 95;
summary.getRange('B:B').format.columnWidth = 25;

const productHeaders = ['SKU', 'Nombre', 'Categoría', 'Tipo', 'Control propuesto', 'Unidad', 'Precio compra PEN', 'Stock mínimo', 'Stock inicial', 'Estado'];
products.getRange('A1:J1').values = [productHeaders];
const productRows = manifest.products.map((p) => [p.sku, p.nombre, p.categoria, p.tipo, p.control, p.unidad,
  Number(p.precioCompra), p.stockMinimo, p.stockInicial, p.estado]);
products.getRangeByIndexes(1, 0, productRows.length, 10).values = productRows;
header(products, 'A1:J1');
body(products, 'A2:J601');
for (const [column, width] of Object.entries({ A: 20, B: 53, C: 33, D: 18, E: 26, F: 13, G: 21, H: 17, I: 17, J: 19 })) {
  products.getRange(`${column}:${column}`).format.columnWidth = width;
}
products.getRange('G2:G601').setNumberFormat('#,##0.00');
products.getRange('H2:I601').setNumberFormat('#,##0');
products.freezePanes.freezeRows(1);
products.tables.add('A1:J601', true, 'CatalogoDiversoVistaPrevia');

categories.getRange('A1:D1').values = [['Código', 'Categoría', 'Tipo', 'Artículos']];
categories.getRange('A2:D31').values = manifest.categories.map((c) => [c.code, c.name, c.type,
  manifest.products.filter((p) => p.categoria === c.name).length]);
header(categories, 'A1:D1');
body(categories, 'A2:D31');
categories.getRange('A:A').format.columnWidth = 18;
categories.getRange('B:B').format.columnWidth = 42;
categories.getRange('C:C').format.columnWidth = 18;
categories.getRange('D:D').format.columnWidth = 18;
categories.freezePanes.freezeRows(1);

suppliers.getRange('A1:C1').values = [['Código', 'Razón social ficticia', 'Correo ficticio']];
suppliers.getRange('A2:C13').values = manifest.suppliers.map((s) => [s.codigo, s.razonSocial, s.correo]);
header(suppliers, 'A1:C1');
body(suppliers, 'A2:C13');
suppliers.getRange('A:A').format.columnWidth = 23;
suppliers.getRange('B:B').format.columnWidth = 48;
suppliers.getRange('C:C').format.columnWidth = 42;
suppliers.freezePanes.freezeRows(1);

workbook.recalculate();
for (const [sheetName, range, file] of [
  ['Resumen', 'A1:B26', 'diverso-resumen.png'],
  ['Productos', 'A1:J13', 'diverso-productos.png'],
  ['Categorías', 'A1:D17', 'diverso-categorias.png'],
  ['Proveedores', 'A1:C13', 'diverso-proveedores.png'],
]) {
  const preview = await workbook.render({ sheetName, range, scale: 1.3, format: 'png' });
  await fs.writeFile(new URL(file, import.meta.url), new Uint8Array(await preview.arrayBuffer()));
}
const check = await workbook.inspect({ kind: 'region', sheetId: 'Resumen', range: 'A6:B20', maxChars: 2000 });
console.log(check.ndjson);
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',
  options: { useRegex: true, maxResults: 20 }, summary: 'errores finales' });
console.log(errors.ndjson);
const output = new URL('../../deployment/fixtures/Inventario_Jorge_Motors_diverso_vista_previa.xlsx', import.meta.url);
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(fileURLToPath(output));
console.log(`Libro exportado: ${fileURLToPath(output)}`);
