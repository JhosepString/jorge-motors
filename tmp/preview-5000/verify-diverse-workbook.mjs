import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import { fileURLToPath } from 'node:url';

const path = new URL('../../deployment/fixtures/Inventario_Jorge_Motors_diverso_vista_previa.xlsx', import.meta.url);
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(fileURLToPath(path)));
const products = workbook.worksheets.getItem('Productos');
const last = products.getRange('A601:J601').values[0];
const firstTool = products.getRange('A482:J482').values[0];
if (!last?.[0] || !last?.[9] || firstTool?.[3] !== 'HERRAMIENTA') {
  throw new Error('Faltan artículos o la clasificación de herramientas en el Excel exportado.');
}
console.log(JSON.stringify({ worksheets: workbook.worksheets.items.map((sheet) => sheet.name),
  lastSku: last[0], lastState: last[9], firstToolSku: firstTool[0] }));
