# Parte 5.1 — Categorías y productos

Fecha: 21 de octubre de 2026. **Alcance:** API local de altas, consultas y actualización de metadatos con identidad, permisos, auditoría y alertas coherentes. No incluye interfaz, bajas/reactivación, proveedores, facturas, adjuntos ni reportes. La verificación manual con las identidades Demo se realiza después de las pruebas aisladas.

**Estado:** 5.1 completada para demostración local. Regresión repetida con autorización del usuario: 121 pruebas aprobadas (61 unitarias/HTTP y 60 SQL), tipos y compilación correctos. La identidad real se verificó mediante consulta/edición de categoría y rechazos 412/403, con auditoría SQL confirmada. Las altas y ediciones de productos se validaron en bases efímeras con identidades de prueba, no contra Microsoft. Se conservan stock 4, los cuatro movimientos y la alerta/tarea históricas del producto Demo. No se modificó Azure ni se enviaron correos.

## Reglas

- Todas las rutas `/api/v1/catalogo` requieren Administrador activo y token Entra válido. El Mecánico recibe 403, también al consultar precios. El futuro selector de materiales para Mecánico necesitará una proyección específica sin costos, no acceso administrativo al catálogo.
- Categoría: nombre obligatorio de hasta 100 caracteres, sin duplicados según la collation de SQL. Se recortan espacios extremos.
- Producto: SKU obligatorio normalizado a mayúsculas, hasta 40 caracteres ASCII alfanuméricos, punto, guion o guion bajo; nombre hasta 150, categoría existente, mínimo entero entre 0 y 2147483647 y precio no negativo exacto `DECIMAL(18,2)`.
- El dinero viaja como texto con dos decimales (`"25.00"`), no como Number. SQL convierte desde texto validado y devuelve texto: no se convierte dinero a coma flotante en JavaScript. Moneda única e impuestos/multimoneda quedan por concretar en facturación.
- El alta crea el producto activo y una fila de stock **cero**, sin movimiento ficticio. Las existencias solo cambian mediante entradas y salidas autorizadas.
- La edición permite nombre, categoría, mínimo y precio; no permite SKU, activo, stock, usuario, rol ni versión en el cuerpo. No hay borrado físico ni cambio de activación en esta entrega; editar un producto ya inactivo devuelve 409.
- Crear o editar un producto reevalúa sus alertas con el stock actual. Un producto recién creado con stock cero abre una alerta, incluso con mínimo cero. Cambiar el mínimo puede abrir o atender una alerta sin que haya entrada/salida; el motivo queda distinguido en auditoría. Esto no representa una reposición.
- Los listados usan cursor por ID y límites de 1 a 100 (25 por defecto), sin filtros libres ni búsquedas ilimitadas. Devuelven `siguiente` cuando hay otra página; no son una fotografía congelada de todo el catálogo frente a inserciones concurrentes.

## Patrones reutilizados y nueva decisión de concurrencia

| Concepto | Evidencia |
| --- | --- |
| Repository | Contratos de categoría/producto y adaptadores parametrizados `sql-catalog.ts`; el caso de uso no conoce consultas SQL. |
| Facade | `CatalogoFacade` coordina permisos, repositorios, auditoría y reevaluación de alertas en una UoW. |
| Chain of Responsibility | Token → perfil activo → rol Administrador → ruta/validación → Facade; errores y rechazos se auditan. |
| Observer, State y Outbox | Se reutiliza el publicador/observador en la misma transacción para cambios del catálogo, sin inventar movimientos. |
| Concurrencia optimista | `rowversion` más ETag/If-Match impiden sobrescribir una lectura anterior. Es una técnica de consistencia, no otro patrón GoF. |

La transacción SQL compartida usa `XACT_ABORT ON` y rollback ante fallos. Producto, stock inicial, auditoría, alerta y Outbox se confirman juntos o no se confirma ninguno. Una edición nunca altera la cantidad de stock, aunque puede reevaluar el mínimo.

La etiqueta de categoría tiene 16 dígitos hexadecimales. La de producto tiene 32 y combina las versiones de producto y stock: cambia tanto al editar metadatos como al cambiar el saldo mostrado. Son valores opacos, **no fechas**. La representación hexadecimal convierte primero rowversion a `binary(8)`; no se devuelve el contenido binario en un header HTTP.

Para editar, enviar una sola etiqueta fuerte vigente en `If-Match`, entre comillas. La API exige una versión puntual: no admite comodín, etiquetas débiles ni listas. Falta de cabecera: 428; etiqueta mal formada: 400; versión anterior o etiqueta que no coincide exactamente: 412. Ante 412, consultar de nuevo y decidir si corresponde aplicar el cambio; no sobrescribir automáticamente.

## Contrato HTTP

| Método | Ruta bajo `/api/v1/catalogo` | Resultado |
| --- | --- | --- |
| GET | `/categorias` | Página administrativa. |
| POST | `/categorias` | Categoría nueva, 201 y ETag. |
| PUT | `/categorias/:id` | Actualización con If-Match, 200 y ETag nuevo. |
| GET | `/productos` | Página administrativa, incluye precio y saldo. |
| GET | `/productos/:id` | Producto, 200 y ETag. |
| POST | `/productos` | Alta con stock cero, 201 y ETag. |
| PUT | `/productos/:id` | Actualización con If-Match, 200 y ETag nuevo. |

