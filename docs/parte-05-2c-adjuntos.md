# Parte 5.2c — Adjuntos privados de compras (local)

## Alcance y límites

Carga, consulta y descarga de documentos de una factura mediante la API autenticada, solo para Administrador activo. El proveedor no recibe acceso ni se crea un usuario nuevo. No se envían correos ni se modifican cantidades, movimientos, totales o la versión de la factura.

Se permiten PDF, PNG y JPEG con extensión, MIME declarado y firma básica compatibles; tamaño entre 1 byte y **5 MiB**. Nombre de hasta 105 caracteres, letras/dígitos ASCII, espacios, guion/guion bajo y una extensión permitida. Se rechazan rutas, controles, doble extensión y cuerpos comprimidos. No se aceptan HTML, SVG, ZIP ni contenido JSON/base64/multipart en el endpoint binario.

**La firma básica no es una validación estructural completa ni un antivirus.** Se comprueban encabezados/terminadores; un archivo que los cumpla todavía puede ser malicioso o estar mal formado. No se interpreta ni se renderiza en el servidor. En producción habrá que integrar análisis de malware y, según el tipo de documento, reconstrucción/sanitización. El estado `LISTO` significa que la carga e integridad se confirmaron, no que se certificó su seguridad.

Cada factura admite cinco adjuntos activos o pendientes. Solo se limpia una carga pendiente caducada: un archivo confirmado no tiene endpoint de eliminación/sustitución en este MVP. Retención, correcciones de adjuntos confirmados y borrado administrativo necesitan una política posterior. Una factura recibida admite añadir documentos sin editar su información comercial; una anulada permite consultar sus adjuntos históricos, no iniciar nuevas cargas.

## Patrones y organización

| Concepto | Aplicación |
| --- | --- |
| Adapter | `AttachmentStore` es el puerto; `LocalAttachmentStore` adapta operaciones a archivos privados con UUID. No expone rutas del disco al negocio. |
| Facade | `AdjuntosFacade` coordina permisos, factura, reserva, almacenamiento, integridad y auditoría. |
| Repository / UoW | SQL guarda metadatos, claves de reintento y estados; cada fase tiene su transacción. |
| Chain of Responsibility | Token → perfil → Administrador → cabeceras/límite de concurrencia → parser binario acotado → caso de uso. |

Se reutiliza el pool Singleton. No se agrega un GoF nuevo para cada tabla/estado. Observer y State de alertas no se disparan por adjuntar archivos: no hay cambios de existencias. El Adapter Azure Blob ya está implementado y probado con un contenedor simulado; **no se ha conectado ni probado con Azure real**. Véase [Parte 8.2](parte-08-2-blob.md).

## Persistencia y recuperación

Migración incremental `008_invoice_attachments`; no cambia las migraciones 001–007. Guarda ID interno, factura, nombre de presentación, MIME, tamaño, SHA-256, actor, clave de reintento y fecha UTC. La clave es única por usuario y su reserva queda ligada al contenido/nombre/factura original.

Estados: `PENDIENTE → LISTO` o `PENDIENTE → ELIMINADO`. La trazabilidad no se elimina y los metadatos son inmutables. `ELIMINADO` es el resultado de limpiar una carga no confirmada; no representa borrar una factura ni un documento confirmado.

1. Autorizar y confirmar en SQL una reserva `PENDIENTE` con auditoría.
2. En otra transacción, obtener el bloqueo del objeto y volver a comprobar permisos/estado.
3. Escribir el objeto privado con nombre interno exclusivo. Un objeto completo idéntico puede reutilizarse; no se sobrescribe uno distinto.
4. Confirmar `LISTO` y su auditoría conjuntamente.

**SQL y el disco no son una transacción distribuida.** Si se escribió el archivo y después falla la confirmación SQL, no se afirma éxito: queda `PENDIENTE`. Repetir con la misma clave/contenido puede recuperar un objeto completo; una escritura parcial/incompatible queda pendiente para limpieza, sin sobreescribirla silenciosamente. El registro se crea antes de cualquier escritura y permite encontrar el archivo de la carga interrumpida.

