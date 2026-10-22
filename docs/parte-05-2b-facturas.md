# Parte 5.2b — Registro y recepción de compras en PEN

## Alcance de esta entrega

Registro interno de documentos de compra, no emisión ni validación tributaria. Moneda acordada: soles (`PEN`). Cada precio unitario es el precio final informado por el documento, con dos decimales. No se calcula IGV, no se desglosan impuestos ni se distribuyen descuentos/fletes. El total registrado es la suma de cantidad × precio final de cada línea. Si el comprobante no puede representarse así, este MVP no debe presentarse como una conciliación fiscal de ese comprobante.

Las cantidades siguen siendo unidades enteras; no se admiten litros/fracciones en esta entrega. Se registra fecha, proveedor, número y 1–50 líneas con productos distintos. El identificador fiscal del proveedor y la verificación del comprobante no están implementados: el código interno no es RUC. Para usarlo fuera de la demostración se deberán completar las políticas fiscales y de valoración correspondientes.

Backend y migración local implementados. **Adjuntos PDF/imagen, Blob privado y envío de documentos por correo no están implementados en 5.2b**: corresponden a la siguiente entrega de documentos. No se configuran recursos Azure desde estas pruebas.

## Funcionamiento

1. El Administrador crea un borrador. Se valida proveedor activo, productos activos, importes y duplicados. No se cambia stock ni se crean movimientos.
2. El borrador puede corregirse con su versión vigente. Solo fecha y líneas: proveedor/número son identidad del documento y no cambian. El cambio reemplaza el detalle completo y mantiene trazabilidad en auditoría.
3. Confirmar significa recibir **todas** las líneas. Cada una crea una entrada vinculada al detalle y reevalúa alertas. No se deben registrar además entradas manuales por la misma compra.
4. Una sola transacción confirma entradas, stock, vínculos, alertas/Outbox, auditoría y estado de factura. Si falla cualquier línea o la auditoría, no se confirma ninguna parte.
5. Una factura recibida no se edita ni anula. Las devoluciones y correcciones mediante movimientos compensatorios necesitan un caso de uso posterior: no se implementa un botón que revierta stock sin controles.

Estados: `BORRADOR → RECIBIDA` o `BORRADOR → ANULADA`. Anular un borrador no cambia stock y es terminal. No libera el número para crear otra factura: se conserva unicidad por proveedor/número incluso para anuladas. Corregir un documento válido debe hacerse sobre su borrador antes de anularlo. No hay restauración, eliminación física ni recepción parcial en esta entrega.

Se guardan snapshots de código/nombre del proveedor al crear el documento. Las líneas guardan SKU/nombre del producto al crear o reemplazar el detalle; después de recibir no cambian con el catálogo. El precio de la factura no sobrescribe el precio maestro de compra, ni implementa costo promedio, valorización contable o ajustes automáticos.

## Patrones y decisiones demostrables

| Concepto | Evidencia |
| --- | --- |
| Facade | `FacturasFacade`: registro, edición, recepción, anulaciones y consultas. |
| Repository | Contratos de factura y detalle; adaptador SQL parametrizado, sin SQL en la aplicación. |
| Chain of Responsibility | Token → perfil activo → Administrador → validación → caso de uso. |
| Observer y State existentes | Las entradas publican `StockCambiado`; el observador atiende la alerta y cancela avisos no aceptados cuando corresponde. |
| Unit of Work | Una transacción para todas las líneas y sus efectos. La operación compartida de inventario no abre otra transacción. |
| Idempotencia | Clave estable por usuario y recepción; replay sin entradas ni eventos duplicados. |
| Concurrencia optimista | ETag/If-Match sobre el borrador evita confirmar una versión no revisada. |

Los tres últimos son mecanismos de consistencia/coordinación, no nuevos patrones GoF. Las validaciones puras de estado del documento no se presentan como una segunda implementación del patrón State; este ya existe con clases en alertas. Se reutiliza el Singleton del pool SQL.

`registrarMovimientoEnTransaccion` concentra reglas de inventario, idempotencia de movimiento, auditoría y publicación; lo usan movimientos individuales y recepción. La Facade de compras no llama a una Facade de inventario que abra otra UoW para cada línea. Los productos se procesan por ID ascendente para mantener un orden estable; esto reduce un riesgo de interbloqueo, no promete que nunca pueda ocurrir en toda la base.

