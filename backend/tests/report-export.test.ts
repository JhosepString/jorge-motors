import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createServer, get } from 'node:http';
import { once } from 'node:events';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../src/app.js';
import { parseEnvironment } from '../src/config/env.js';
import { unconfiguredServices } from '../src/services.js';
import { ReportesFacade, MAX_REPORT_BYTES, type InventoryReportStrategy, type InventoryReport, type ReportUnitOfWork } from '../src/modules/reportes/application/inventory-report.js';
import { ExcelInventoryStrategy, PdfInventoryStrategy, exactPen, excelPrice } from '../src/modules/reportes/infrastructure/report-strategies.js';
import type { AuditEvent } from '../src/modules/auditoria/application/contracts.js';
import type { UsuarioInventario } from '../src/modules/inventario/application/contracts.js';
import { tenantId, objectId, signTestToken, testVerifier } from './helpers/entra-fixture.js';

const date = '2026-10-21T12:00:00.000Z';
const report: InventoryReport = { moneda: 'PEN', filtros: { incluirInactivos: false, soloBajoMinimo: false },
  resumen: { productos: 1, agotados: 1, bajoMinimo: 1, inactivos: 0 },
  data: [{ id: 1, sku: 'F-001', nombre: 'Filtro académico', categoriaId: 1, categoria: 'Repuestos', stockActual: 0,
    stockMinimo: 2, precioCompra: '25.50', activo: true, estado: 'AGOTADO' }] };
function fixture(strategy: InventoryReportStrategy = { generar: async () => Buffer.from('archivo de prueba') }) {
  const events: AuditEvent[] = []; let inside = false; let transactions = 0; let failAudit = false;
  let actor: UsuarioInventario = { id: 1, rol: 'ADMINISTRADOR', activo: true, entraTenantId: tenantId, entraObjectId: objectId };
  const uow: ReportUnitOfWork = { async ejecutar(operation) {
    inside = true; transactions++;
    try { return await operation({ usuarios: { obtener: async () => actor }, inventario: { leer: async () => report.data },
      auditoria: { registrar: async (event) => { if (failAudit) throw new Error('Auditoría caída'); events.push(event); } } }); }
    finally { inside = false; }
  } };
  const facade = new ReportesFacade(uow, { pdf: strategy, xlsx: strategy });
  const services = { ...unconfiguredServices(), verifyToken: testVerifier,
    profiles: { buscarIdentidad: async () => ({ ...actor, nombres: 'Prueba' }) },
    audit: { registrar: async (event: AuditEvent) => { events.push(event); } }, reports: async () => facade };
  const app = createApp(parseEnvironment({ NODE_ENV: 'test' }), { info() {}, error() {} }, services);
  return { facade, app, events, inside: () => inside, transactions: () => transactions,
    disable: () => { actor = { ...actor, activo: false }; }, mechanic: () => { actor = { ...actor, rol: 'MECANICO' }; },
    failAudit: () => { failAudit = true; } };
}

test('Strategy: mismo caso de uso, render fuera de SQL y auditoría solo después de generar', async () => {
  const f = fixture({ generar: async (data, timestamp) => {
    assert.equal(f.inside(), false); assert.equal(f.events.length, 0);
    assert.equal(data.data[0]!.precioCompra, '25.50'); assert.ok(Date.parse(timestamp)); return Buffer.from('listo');
  } });
  const result = await f.facade.exportarInventario({ formato: 'pdf' }, 1, randomUUID());
  assert.equal(result.contents.toString(), 'listo'); assert.equal(f.transactions(), 2);
  assert.equal(f.events[0]!.action, 'REPORTE_INVENTARIO_GENERADO');
  assert.equal(f.events[0]!.after!.formato, 'pdf'); assert.equal(f.events[0]!.after!.bytes, 5);
});