La segunda transacción conserva el bloqueo durante la E/S tanto con disco como con Blob. El limpiador local usa el mismo bloqueo por UUID: revalida el estado y no puede borrar a la vez que se confirma una carga. Es una decisión explícita para el demo acotado, con costo en conexiones/latencia si el almacenamiento se demora. El Adapter Blob impone límites de tiempo, pero **no elimina la transacción SQL abierta durante una operación de red**. Antes de uso empresarial se deben diseñar reserva/finalización sin bloqueo remoto prolongado y recuperación con fencing.

Las reservas vencen a los 30 minutos según el reloj SQL, con la misma precisión `datetime2(3)`. Una carga caducada no puede finalizar; su clave no vuelve a usarse después de limpiar. Para reenviar el documento, limpiar primero y usar una clave nueva. No se prolonga la fecha con reintentos indefinidos.

El limpiador consulta máximo 25 pendientes vencidos por pasada. Borra únicamente el objeto identificado por esos registros y luego confirma estado/auditoría. Si el archivo ya no existe, la eliminación física es idempotente. Si falla disco o auditoría, no se deja un falso estado final; una siguiente ejecución puede reconciliar. No recorre ni borra rutas arbitrarias, no toca `LISTO` y no repara contenidos confirmados corruptos. Pérdida/restauración independiente de SQL y archivos requiere un procedimiento de respaldo/conciliación adicional.

## API

Rutas bajo `/api/v1/compras/facturas/:id/adjuntos`, todas protegidas:

| Método | Ruta | Resultado |
| --- | --- | --- |
| GET | `/` | Adjuntos activos/pendientes (máximo cinco); no devuelve rutas ni claves de reintento. Los eliminados se conservan en SQL/auditoría, no en este listado. |
| POST | `/?nombre=Factura-001.pdf` | Cuerpo binario con Content-Type permitido e Idempotency-Key UUID. 201 al completar; 200 en replay ya confirmado. |
| GET | `/:adjuntoId/contenido` | Solo archivos `LISTO` de esa factura; integridad SHA-256/tamaño verificada antes de responder. |

No hay URL pública, SAS ni montaje estático del directorio. Descargar exige nuevamente token/perfil/rol, aunque se conozca el UUID. Se sirve `application/octet-stream`, `Content-Disposition: attachment`, `nosniff`, CSP restrictiva y `Cache-Control: no-store`; no se previsualiza contenido activo en el origen de la aplicación. El nombre descargado lo genera la API; el original queda como metadato validado.

Dos cargas HTTP pueden estar en curso por instancia de API; una tercera recibe 429 sin reservar archivo. Esto acota los cuerpos binarios de subida en memoria, pero no sustituye cuotas/rate limiting distribuidos ni pruebas de carga de producción. La plaza de una carga que ya empezó a procesarse se conserva hasta que termine el caso de uso, incluso si el cliente corta la respuesta.

Reintentar significa conservar usuario + factura + nombre + MIME + contenido + UUID. Cambiar alguno usando la misma clave devuelve 409. No generar una clave nueva cuando se pierde la respuesta de una carga que podría haberse completado.

Errores: 400 metadatos/ID/clave inválidos; 401 sin sesión; 403 por perfil/rol; 404 adjunto no disponible o ajeno a esa factura; 409 límite, carga ocupada/caducada, factura anulada o conflicto de idempotencia; 413 exceso de tamaño; 415 tipo/firma/compresión no admitidos; 429 admisión ocupada; 503 almacenamiento no disponible o integridad incumplida. No se devuelven rutas de disco ni excepciones originales.

## Almacén local privado

Por defecto se usa `backend/.local-data/attachments`, excluido de Git y sin ruta HTTP estática. Cada archivo usa `<UUID>.bin`; un nombre aportado por el cliente nunca se concatena a una ruta de almacenamiento. Se valida raíz, UUID y archivo regular, se rechazan redirecciones simbólicas y la creación es exclusiva. La configuración opcional `ATTACHMENT_LOCAL_ROOT` exige una ruta absoluta privada.

La protección frente a otras personas con acceso al equipo depende también de los permisos del sistema de archivos: en Windows se deben revisar los ACL heredados. No ubicar la raíz en carpetas servidas por otra aplicación, compartidas públicamente o sincronizadas sin control. No versionar facturas ni subir la carpeta de datos al repositorio.

`NODE_ENV=production` rechaza expresamente este adaptador local con 503. No se debe desplegar como almacenamiento definitivo en el disco efímero de un contenedor. Para seleccionar el Adapter Blob se configura `ATTACHMENT_STORAGE=blob`; la cuenta/contenedor y los permisos de identidad administrada se preparan manualmente según [Parte 8.2](parte-08-2-blob.md). Falta análisis de archivos y limpieza cloud, por lo que la funcionalidad **no está lista para uso empresarial**.

