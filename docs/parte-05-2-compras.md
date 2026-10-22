# Parte 5.2 — Compras: proveedores y recepción de facturas

Fecha: 21 de octubre de 2026. Entrega incremental: **5.2a proveedores** implementada; el registro y la recepción de **5.2b** se describen en [la guía de facturas](parte-05-2b-facturas.md). Los [adjuntos privados locales de 5.2c](parte-05-2c-adjuntos.md) están verificados; Blob/antivirus y su integración cloud siguen pendientes. No se declara emisión ni validación fiscal.

## 5.2a — Proveedores externos, sin acceso

El proveedor es un contacto comercial administrado por un empleado con rol Administrador. No se crea cuenta Entra, perfil `jm.usuario`, contraseña ni rol de proveedor. El Mecánico no puede consultar ni modificar estos datos. Guardar un correo no activa mensajes ni suscribe automáticamente al contacto a alertas.

Datos: código interno único e inmutable de hasta 40 caracteres ASCII (mayúsculas, dígitos, punto, guion y guion bajo), razón social de hasta 150 caracteres, correo opcional (`null` si no existe), activo y versión. El código interno no se presenta como RUC ni como validación fiscal; el identificador tributario y los datos fiscales del documento se definirán antes de implementar facturas. No se consulta SUNAT ni se certifican datos legales.

El alta crea un contacto activo. La edición reemplaza razón social, correo y activo, con todos esos campos obligatorios. Desactivar/reactivar conserva el ID y el historial; no hay borrado físico por API. Desactivar solo cambia su elegibilidad para futuras operaciones que se integren: no anula documentos históricos ni cancela las tareas existentes. Todavía no hay vínculos producto-proveedor ni destinatarios resueltos por el worker.

### Patrones y garantías

| Concepto | Aplicación concreta |
| --- | --- |
| Facade | `ProveedoresFacade` valida el caso de uso y coordina permiso, persistencia y auditoría. |
| Repository | Contratos sin SQL en aplicación, adaptador SQL parametrizado y consultas paginadas. |
| Chain of Responsibility | Token → perfil activo → rol Administrador → ruta/validación → caso de uso. |
| Unit of Work | Contacto y auditoría se confirman o revierten juntos. Es coordinación transaccional, no otro patrón GoF. |
| Concurrencia optimista | `rowversion` de 16 hexadecimales y ETag/If-Match; rechaza sobrescrituras con versiones antiguas. |

Se reutiliza el pool Singleton. Observer/State/Outbox no se invocan al crear o editar un contacto: no cambian existencias ni alertas. Strategy de reportes permanece pendiente.

Auditoría: `PROVEEDOR_CREADO`, `PROVEEDOR_ACTUALIZADO`, `PROVEEDOR_CONSULTADO` y los rechazos HTTP. Las ediciones guardan antes/después de código, razón social, activo y versión; del correo solo se registra `correoConfigurado`, no la dirección completa. El repositorio operativo sí conserva el correo para futuras comunicaciones autorizadas. La auditoría no permite reconstruir una dirección antigua; es una decisión explícita de minimización de datos.

### API

Todas las rutas requieren Administrador. Base: `/api/v1/compras/proveedores`.

| Método | Ruta | Resultado |
| --- | --- | --- |
| GET | `/` | `{data,siguiente}` paginado por `despuesDe` y `limite` (máximo 100). Incluye inactivos. |
| GET | `/:id` | Contacto y ETag fuerte; 404 si no existe. |
| POST | `/` | `{codigo,razonSocial,correo}` → 201 con contacto activo y ETag. |
| PUT | `/:id` | `{razonSocial,correo,activo}` con If-Match → 200 y nueva versión. |

Ejemplo de alta ficticia:

```json
{"codigo":"PROV-DEMO-001","razonSocial":"Proveedor ficticio de filtros","correo":"contacto@example.invalid"}
```

Errores: 401 sin sesión, 403 por rol/perfil, 400 por campos inválidos/desconocidos, 404 inexistente, 409 código duplicado, 428 falta de If-Match y 412 versión antigua. If-Match exige una sola etiqueta fuerte entre comillas: no admite comodines, etiquetas débiles ni listas. Las versiones publicadas usan mayúsculas. Listados y datos personales se devuelven con `Cache-Control: no-store`.

No hay reintento automático de POST ni garantía de Idempotency-Key en esta entrega. Ante respuesta perdida, consultar el listado antes de repetir: el código único impide el alta duplicada.

### Persistencia y verificación

Migración incremental `006_suppliers`: agrega únicamente `jm.proveedor`, sus restricciones y rowversion; no cambia las migraciones aplicadas 001–005 ni las cantidades. No agrega credenciales ni datos permanentes de ejemplo. Aplicar antes de usar las nuevas rutas:

```powershell
pnpm.cmd db:migrate
```

Validación automatizada: `pnpm.cmd check` y `pnpm.cmd test:sql`, con **65 pruebas unitarias/HTTP + 70 SQL = 135 aprobadas**, tipos y compilación correctos. Las diez nuevas pruebas SQL usan una base local aleatoria `jm_test_<UUID>` con RCSI y claves RSA de prueba; no usan el tenant real. Cubren RBAC, contacto sin identidad, Unicode, edición/estados, versiones, duplicados y ediciones simultáneas, campos prohibidos, paginación, parametrización y rollback de alta/edición por fallo de auditoría. Las bases efímeras se eliminan al terminar.

El cliente manual usa el mismo registro local Entra, PKCE y tokens solo en memoria. No necesita nuevos roles, secretos ni permisos Azure:

```powershell
pnpm.cmd supplier:check listar
pnpm.cmd supplier:check crear PROV-DEMO-001 "Proveedor ficticio de filtros" contacto@example.invalid
pnpm.cmd supplier:check ver ID
pnpm.cmd supplier:check editar ID VERSION "Proveedor ficticio actualizado" sin-correo false
```

`sin-correo` significa `null`; `true`/`false` definen activo. Usar el ID y la versión devueltos por la API. La demostración interactiva es opcional para comprobar la ruta con un token real; las pruebas delegadas no completan un inicio de sesión de Microsoft por el usuario.

## 5.2b — Registro y recepción de compra

El alcance sigue siendo registrar documentos de compra como sustento del inventario, no emitir comprobantes tributarios a clientes. El usuario acordó soles (PEN), precios finales de dos decimales y recepción completa. No se calcula ni desglosa IGV; no hay redondeo de precios de más de dos decimales. Estados: borrador, recibida y anulada. La validación fiscal y la identificación tributaria del proveedor quedan fuera de esta demostración.

Flujo objetivo: registrar proveedor y documento con sus líneas → validar → confirmar recepción una sola vez → crear entradas y actualizar existencias → reevaluar alertas → auditar. La creación del borrador no debe sumar stock. Una confirmación repetida no debe duplicar movimientos. La unicidad del documento por proveedor y número complementará la idempotencia.

Las entradas de todas las líneas, confirmación del documento, auditoría y efectos de alertas comparten una sola transacción SQL. Se extrajo `registrarMovimientoEnTransaccion` para componer operaciones con repositorios de la misma UoW, en lugar de abrir una transacción por línea. Los productos se procesan en orden estable. La API administrativa, migración 007 y cliente interactivo se documentan en la guía específica.

Los adjuntos privados requieren un puerto de almacenamiento y un adaptador local/de Blob; SQL y Blob no se presentarán como una transacción atómica. Se definirán validación de archivos, autorización, estados de adjunto y limpieza de huérfanos antes del envío real. No se crean recursos ni archivos de facturas en Azure en 5.2a.