test('Strategy: formato/filtros/contexto inválidos no acceden SQL', async () => {
  const f = fixture();
  for (const query of [{}, { formato: 'csv' }, { formato: 'pdf', sql: 'libre' }, { formato: ['pdf', 'xlsx'] }]) {
    await assert.rejects(f.facade.exportarInventario(query, 1, randomUUID()), { code: 'INVALID_REPORT_INPUT' });
  }
  await assert.rejects(f.facade.exportarInventario({ formato: 'pdf' }, 0, randomUUID()), { code: 'INVALID_REPORT_INPUT' });
  assert.equal(f.transactions(), 0);
});

test('Strategy: fallo del generador no registra éxito; auditoría caída impide devolver archivo', async () => {
  const broken = fixture({ generar: async () => { throw new Error('Fallo simulado'); } });
  await assert.rejects(broken.facade.exportarInventario({ formato: 'pdf' }, 1, randomUUID())); assert.equal(broken.events.length, 0);
  const f = fixture(); f.failAudit(); await assert.rejects(f.facade.exportarInventario({ formato: 'xlsx' }, 1, randomUUID()));
});

test('Strategy: revocar perfil durante generación impide entrega y éxito auditado', async () => {
  const f = fixture({ generar: async () => { f.disable(); return Buffer.from('privado'); } });
  await assert.rejects(f.facade.exportarInventario({ formato: 'pdf' }, 1, randomUUID()), { code: 'REPORT_FORBIDDEN' });
  assert.equal(f.events.length, 0);
});

test('Strategy: limita bytes antes de auditar y rechaza un Mecánico incluso sin HTTP', async () => {
  const f = fixture({ generar: async () => Buffer.alloc(MAX_REPORT_BYTES + 1) });
  await assert.rejects(f.facade.exportarInventario({ formato: 'pdf' }, 1, randomUUID()), { code: 'REPORT_TOO_LARGE' });
  assert.equal(f.events.length, 0); f.mechanic();
  await assert.rejects(f.facade.exportarInventario({ formato: 'xlsx' }, 1, randomUUID()), { code: 'REPORT_FORBIDDEN' });
});

test('Excel: celdas numéricas, identificadores/textos literales, sin fórmulas ni enlaces inyectados', async () => {
  const data = { ...report, data: ['=1+1', '+SUM(A1)', '-1+1', '@SUM(A1)', '汉字'].map((nombre, i) => ({ ...report.data[0]!, id: i + 1, nombre, sku: '000123' })) };
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(await new ExcelInventoryStrategy().generar(data, date)) as never);
  const sheet = workbook.getWorksheet('Inventario')!;
  data.data.forEach((item, i) => {
    assert.equal(sheet.getCell(`C${i + 9}`).value, item.nombre);
    assert.equal(sheet.getCell(`C${i + 9}`).type, ExcelJS.ValueType.String);
  });
  assert.equal(sheet.getCell('B9').value, '000123'); assert.equal(sheet.getCell('E9').value, 0);
  assert.equal(sheet.getCell('G9').value, 25.5); assert.equal(sheet.getCell('G9').numFmt, '"S/ "#,##0.00');
  const view = sheet.views[0]!; assert.ok('ySplit' in view); assert.equal(view.ySplit, 8); assert.equal(sheet.autoFilter, 'A8:H13');
  sheet.eachRow((row) => row.eachCell((cell) => assert.notEqual(cell.type, ExcelJS.ValueType.Formula)));
});

test('Excel/PDF: no redondea precios grandes; PDF conserva centavos usando texto exacto', async () => {
  assert.equal(exactPen('9999999999999999.99'), 'S/ 9,999,999,999,999,999.99');
  assert.equal(excelPrice('9999999999999.99').toFixed(2), '9999999999999.99');
  const huge = { ...report, data: [{ ...report.data[0]!, precioCompra: '9999999999999999.99' }] };
  await assert.rejects(new ExcelInventoryStrategy().generar(huge, date), { code: 'REPORT_EXCEL_PRECISION' });
  const pdf = await new PdfInventoryStrategy().generar(huge, date);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert.match(pdf.toString('latin1'), /\/FontFile[23]/);
});