El dinero se convierte a céntimos `BigInt`, se multiplica/suma sin coma flotante y viaja en JSON como texto. Se rechaza desbordamiento antes de SQL. SQL conserva `DECIMAL(18,2)` y valida cantidades/importes; no se redondean silenciosamente precios de más de dos decimales.

## API administrativa

Base `/api/v1/compras/facturas`. Solo Administrador activo; el Mecánico recibe 403 en lectura y escritura. Respuestas sin caché. Listados paginados con `despuesDe` y `limite` (25 por defecto, máximo 100).

| Método | Ruta | Cuerpo y resultado |
| --- | --- | --- |
| GET | `/` | `{data,siguiente}` con cabeceras de factura, sin claves internas. |
| GET | `/:id` | `{data}` con detalle y ETag fuerte. |
| POST | `/` | Proveedor, número, fecha, PEN y líneas → 201, borrador. |
| PUT | `/:id` | Fecha y líneas completas, con If-Match → 200, nueva versión. |
| POST | `/:id/anular` | `{}` con If-Match → 200, anulación de borrador. |
| POST | `/:id/confirmar` | `{}` con If-Match e Idempotency-Key → 201 primera recepción; 200 replay comprobado. |

Campos de alta:

```json
{
  "proveedorId": 1,
  "numero": "DEMO-F001-000001",
  "fecha": "2026-10-21",
  "moneda": "PEN",
  "lineas": [
    { "productoId": 1, "cantidad": 2, "precioUnitario": "20.00" }
  ]
}
```

Fecha real de calendario `YYYY-MM-DD`; número de hasta 40 caracteres ASCII alfanuméricos, guion o barra, normalizado a mayúsculas y recortado. La unicidad se evalúa sobre este número normalizado, no sobre equivalencias fiscales de formatos alternativos: `F001-1` y `F001-0001` no se convierten automáticamente en el mismo número.

No se aceptan totales, movimiento, estado, usuario o stock del cliente. No se aceptan líneas duplicadas de un producto. La API devuelve el total calculado y cada `movimientoId` una vez recibido, pero no las claves internas de movimientos/recepción.

Errores relevantes: 400 datos/importe/clave inválidos; 401 sin sesión; 403 por rol/perfil; 404 inexistentes; 409 duplicado, inactivo, documento finalizado o conflicto de idempotencia; 412 versión antigua; 428 falta de If-Match. If-Match exige una sola versión fuerte de 16 hexadecimales en mayúsculas entre comillas; no admite `*`, listas ni etiquetas débiles.

### Reintentos seguros

Para confirmar, conservar **ID de factura + usuario + UUID de recepción + versión original del borrador**. Si se pierde la respuesta, repetir esos mismos valores. La excepción de replay devuelve éxito solo si se comprueba que ese mismo usuario ya confirmó ese mismo documento con esa clave y versión. Devuelve la factura recibida, no nuevos movimientos.

No generar otro UUID para resolver una respuesta perdida. Otra clave/usuario sobre una factura recibida devuelve 409, no vuelve a sumar stock. Reutilizar una clave de recepción en otra factura del mismo usuario devuelve 409. Cambiar la versión en un replay también se rechaza. Consultar la factura después de recibir devuelve su versión nueva; esa versión no reemplaza la versión original para repetir la solicitud original.

Una cuenta deshabilitada sigue bloqueada por autenticación/perfil. Un replay autorizado no exige que el proveedor siga activo después de la recepción, porque no genera nuevas operaciones. Una nueva recepción sí revalida proveedor y productos activos.

El alta no usa Idempotency-Key: la restricción proveedor/número impide duplicados. Ante respuesta perdida al crear, consultar antes de volver a crear; no inventar otro número para evitar el conflicto.

## Persistencia y auditoría

Migración incremental `007_purchase_invoices`, sin modificar 001–006:

