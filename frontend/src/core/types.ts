export interface Profile {
  id: number;
  nombres: string;
  rol: 'ADMINISTRADOR' | 'MECANICO';
}
export interface Page<T> {
  data: T[];
  siguiente: number | null;
}
export interface Category {
  id: number;
  nombre: string;
  version?: string;
}
export interface Stock {
  id: number;
  sku: string;
  nombre: string;
  categoriaId: number;
  categoria: string;
  stockActual: number;
  stockMinimo: number;
}
export interface Product extends Omit<Stock, 'categoria'> {
  precioCompra: string;
  activo: boolean;
  version: string;
}
export interface Movement {
  id: number;
  productoId: number;
  sku?: string;
  nombre?: string;
  usuarioId: number;
  tipo: 'ENTRADA' | 'SALIDA';
  cantidad: number;
  stockAnterior: number;
  stockResultante: number;
  motivo: string;
  referencia: string | null;
  fecha: string;
}
export interface Supplier {
  id: number;
  codigo: string;
  razonSocial: string;
  correo: string | null;
  activo: boolean;
  version: string;
}
export interface InventoryReport {
  moneda: 'PEN';
  filtros: { categoriaId?: number; incluirInactivos: boolean; soloBajoMinimo: boolean };
  resumen: { productos: number; agotados: number; bajoMinimo: number; inactivos: number };
  data: (Stock & { precioCompra: string; activo: boolean; estado: string })[];
}
export type View =
  'resumen' | 'inventario' | 'movimiento' | 'historial' | 'reportes' | 'proveedores' | 'compras';
