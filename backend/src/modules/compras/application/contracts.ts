import type { AuditRepository } from '../../auditoria/application/contracts.js';
import type { UsuarioInventario } from '../../inventario/application/contracts.js';

export interface ProveedorEditable { razonSocial: string; correo: string | null; activo: boolean }
export interface ProveedorNuevo { codigo: string; razonSocial: string; correo: string | null }
export interface Proveedor extends ProveedorEditable { id: number; codigo: string; version: string }
export interface SupplierRepositories {
  usuarios: { obtener(id: number): Promise<UsuarioInventario | undefined> };
  auditoria: AuditRepository;
  proveedores: {
    obtener(id: number, bloquear: boolean): Promise<Proveedor | undefined>;
    listar(after: number, limit: number): Promise<Proveedor[]>;
    crear(data: ProveedorNuevo): Promise<Proveedor>;
    actualizar(id: number, data: ProveedorEditable, version: string): Promise<Proveedor>;
  };
}
export interface SupplierUnitOfWork {
  ejecutar<T>(operation: (repos: SupplierRepositories) => Promise<T>): Promise<T>;
}
