import { z } from 'zod';
import type { AuditRepository } from '../../auditoria/application/contracts.js';
import type { UsuarioInventario } from '../../inventario/application/contracts.js';

export class ReportError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'ReportError'; }
}
export const reportFilterSchema = z.object({
  categoriaId: z.coerce.number().int().positive().max(2_147_483_647).optional(),
  incluirInactivos: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  soloBajoMinimo: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
}).strict();
export type ReportFilter = z.output<typeof reportFilterSchema>;
export interface InventoryReportRow {
  id: number; sku: string; nombre: string; categoriaId: number; categoria: string;
  stockActual: number; stockMinimo: number; precioCompra: string; activo: boolean;
}
export interface ReportRepositories {
  usuarios: { obtener(id: number): Promise<UsuarioInventario | undefined> };
  auditoria: AuditRepository;
  inventario: { leer(filter: ReportFilter): Promise<InventoryReportRow[]> };
}
export interface ReportUnitOfWork { ejecutar<T>(operation: (repos: ReportRepositories) => Promise<T>): Promise<T> }
export type ReportFormat = 'pdf' | 'xlsx';
export interface InventoryReport {
  moneda: 'PEN'; filtros: ReportFilter;
  resumen: { productos: number; agotados: number; bajoMinimo: number; inactivos: number };
  data: (InventoryReportRow & { estado: ReturnType<typeof inventoryStatus> })[];
}
// Strategy: la aplicación conoce este contrato, no PDFKit ni ExcelJS.
export interface InventoryReportStrategy {
  generar(report: InventoryReport, generadoEn: string): Promise<Buffer>;
}
export const MAX_REPORT_BYTES = 10 * 1024 * 1024;
const exportSchema = reportFilterSchema.extend({ formato: z.enum(['pdf', 'xlsx']) });
function buildReport(rows: InventoryReportRow[], filtros: ReportFilter): InventoryReport {
  if (rows.length > 1000) throw new ReportError('REPORT_TOO_LARGE', 'El reporte supera 1000 productos. Aplique filtros.');
  const data: InventoryReport['data'] = rows.map((row) => ({ ...row, estado: inventoryStatus(row) }));
  return { moneda: 'PEN', filtros, data, resumen: {
    productos: data.length, agotados: data.filter((r) => r.estado === 'AGOTADO').length,
    bajoMinimo: data.filter((r) => r.activo && r.stockActual <= r.stockMinimo).length,
    inactivos: data.filter((r) => !r.activo).length,
  } };
}
async function requireAdministrator(repos: ReportRepositories, userId: number) {
  const actor = await repos.usuarios.obtener(userId);
  if (!actor?.activo || actor.rol !== 'ADMINISTRADOR') throw new ReportError('REPORT_FORBIDDEN', 'Solo Administrador habilitado puede consultar reportes.');
  return actor;
}
function validContext(userId: number, requestId: string) {
  return z.number().int().positive().max(2_147_483_647).safeParse(userId).success && z.uuid().safeParse(requestId).success;
}
export function inventoryStatus(row: InventoryReportRow) {
  return !row.activo ? 'INACTIVO' : row.stockActual === 0 ? 'AGOTADO' : row.stockActual <= row.stockMinimo ? 'BAJO_MINIMO' : 'NORMAL';
}
export class ReportesFacade {
  constructor(private readonly uow: ReportUnitOfWork,
    private readonly strategies: Partial<Record<ReportFormat, InventoryReportStrategy>> = {}) {}
  async inventario(query: unknown, userId: number, requestId: string) {
    const parsed = reportFilterSchema.safeParse(query);
    if (!parsed.success || !validContext(userId, requestId)) {
      throw new ReportError('INVALID_REPORT_INPUT', 'Revise los filtros del reporte.');
    }
    return this.uow.ejecutar(async (repos) => {
      const actor = await requireAdministrator(repos, userId);
      const report = buildReport(await repos.inventario.leer(parsed.data), parsed.data);
      await repos.auditoria.registrar({ requestId, action: 'REPORTE_INVENTARIO_CONSULTADO', result: 'EXITO', userId,
        tenantId: actor.entraTenantId, objectId: actor.entraObjectId, entityId: null, code: 'REPORTE_INVENTARIO_CONSULTADO',
        httpStatus: 200, before: null, after: { ...report.resumen, categoriaId: parsed.data.categoriaId ?? null,
          incluirInactivos: parsed.data.incluirInactivos, soloBajoMinimo: parsed.data.soloBajoMinimo } });
      return report;
    });
  }
  async exportarInventario(query: unknown, userId: number, requestId: string) {
    const parsed = exportSchema.safeParse(query);
    if (!parsed.success || !validContext(userId, requestId)) throw new ReportError('INVALID_REPORT_INPUT', 'Seleccione pdf o xlsx y revise los filtros.');
    const { formato, ...filtros } = parsed.data;
    const strategy = this.strategies[formato];
    if (!strategy) throw new ReportError('REPORT_EXPORT_NOT_CONFIGURED', 'Exportador no configurado.');
    const report = await this.uow.ejecutar(async (repos) => {
      await requireAdministrator(repos, userId);
      return buildReport(await repos.inventario.leer(filtros), filtros);
    });
    // Renderizar sin mantener bloqueos SQL ni publicar archivos en disco.
    const generadoEn = new Date().toISOString();
    const contents = await strategy.generar(report, generadoEn);
    if (!contents.length || contents.length > MAX_REPORT_BYTES) throw new ReportError('REPORT_TOO_LARGE', 'El archivo excede el límite de exportación.');
    // Revalidar al actor y persistir el éxito antes de entregar bytes HTTP.
    // Archivo generado no equivale a descarga completada por el destinatario.
    await this.uow.ejecutar(async (repos) => {
      const actor = await requireAdministrator(repos, userId);
      await repos.auditoria.registrar({ requestId, action: 'REPORTE_INVENTARIO_GENERADO', result: 'EXITO', userId,
        tenantId: actor.entraTenantId, objectId: actor.entraObjectId, entityId: null, code: 'REPORTE_INVENTARIO_GENERADO',
        httpStatus: 200, before: null, after: { ...report.resumen, formato, bytes: contents.length, generadoEn,
          categoriaId: filtros.categoriaId ?? null, incluirInactivos: filtros.incluirInactivos, soloBajoMinimo: filtros.soloBajoMinimo } });
    });
    return { formato, contents };
  }
}
