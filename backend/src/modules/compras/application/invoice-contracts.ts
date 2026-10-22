import type { Repositories } from '../../inventario/application/contracts.js';
import type { SupplierRepositories } from './contracts.js';
import type { InvoiceStatus } from '../domain/invoice.js';

export interface InvoiceLine {
  productoId: number; sku: string; nombre: string; cantidad: number; precioUnitario: string; importe: string;
  claveMovimiento: string; movimientoId: number | null;
}
export interface InvoiceSummary {
  id: number; proveedorId: number; proveedorCodigo: string; proveedorNombre: string;
  numero: string; fecha: string; moneda: 'PEN'; total: string; estado: InvoiceStatus; version: string;
  usuarioCreacionId: number; usuarioRecepcionId: number | null; recibidaEn: Date | null;
}
export interface Invoice extends InvoiceSummary { lineas: Omit<InvoiceLine, 'claveMovimiento'>[] }
// Los datos de reintento son internos: no se exponen claves por las consultas HTTP.
export interface StoredInvoice extends Invoice { lineas: InvoiceLine[]; claveRecepcion: string | null; versionConfirmacion: string | null }
export interface InvoiceWrite {
  proveedorId: number; proveedorCodigo: string; proveedorNombre: string; numero: string; fecha: string;
  total: string; usuarioCreacionId: number; lineas: InvoiceLine[];
}
export interface InvoiceRepositories {
  inventario: Repositories;
  proveedores: SupplierRepositories['proveedores'];
  facturas: {
    obtener(id: number, bloquear: boolean): Promise<StoredInvoice | undefined>;
    listar(after: number, limit: number): Promise<InvoiceSummary[]>;
    crear(data: InvoiceWrite): Promise<StoredInvoice>;
    editar(id: number, fecha: string, total: string, lineas: InvoiceLine[], version: string): Promise<StoredInvoice>;
    anular(id: number, version: string): Promise<StoredInvoice>;
    bloquearClave(userId: number, key: string): Promise<void>;
    buscarClave(userId: number, key: string): Promise<number | undefined>;
    vincularMovimiento(id: number, productoId: number, movimientoId: number): Promise<void>;
    recibir(id: number, version: string, userId: number, key: string): Promise<StoredInvoice>;
  };
}
export interface InvoiceUnitOfWork { ejecutar<T>(operation: (repos: InvoiceRepositories) => Promise<T>): Promise<T> }
