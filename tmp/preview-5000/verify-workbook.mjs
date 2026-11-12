import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import { fileURLToPath } from 'node:url';

const path = new URL('../../deployment/fixtures/Inventario_Jorge_Motors_5000_vista_previa.xlsx', import.meta.url);
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(fileURLToPath(path)));
const products = workbook.worksheets.getItem('Productos');
const last = products.getRange('A5001:G5001').values[0];
if (!last?.[0] || !last?.[6]) throw new Error('Falta la última fila del catálogo.');
console.log(JSON.stringify({ worksheets: workbook.worksheets.items.map((sheet) => sheet.name), lastSku: last[0], lastState: last[6] }));