- Cabecera con estado, total, snapshots, actor de creación/recepción, instante, clave de recepción y versión original de confirmación.
- Detalles con precios/importes exactos y vínculo único a movimiento. No hay movimiento para un borrador.
- Unicidad por proveedor/número, por recepción del usuario y por movimiento vinculado.
- Restricciones de cantidades/moneda/importes/estado y triggers que impiden DML ordinario sobre documentos finalizados y verifican vínculos de recepción.

No son controles contra un administrador SQL que deshabilite restricciones/triggers. Los permisos mínimos de producción se integrarán en despliegue.

Auditorías `FACTURA_CREADA`, `FACTURA_ACTUALIZADA`, `FACTURA_DETALLE_CAMBIADO`, `FACTURA_RECIBIDA`, `FACTURA_RECEPCION_REINTENTO`, `FACTURA_ANULADA` y `FACTURA_CONSULTADA`. Las correcciones de detalle registran antes/después por producto para no truncar snapshots de 50 líneas. En recepción, entradas, alertas y factura comparten request ID y actor verificado. No se guardan tokens en auditoría.

## Demostración opcional con Entra real

Las pruebas automatizadas no necesitan iniciar sesión ni agregar datos permanentes. Para usar el cliente real, primero aplicar migraciones en la base de desarrollo y comprobar IDs existentes. El ejemplo `backend/examples/factura-demo.json` presupone proveedor 1 y producto 1: modificarlo si esos registros no existen. Su fecha es de ejemplo, no una fecha generada automáticamente.

Desde `backend/`:

```powershell
pnpm.cmd db:migrate
pnpm.cmd supplier:check listar
pnpm.cmd catalog:check productos
pnpm.cmd invoice:check crear examples/factura-demo.json
pnpm.cmd invoice:check ver ID_FACTURA
```

Crear borrador no modifica stock. Para recibir, copiar la versión devuelta y generar una clave **una sola vez**, conservándola:

```powershell
$recepcionDemoKey = [guid]::NewGuid().ToString()
pnpm.cmd invoice:check confirmar ID_FACTURA VERSION_BORRADOR $recepcionDemoKey
```

Este último comando sí aumenta stock y registra movimientos permanentes en la base local. No fue ejecutado sobre el inventario del usuario por el asistente. Repetir exactamente el mismo comando permite demostrar el 200 idempotente sin duplicar cantidades. No repetir la asignación del UUID entre intentos.

Para corregir el borrador, preparar un JSON solo con `fecha` y `lineas`:

```powershell
pnpm.cmd invoice:check editar ID_FACTURA VERSION_VIGENTE ruta/al/detalle.json
pnpm.cmd invoice:check anular ID_FACTURA VERSION_VIGENTE
pnpm.cmd invoice:check listar
```

Son opciones distintas: no anular un documento que se desea confirmar. El cliente valida el JSON UTF-8 (BOM permitido), limita el archivo a 64 KiB y solo envía a la API local. Abre Microsoft con PKCE; nunca requiere compartir tokens, contraseñas ni códigos.

## Verificación local

`pnpm.cmd check` y `pnpm.cmd test:sql` cubren la regresión previa más los casos de compras. Las pruebas de recepción se ejecutan en una base efímera aleatoria con datos ficticios, SQL Server real y RCSI; no usan las identidades del tenant real ni correo.

Resultado del 21/10/2026: **72 unitarias/HTTP + 92 SQL = 164 aprobadas**, tipos y compilación correctos. Se añadieron siete unitarias y 22 pruebas SQL de facturas. La prueba interactiva con Microsoft sobre las nuevas rutas no fue ejecutada por el asistente y queda disponible como demostración opcional.

Se verifican cantidades/importes, unicidad concurrente, recepción simultánea, replay, proveedor/productos inactivos, fallo en segunda línea, desbordamiento, rollback por auditoría y Outbox, edición/confirmación simultánea, salida concurrente, inmutabilidad, snapshots y permisos. La eliminación de la base al terminar retira únicamente los datos ficticios de esa ejecución.

Los adjuntos y la limpieza local se incorporan en [5.2c](parte-05-2c-adjuntos.md); Blob, antivirus y su integración cloud siguen pendientes. También quedan vínculo producto-proveedor y destinatarios autorizados, reportes Strategy, interfaz y despliegue manual Azure. No se afirma capacidad de emitir comprobantes fiscales.
