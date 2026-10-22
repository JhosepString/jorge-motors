// Muestra reproducible con datos ficticios; no carga .env, SQL ni Microsoft.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ExcelInventoryStrategy, PdfInventoryStrategy } from '../src/modules/reportes/infrastructure/report-strategies.js';
import type { InventoryReport } from '../src/modules/reportes/application/inventory-report.js';
const states = ['AGOTADO', 'BAJO_MINIMO', 'NORMAL', 'INACTIVO'] as const;
const report: InventoryReport = { moneda: 'PEN', filtros: { incluirInactivos: true, soloBajoMinimo: false },
  resumen: { productos: 18, agotados: 5, bajoMinimo: 10, inactivos: 4 },
  data: Array.from({ length: 18 }, (_, i) => ({ id: i + 1, sku: `DEMO-${String(i + 1).padStart(3, '0')}`,
    nombre: i === 0 ? 'Filtro técnico académico - pieza de prueba con descripción extensa para comprobar saltos de línea sin perder información del producto en la tabla del reporte.' : `Repuesto ficticio ${i + 1} - mecánica y lubricación`,
    categoriaId: 1, categoria: i === 0 ? 'Categoría de prueba con denominación extensa para verificar el ajuste visual' : 'Repuestos y accesorios',
    stockActual: i === 2 ? 2_147_483_647 : i % 4 === 0 ? 0 : i % 4 === 1 ? 2 : 5,
    stockMinimo: 2, precioCompra: i === 0 ? '9999999999999.99' : '25.50', activo: i % 4 !== 3, estado: states[i % 4]! })) };
const root = resolve('.local-data', 'report-qa'); await mkdir(root, { recursive: true });
const date = '2026-10-21T12:00:00.000Z';
await writeFile(resolve(root, 'inventario-demo.pdf'), await new PdfInventoryStrategy().generar(report, date));
await writeFile(resolve(root, 'inventario-demo.xlsx'), await new ExcelInventoryStrategy().generar(report, date));
console.info(`Muestras ficticias: ${root}`);