test('PDF: texto español, varias páginas y vacío válidos; carácter sin glifo falla explícitamente', async () => {
  const pdf = new PdfInventoryStrategy();
  const contents = await pdf.generar({ ...report, data: Array.from({ length: 40 }, () => report.data[0]!) }, date);
  assert.ok((contents.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length > 1);
  assert.ok((await pdf.generar({ ...report, data: [] }, date)).length > 1000);
  const empty = await pdf.generar({ ...report, data: [] }, date);
  assert.equal((empty.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 1, 'El pie no debe crear otra página.');
  await assert.rejects(pdf.generar({ ...report, data: [{ ...report.data[0]!, nombre: '汉字' }] }, date), { code: 'REPORT_PDF_TEXT' });
});

test('Exportación HTTP: 401/403, descarga privada y auditoría; no expone buffers al fallar', async () => {
  const f = fixture(); const path = '/api/v1/reportes/inventario/exportar?formato=pdf';
  await request(f.app).get(path).expect(401);
  const token = await signTestToken();
  const ok = await request(f.app).get(path).auth(token, { type: 'bearer' }).expect(200);
  assert.equal(ok.headers['content-type'], 'application/pdf'); assert.match(ok.headers['content-disposition']!, /attachment; filename="inventario.pdf"/);
  assert.equal(ok.headers['cache-control'], 'no-store'); assert.equal(ok.headers['x-content-type-options'], 'nosniff');
  f.failAudit(); const error = await request(f.app).get(path).auth(token, { type: 'bearer' }).expect(500);
  assert.equal(error.body.error.code, 'INTERNAL_ERROR'); assert.equal(error.text.includes('archivo de prueba'), false);
  f.mechanic(); await request(f.app).get(path).auth(await signTestToken({ roles: ['Mecanico'] }), { type: 'bearer' }).expect(403);
});

test('Exportación HTTP: tercera generación recibe 429; libera cupos tras respuestas', async () => {
  let release!: () => void; let ready!: () => void; let entered = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const f = fixture({ generar: async () => { if (++entered === 2) ready(); await gate; return Buffer.from('ok'); } });
  const token = await signTestToken(); const path = '/api/v1/reportes/inventario/exportar?formato=xlsx';
  const first = request(f.app).get(path).auth(token, { type: 'bearer' }).then((r) => r);
  const second = request(f.app).get(path).auth(token, { type: 'bearer' }).then((r) => r);
  try {
    await started;
    const denied = await request(f.app).get(path).auth(token, { type: 'bearer' }).expect(429);
    assert.equal(denied.headers['retry-after'], '2');
  } finally { release(); }
  assert.equal((await first).status, 200); assert.equal((await second).status, 200);
  await request(f.app).get(path).auth(token, { type: 'bearer' }).expect(200);
});

test('Exportación HTTP: desconectar no libera cupo hasta que termina el trabajo', async () => {
  let release!: () => void; let ready!: () => void; let entered = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const f = fixture({ generar: async () => { if (++entered === 2) ready(); await gate; return Buffer.from('ok'); } });
  const server = createServer(f.app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const token = await signTestToken(); const path = '/api/v1/reportes/inventario/exportar?formato=pdf';
  const url = `http://127.0.0.1:${address.port}${path}`;
  const first = get(url, { headers: { Authorization: `Bearer ${token}` } }); first.on('error', () => {});
  const second = get(url, { headers: { Authorization: `Bearer ${token}` } }); second.on('error', () => {});
  try {
    await started;
    const closed = Promise.all([new Promise((resolve) => first.once('close', resolve)), new Promise((resolve) => second.once('close', resolve))]);
    first.destroy(); second.destroy(); await closed;
    await request(f.app).get(path).auth(token, { type: 'bearer' }).expect(429);
    release(); await new Promise<void>((resolve) => setImmediate(resolve));
    await request(f.app).get(path).auth(token, { type: 'bearer' }).expect(200);
  } finally { release(); first.destroy(); second.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