Listados: `?despuesDe=0&limite=25`; respuesta `{ "data": [...], "siguiente": null }`. Los elementos incluyen `version`. GET por ID/POST/PUT responden `{ "data": {...} }`. Las respuestas de catálogo llevan `Cache-Control: no-store`; CORS expone ETag al frontend autorizado.

Ejemplo de alta:

```json
{"sku":"FIL-DEMO-002","nombre":"Filtro de demostración","categoriaId":1,"stockMinimo":2,"precioCompra":"25.00"}
```

Ejemplo de edición de producto (todos los metadatos editables son obligatorios):

```json
{"nombre":"Filtro actualizado","categoriaId":1,"stockMinimo":3,"precioCompra":"27.50"}
```

SKU/nombre de categoría duplicados devuelven 409. Categoría o producto inexistente: 404. Campos desconocidos, precios numéricos, cantidades inválidas o intentos de inyectar stock/identidad: 400. No hay reintento automático de altas: si se perdió la respuesta, consultar antes de repetir. El SKU único protege de duplicados; no se afirma idempotencia de catálogo por Idempotency-Key.

## Persistencia y compatibilidad

La migración incremental `005_catalog` agrega rowversion a categoría/producto/stock y amplía las fotografías de auditoría a 2000 caracteres. Permite que una alerta de catálogo tenga movimiento origen nulo y conserva unicidad filtrada para movimientos no nulos. No altera ni borra los movimientos existentes; el índice de un único ciclo abierto por producto permanece.

Outbox conserva la versión 1 para movimientos y agrega versión 2 para catálogo (`movimientoId: null`, `origen: "CATALOGO"`). El worker valida ambas y rechaza versiones desconocidas o cuerpos incompatibles. La auditoría de alerta comparte request ID y estado HTTP de la operación de catálogo que la originó.

Al desplegar: aplicar la migración compatible, actualizar primero el consumidor que entiende V1/V2 y luego habilitar la API productora de V2. Un worker antiguo no debe recibir tareas V2. Esta secuencia se incorporará al despliegue; no se realiza ningún cambio en Azure desde esta entrega.

Nuevos eventos auditados: `CATEGORIA_CREADA`, `CATEGORIA_ACTUALIZADA`, `PRODUCTO_CREADO`, `PRODUCTO_ACTUALIZADO`, `CATALOGO_CONSULTADO`; las ediciones conservan antes/después. El actor sale del token/perfil, nunca del JSON. Un error al auditar impide confirmar la operación; no se sustituye por un log de éxito.

## Prueba manual desde backend

Después de aplicar las migraciones y con la API activa:

```powershell
pnpm.cmd catalog:check categorias
```

Elegir Administrador Demo: esperar 200. Repetir con Mecánico Demo: esperar 403. No se imprime ni persiste el token; se reutiliza el cliente local y el flujo navegador/PKCE existente, sin nuevos secretos o permisos Azure.

Para crear una categoría de demostración, ejecutar una vez:

```powershell
pnpm.cmd catalog:check crear-categoria "Filtros Demo"
```

Con el ID que devuelva:

```powershell
pnpm.cmd catalog:check crear-producto FIL-DEMO-002 "Filtro de demostración" ID_CATEGORIA 2 25.00
pnpm.cmd catalog:check producto ID_PRODUCTO
```

El alta sí crea datos y una alerta/tarea pendiente por stock cero; no envía correo. No cambia las existencias del producto Demo anterior. Para editar, copiar el campo `version` de 32 dígitos sin las comillas externas del header:

```powershell
pnpm.cmd catalog:check editar-producto ID_PRODUCTO VERSION_VIGENTE "Filtro actualizado" ID_CATEGORIA 3 27.50
```

El cliente agrega las comillas de If-Match. Si hubo un movimiento u otra edición, consultar de nuevo antes de editar. Para renombrar categoría: `catalog:check editar-categoria ID VERSION "Nombre nuevo"` (versión de categoría de 16 dígitos).

No compartir contraseñas/códigos/token, no subir `.env` a GitHub y no usar la cuenta personal de administración para compartir pruebas.

## Verificación y pendientes

`pnpm.cmd check` y `pnpm.cmd test:sql` cubren validación, RBAC, altas duplicadas concurrentes, dos ediciones con una versión, dinero exacto, snapshots extensos, paginación, consultas parametrizadas y rollback por fallos de auditoría/Outbox. Se conserva la regresión de inventario/worker. Las bases son efímeras en localhost y se eliminan al terminar; no contactan el tenant ni correo real.

La aceptación local de 5.1 se completó combinando las pruebas interactivas reales del usuario con la regresión aislada autorizada; la evidencia detallada está en `docs/avance-implementacion.md`. No se añadieron productos permanentes para las pruebas delegadas y no quedaron bases efímeras. Después siguen proveedores y facturas, bajas/reactivación con su política explícita y reportes con Strategy. La interfaz y despliegue permanecen en sus etapas posteriores.

## Referencias

- [ROWVERSION y concurrencia optimista en SQL Server](https://learn.microsoft.com/en-us/sql/t-sql/data-types/rowversion-transact-sql).
- [HTTP: validadores fuertes e If-Match](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1).
