# Base de datos

Diseño de la base de datos del sistema en **SQLite 3**. Las 7 tablas corresponden a las 7 clases del nivel 4 del modelo C4.

## Tablas

| Tabla | Contenido |
| --- | --- |
| `usuario` | Personas que usan el sistema, con rol ADMINISTRADOR o MECANICO |
| `categoria` | Clasificación de productos (Repuestos, Lubricantes, Filtros, etc.) |
| `proveedor` | Empresas que reponen el inventario, su ciudad y su canal de aviso (correo, SMS o WhatsApp) |
| `producto` | Catálogo de repuestos e insumos, con su stock mínimo |
| `stock` | Cantidad actual y ubicación de cada producto (1:1 con producto) |
| `movimiento` | Historial de entradas y salidas; no se puede editar ni borrar |
| `alerta_stock` | Avisos de bajo stock con estado PENDIENTE → ENVIADA → ATENDIDA |

Además incluye 8 índices, 5 triggers y 2 vistas para reportes:

- `v_inventario`: stock de cada producto, valor del inventario y estado (AGOTADO, CRITICO o NORMAL).
- `v_kardex`: historial de movimientos con el usuario que los registró.

Las vistas son consultas guardadas, no tablas: por eso solo aparecen en el modelo físico.

## Reglas principales

- El stock nunca puede quedar negativo.
- Cada movimiento debe cuadrar: stock resultante = stock anterior ± cantidad.
- Los movimientos no se pueden editar ni eliminar.
- Solo puede haber una alerta abierta por producto.
- Una alerta solo puede pasar de PENDIENTE a ENVIADA y de ENVIADA a ATENDIDA.
- El proveedor debe tener correo si su canal es CORREO, o teléfono si es SMS o WhatsApp.

## Archivos

| Archivo | Uso |
| --- | --- |
| `schema.sql` | Crea toda la estructura. Borra los objetos existentes al inicio, así que puede volver a ejecutarse. |
| `schema.prisma` | El mismo esquema para Prisma (camelCase en el código, snake_case en la base). |
| `pruebas/datos_prueba.sql` | Datos de ejemplo: 3 usuarios, 7 categorías, 3 proveedores, 15 productos, 35 movimientos y 4 alertas. |
| `pruebas/pruebas_integridad.sql` | P1 debe ejecutarse; P2 a P8 deben ser rechazadas por la base de datos. |

Todos los scripts se ejecutan con las claves foráneas activadas (`PRAGMA foreign_keys = ON`).

En DBeaver, si los triggers dan error de "incomplete input", selecciona cada `CREATE TRIGGER ... END;` completo y ejecútalo con **Ctrl+Enter**.
