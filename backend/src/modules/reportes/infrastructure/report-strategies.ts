import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { create as createFont } from 'fontkit';
import { ReportError, MAX_REPORT_BYTES, type InventoryReport, type InventoryReportStrategy } from '../application/inventory-report.js';

const require = createRequire(import.meta.url);
const labels = ['SKU', 'Producto', 'Categoría', 'Stock', 'Mínimo', 'Precio compra (PEN)', 'Estado'];
const widths = [82, 190, 110, 56, 56, 150, 125];
function context(report: InventoryReport) {
  return `Categoría: ${report.filtros.categoriaId ?? 'todas'} | Inactivos: ${report.filtros.incluirInactivos ? 'sí' : 'no'} | Solo bajo mínimo: ${report.filtros.soloBajoMinimo ? 'sí' : 'no'}`;
}
function summary(report: InventoryReport) {
  const s = report.resumen;
  return `Productos: ${s.productos} | Agotados: ${s.agotados} | Bajo mínimo (incluye agotados): ${s.bajoMinimo} | Inactivos: ${s.inactivos}`;
}
export function exactPen(value: string) {
  if (!/^\d{1,16}\.\d{2}$/.test(value)) throw new Error('Importe SQL incompatible.');
  const [whole, cents] = value.split('.');
  return `S/ ${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}
export function excelPrice(value: string) {
  if (!/^\d{1,16}\.\d{2}$/.test(value)) throw new Error('Importe SQL incompatible.');
  const cents = BigInt(value.replace('.', ''));
  // 15 cifras como máximo, incluidos centavos. Nunca convertir primero a Number.
  if (cents > 999_999_999_999_999n) throw new ReportError('REPORT_EXCEL_PRECISION', 'Un precio excede la precisión segura de Excel. Exporte en PDF para conservar el importe exacto.');
  return Number(cents) / 100;
}

export class ExcelInventoryStrategy implements InventoryReportStrategy {
  async generar(report: InventoryReport, generadoEn: string): Promise<Buffer> {
    const prices = report.data.map((row) => excelPrice(row.precioCompra));
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Jorge Motors'; workbook.created = new Date(generadoEn);
    const sheet = workbook.addWorksheet('Inventario', { views: [{ state: 'frozen', xSplit: 2, ySplit: 8, showGridLines: false }],
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '8:8' } });
    [10, 28, 52, 34, 14, 14, 30, 22].forEach((width, i) => { sheet.getColumn(i + 1).width = width; });
    sheet.getCell('A2').value = 'Jorge Motors - Inventario técnico';
    sheet.getCell('A2').font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF17365D' } };
    sheet.getRow(2).height = 26;
    sheet.getCell('A3').value = 'Fecha UTC'; sheet.getCell('B3').value = new Date(generadoEn);
    sheet.getCell('B3').numFmt = 'yyyy-mm-dd hh:mm:ss';
    sheet.getCell('A4').value = context(report); sheet.getCell('A5').value = summary(report);
    sheet.getCell('A6').value = 'Consulta congelada al generar. PEN; precios de compra, no valorización contable.';
    sheet.getRow(6).font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF596579' } };
    const header = sheet.getRow(8); header.values = ['ID', ...labels]; header.height = 30;
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17365D' } };
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    report.data.forEach((item, i) => {
      // Texto explícito, nunca objetos formula/hyperlink ni CSV interpretado por Excel.
      const row = sheet.addRow([item.id, item.sku, item.nombre, item.categoria, item.stockActual, item.stockMinimo, prices[i]!, item.estado]);
      row.font = { name: 'Arial', size: 10, color: { argb: 'FF202B3C' } };
      row.alignment = { vertical: 'middle', wrapText: true };
      row.height = Math.max(24, 15 * Math.max(Math.ceil(item.sku.length / 24), Math.ceil(item.nombre.length / 44), Math.ceil(item.categoria.length / 28)) + 8);
      for (const col of [1, 5, 6, 7]) row.getCell(col).alignment = { horizontal: 'right', vertical: 'middle' };
      row.getCell(7).numFmt = '"S/ "#,##0.00';
      if (i % 2 === 0) row.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F5F9' } }; });
    });
    sheet.autoFilter = { from: 'A8', to: `H${Math.max(8, 8 + report.data.length)}` };
    if (!report.data.length) sheet.getCell('A9').value = 'Sin productos para estos filtros.';
    sheet.eachRow((row, index) => { if (index !== 2 && index !== 6 && index !== 8 && index < 9) row.font = { name: 'Arial', size: 10 }; });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}

// Fuente OFL distribuida como dependencia: funciona en Windows y Linux sin rutas del equipo.
let fonts: { regular: Buffer; bold: Buffer; check: ReturnType<typeof createFont> } | undefined;
function reportFonts() {
  if (!fonts) {
    const regular = readFileSync(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'));
    const bold = readFileSync(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff'));
    fonts = { regular, bold, check: createFont(regular) };
  }
  return fonts;
}
export class PdfInventoryStrategy implements InventoryReportStrategy {
  async generar(report: InventoryReport, generadoEn: string): Promise<Buffer> {
    const font = reportFonts();
    const clean = (text: string) => text.normalize('NFC').replace(/[\r\n\t]/g, ' ');
    const rows = report.data.map((item) => [item.sku, item.nombre, item.categoria, String(item.stockActual), String(item.stockMinimo), exactPen(item.precioCompra), item.estado].map(clean));
    for (const text of rows.flat()) {
      if ([...text].some((c) => !('hasGlyphForCodePoint' in font.check) || !font.check.hasGlyphForCodePoint(c.codePointAt(0)!))) {
        throw new ReportError('REPORT_PDF_TEXT', 'El PDF no admite algún carácter del catálogo. Exporte en Excel para conservar ese texto.');
      }
    }
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true,
        info: { Title: 'Jorge Motors - Inventario técnico', Author: 'Jorge Motors', CreationDate: new Date(generadoEn) } });
      const chunks: Buffer[] = []; let bytes = 0;
      doc.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_REPORT_BYTES) doc.destroy(new ReportError('REPORT_TOO_LARGE', 'El archivo excede el límite de exportación.'));
        else chunks.push(chunk);
      });
      doc.once('error', reject); doc.once('end', () => resolve(Buffer.concat(chunks)));
      try {
        doc.registerFont('Body', font.regular); doc.registerFont('Heading', font.bold);
        let y = 0;
        const header = () => {
          doc.fillColor('#17365D').font('Heading').fontSize(17).text('Jorge Motors - Inventario técnico', 36, 32);
          doc.fillColor('#445166').font('Body').fontSize(9).text(`Generado UTC: ${generadoEn}`, 36, 60);
          doc.text(context(report), 36, 77); doc.text(summary(report), 36, 94);
          doc.fontSize(8).text('Consulta congelada al generar. PEN; precios de compra, no valorización contable.', 36, 111);
          y = 134;
          doc.rect(36, y, 769, 28).fill('#17365D');
          let x = 36;
          labels.forEach((label, i) => { doc.fillColor('#FFFFFF').font('Heading').fontSize(8).text(label, x + 5, y + 8, { width: widths[i]! - 10 }); x += widths[i]!; });
          y += 28;
        };
        header();
        if (!rows.length) doc.fillColor('#202B3C').font('Body').fontSize(10).text('Sin productos para estos filtros.', 42, y + 12);
        rows.forEach((row, index) => {
          doc.font('Body').fontSize(8);
          const height = Math.max(27, ...row.map((text, i) => doc.heightOfString(text, { width: widths[i]! - 10 }) + 14));
          if (height > 340) throw new ReportError('REPORT_PDF_TEXT', 'Un texto no cabe en el reporte PDF. Exporte en Excel.');
          if (y + height > 540) { doc.addPage(); header(); }
          if (index % 2 === 0) doc.rect(36, y, 769, height).fill('#F2F5F9');
          let x = 36;
          row.forEach((text, i) => {
            doc.fillColor('#202B3C').font('Body').fontSize(8).text(text, x + 5, y + 7, { width: widths[i]! - 10, align: i >= 3 && i <= 5 ? 'right' : 'left' });
            x += widths[i]!;
          });
          y += height;
        });
        const pages = doc.bufferedPageRange();
        for (let page = pages.start; page < pages.start + pages.count; page++) {
          doc.switchToPage(page); doc.fillColor('#596579').font('Body').fontSize(8)
            .text(`Uso administrativo | Página ${page + 1} de ${pages.count}`, 36, 546, { width: 769, align: 'right', lineBreak: false });
        }
        doc.end();
      } catch (error) { doc.destroy(); reject(error); }
    });
  }
}