### Corrección del controlador Windows

La prueba de seis cargas concurrentes reprodujo esperas de consulta con el pool ODBC de cinco conexiones. Se observaron consultas esperando el lock de factura y se comprobó que la misma prueba pasaba al aumentar los trabajadores nativos en un proceso de control. Eso respalda el diagnóstico de saturación del pool nativo, no de una regla de límite incorrecta.

Se limita el pool Windows a tres conexiones con el tamaño de trabajadores predeterminado y se ajusta a valores menores cuando corresponde, dejando margen para el progreso del dueño del lock y la E/S. No se aumentaron los timeouts ni se relajó la prueba. Tedious conserva su límite de cinco. No es una garantía frente a carga arbitraria ni múltiples pools nativos compartiendo un proceso; el servidor reutiliza su Singleton.

## Comandos locales

Aplicar migraciones y tener una factura existente antes de subir. No se crean ejemplos permanentes automáticamente:

```powershell
pnpm.cmd db:migrate
pnpm.cmd attachment:check listar ID_FACTURA
$adjuntoDemoKey = [guid]::NewGuid().ToString()
pnpm.cmd attachment:check subir ID_FACTURA "C:/ruta/Factura-001.pdf" $adjuntoDemoKey
```

El cliente abre Microsoft con PKCE; no guarda ni imprime el token. `subir` sí conserva el documento en la base/almacén locales, pero no cambia stock ni envía correo. No volver a generar el UUID para repetir la misma solicitud. La descarga está disponible por la ruta HTTP autenticada; este cliente inicial solo ofrece subir/listar, no descarga a rutas arbitrarias del equipo.

Consulta de limpieza, sin mutación:

```powershell
pnpm.cmd attachment:cleanup
```

Aplicación explícita, solo demostración local con Windows/localhost/`jorge_motors_dev`:

```powershell
pnpm.cmd attachment:cleanup --apply
```

Este último elimina físicamente archivos de cargas pendientes caducadas, completos o parciales, conservando su registro como `ELIMINADO`. No hay papelera/recuperación del objeto desde la aplicación: para reenviarlo se necesita el original. No se ejecuta automáticamente ni se programa un Job cloud en esta entrega.

## Auditoría y verificación

Eventos por fase: `ADJUNTO_RESERVADO`, `ADJUNTO_LISTO`, `ADJUNTO_REINTENTO`, `ADJUNTOS_CONSULTADOS`, `ADJUNTO_DESCARGA_AUTORIZADA`, `ADJUNTO_LIMPIADO` y rechazos HTTP. Una reserva exitosa no implica carga confirmada; buscar `ADJUNTO_LISTO` y el estado final. Autorizar/preparar descarga tampoco prueba que el cliente recibió todos los bytes. La limpieza usa actor de servicio nulo, no atribuye la acción a un empleado inventado.

Las pruebas usan bases SQL aleatorias y una carpeta temporal exclusiva de archivos ficticios. Verifican permisos, cargas simultáneas, reintentos, cuotas, contenido alterado, fallos por fase y limpieza concurrente. Se verifica la ruta exacta de la carpeta temporal antes de eliminarla al terminar. No se usan facturas reales ni se envían archivos a servicios públicos de análisis.

Validación del 21/10/2026: tipos y compilación correctos; **79 unitarias/HTTP y 110 escenarios SQL únicos aprobados (189 total)**. La regresión general ejecutó 109 SQL; después se repitió la suite final de adjuntos con 18/18, incluyendo la prueba adicional de admisión 429 y liberación de plazas. No se suma dos veces el mismo escenario. Los fallos iniciales de concurrencia no se presentan como aprobados: se corrigieron antes de esta verificación.

Se excluyen también `.env` y `.local-data` de los contextos Docker raíz/backend. Esto protege futuros builds, pero no declara implementados el Dockerfile ni CI/CD.

Referencias para los controles y sus límites: [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), [Node.js 24: UV_THREADPOOL_SIZE](https://nodejs.org/docs/latest-v24.x/api/cli.html#uv_threadpool_sizesize). El diagnóstico específico de ODBC se basa además en las reproducciones y el código instalado, no solo en estas referencias.
