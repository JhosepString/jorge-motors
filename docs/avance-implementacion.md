# Bitácora de implementación — Jorge Motors

Fecha de inicio: 20 de octubre de 2026. Entorno objetivo: demo académico en Azure for Students, Central US.

## Acuerdo de trabajo

Se entrega una parte verificable por vez, con código, pruebas y explicación de los patrones. El usuario crea y modifica Azure manualmente, ejecuta despliegues y administra GitHub. Preparar un archivo o un workflow no autoriza a desplegarlo. La documentación del Avance 2 se conserva como evidencia histórica.

## Partes y criterios de cierre

| Parte | Resultado | Patrones o decisiones | Estado |
| --- | --- | --- | --- |
| 1. Base local de la API | Arranque, health, errores, configuración y pruebas | Chain of Responsibility inicial; composición e inyección de dependencias | Completada y verificada localmente |
| 2. Dominio y persistencia del inventario | Repositorios, migración T-SQL y salidas concurrentes sobre SQL Server local | Capas, Repository, Facade y Singleton del pool | Completada y verificada localmente |
| 3. Acceso de usuarios y auditoría | Validador Entra, roles, rutas protegidas y auditoría SQL | Extensión de Chain of Responsibility; RBAC; auditoría atómica con Facade | Completada localmente con identidades reales y evidencia SQL |
| 4. Alertas fiables | Alerta, transición y notificación durable con reintentos | Observer, State, eventos internos y Outbox | 4.1 completada; 4.2 implementada y probada en simulación; correo real/Job cloud pendientes |
| 5. Operaciones del administrador | Catálogo, proveedores, facturas de compra y reportes | Adaptadores de infraestructura; Strategy para PDF/Excel | 5.1, 5.2a/b/c y 5.3 verificadas en local; Blob/antivirus y destinatarios pendientes |
| 6. Interfaz e integración | Flujos por rol según Figma consumiendo la API | Cliente-servidor y separación presentación/negocio | 6.1 implementada y probada localmente; registro SPA y sesiones reales 6.2 pendientes |
| 7. Docker y CI/CD | Imagen reproducible y workflow con despliegue manual | Empaquetado, pruebas y entrega versionada; no son patrones GoF | Dockerfile y workflow de verificación manual preparados; construcción/ejecución pendientes |
| 8. Azure y cierre | Despliegue por el usuario, pruebas integradas y documentación C4 actualizada | Vista de despliegue, observabilidad y atributos de calidad | Pendiente |

La Parte 2 usa `node-mssql`, SQL Server Developer local y un adaptador Windows opcional. La conexión a recursos de Azure y su autenticación administrada esperan a su integración correspondiente. La decisión está documentada en `docs/parte-02-inventario.md`.

## Parte 1 — Qué se implementó

- Express 5 + TypeScript estricto en Node.js 24.
- Separación de aplicación (`app.ts`) y proceso (`server.ts`).
- Validación de puerto, host y origen del frontend con Zod.
- Identificador de solicitud y logs JSON con estado y duración.
- Health público en `/api/v1/health`, errores uniformes, CORS explícito y límites JSON.
- Pruebas HTTP de caminos exitosos y fallidos.

### Patrón: Chain of Responsibility

**Problema:** aplicar reglas HTTP independientes en un orden predecible, deteniendo la solicitud cuando una regla la rechaza.

**Solución:** handlers de Express compuestos con `app.use`; `next()` delega y `next(error)` deriva al tratamiento central de errores. Un controlador puede terminar la cadena enviando la respuesta.

**Evidencia:** `backend/src/app.ts`, `backend/src/middleware/` y `backend/tests/http.test.ts`. La prueba de origen no permitido recibe 403 en una ruta que respondería 200: el middleware evita ejecutar el controlador.

**Alcance actual:** cadena HTTP inicial. No se presenta como autenticación implementada: falta integrar Entra ID, verificar permisos y validar DTO del negocio.

### Arquitectura y otros patrones

La separación arranque/aplicación facilita pruebas y configura las dependencias desde fuera. Esto es una base estructural, no demuestra todavía la arquitectura del dominio ni los otros cinco patrones GoF. No se declara Singleton, Facade, Observer, State, Strategy o Repository como implementados en esta parte.

### RNF y límites

Respalda parcialmente RNF-07 (organización), RNF-08 (errores) y RNF-11 (errores de solicitudes controlados). Health aporta observabilidad inicial a RNF-10, pero no mide disponibilidad. CORS y Helmet aportan controles iniciales; RNF-14 requiere HTTPS en el despliegue. No hay mediciones de rendimiento, pruebas de stock, autenticación ni recuperación de datos en esta entrega.

### Demostración local

Desde `backend/`, instalar con `pnpm install --frozen-lockfile`, ejecutar `pnpm check` y arrancar con `pnpm dev`. Mostrar health, una ruta inexistente y la prueba que interrumpe la cadena. No se requiere Azure para esta demostración.

## Registro de validación

Verificado el 20 de octubre de 2026 con Node.js v24.19.0 y pnpm 11.25.0:

- `pnpm install --frozen-lockfile`: instalación correcta. El proyecto permite explícitamente el script de instalación de esbuild usado por tsx.
- `pnpm check`: chequeo de tipos correcto, 8 pruebas aprobadas y compilación correcta.
- Arranque real de `dist/server.js` en un proceso temporal: `GET /api/v1/health` respondió HTTP 200 con `{"status":"ok","service":"jorge-motors-api"}`. El proceso de comprobación se cerró al terminar.
- `git diff --check`: sin errores de espacios.

La Parte 1 está completada. La siguiente entrega será la Parte 2: dominio y persistencia del inventario, con contratos Repository y coordinación Facade, sin publicar endpoints de negocio desprotegidos. La verificación de Singleton/cliente de conexión se documentará cuando se elija e integre el driver.

## Parte 2 — Inventario y persistencia

Implementación del 21 de octubre de 2026. Guía: `docs/parte-02-inventario.md`.

- **Repository:** contratos de usuario, producto, stock y movimiento; implementaciones SQL transaccionales.
- **Facade:** `registrarSalida` y `registrarEntrada` coordinan validación, permisos de negocio, idempotencia, stock e historial.
- **Singleton:** instancia y promesa de conexión compartidas por proceso, con cierre y reintento de inicialización fallida.
- Dominio con reglas puras de cantidades y stock; esquema parcial T-SQL con restricciones e inmutabilidad del historial.
- Unit of Work, bloqueo por producto y clave de idempotencia para preservar concurrencia y repetición segura.

La autenticación de empleados sigue pendiente. El argumento usuarioId se usa solo desde pruebas internas; aún no hay rutas HTTP de movimientos. No se implementaron alertas, Observer, State ni Outbox en esta parte.

La prueba SQL crea una base efímera aislada en localhost con datos ficticios y la elimina al terminar. No se modifica Azure ni se migran bases existentes del usuario.

### Verificación de cierre de la Parte 2

Ejecutada el 21 de octubre de 2026 con Node.js 24.22.0, pnpm 11.25.0 y SQL Server Developer 2019 local:

- `pnpm.cmd check`: tipos y compilación correctos; **14 pruebas unitarias/HTTP aprobadas**.
- `pnpm.cmd test:sql`: **11 pruebas de integración SQL aprobadas**.
- Concurrencia: dos salidas de 2 unidades sobre stock 3 confirman una sola; saldo final 1 e historial de un movimiento.
- Idempotencia: dos solicitudes simultáneas con la misma clave producen un único movimiento.
- Fallo simulado al guardar el historial: descuento e historial se revierten conjuntamente.
- SQL rechaza UPDATE/DELETE ordinarios del historial; referencias se envían como parámetros.
- Base efímera de pruebas eliminada automáticamente al finalizar.
- La API existente conserva `/api/v1/health` y respondió correctamente tras la entrega.

No se alteró la configuración de red de SQL Server ni la autenticación de la instancia; se usó memoria compartida local con la sesión de Windows. La migración se ejecutó únicamente en bases efímeras. El usuario puede aplicar la migración a su base de desarrollo siguiendo la guía.

**Parte 2 cerrada. Siguiente parte: Entra ID y permisos (Parte 3).** Antes de publicar las operaciones por HTTP se integrará la identidad verificada. Los roles de SQL, la identidad administrada de Azure y el despliegue cloud se validarán en sus etapas respectivas.

## Parte 3 — Identidad, permisos y auditoría

Implementación del 21 de octubre de 2026. Guía manual y evidencias: `docs/parte-03-identidad-auditoria.md`.

- Access tokens v2 validados con JOSE y claves públicas del tenant; audience, issuer, expiración, tenant, object ID, cliente permitido, scope y app role.
- Perfil local activo, identificado por tenant/object ID, con rol compatible con Entra; no se aceptan identidades desde el body.
- Chain of Responsibility extendida: token → perfil → permiso → DTO → controlador.
- GET de perfil y POST de entradas/salidas protegidos; éxito 201 y reintento 200.
- Migración incremental 002: auditoría inmutable mediante trigger para DML ordinario.
- Movimiento, stock y auditoría de éxito dentro de una transacción. Rechazos registrados fuera de la operación revertida; respaldo técnico explícito si SQL falla.
- Cliente de consola MSAL con navegador y Authorization Code + PKCE; tokens solo en memoria. Sustituye Device Code tras el bloqueo real 530035.
- Bootstrap local de perfiles con auditoría del alta y actor no atribuido, ejecutado con permisos Windows.

Las pruebas locales usan firmas RSA de prueba y bases SQL efímeras. **No demuestran aún un token emitido por el tenant real**. No se modificó Azure ni `.env` del usuario. No se declaran completados el registro de aplicaciones, consentimiento, asignaciones o prueba real hasta que el usuario los aplique y los verifiquemos.

Pendiente de cierre real: `/auth/me` 200, salida 201, entrada por Mecánico 403 y registros SQL correspondientes con el tenant del usuario. Retención, permisos SQL mínimos, colector de logs e identidad administrada cloud siguen pendientes de la etapa de despliegue.

### Verificación local de la Parte 3

El 21 de octubre de 2026, `pnpm.cmd check` completó tipos, **35 pruebas unitarias/HTTP** y compilación. `pnpm.cmd test:sql` aprobó **17 pruebas de integración**. Total: **52 pruebas aprobadas**.

Se verificaron el acceso delegado y los rechazos con firmas RSA de prueba, SQL real con auditoría atómica, respuesta 200 de reintento sin doble movimiento, rollback por fallo de auditoría, inmutabilidad ordinaria y alta administrativa local auditada. Los tokens de las pruebas no fueron emitidos por Microsoft; las claves son efímeras e inyectadas solo desde tests.

Las bases temporales se eliminaron al terminar. No se crearon perfiles permanentes del usuario ni se ejecutó el cliente de inicio de sesión real.

### Configuración local y corrección del flujo de autenticación

Posteriormente, con autorización del usuario, se configuró `.env` local (excluido de Git), se creó `jorge_motors_dev`, se aplicaron 001/002 y se dieron de alta dos perfiles Demo activos con sus eventos `USUARIO_REGISTRADO`: Administrador Demo (ID 1) y Mecánico Demo (ID 2). No se registró la cuenta personal como perfil operativo. Azure se configura manualmente por el usuario.

La prueba real iniciada por el usuario fue bloqueada en Entra con 530035 antes del acceso al backend. Se cambió `auth:check` a `acquireTokenInteractive` de MSAL: PKCE S256 administrado por la biblioteca, nonce aleatorio, selector de cuenta, receptor loopback temporal y apertura del navegador predeterminado. No hay fallback Device Code, secretos de cliente ni persistencia de tokens. Se mantiene Security Defaults; no se requiere unir Windows al directorio.

Pendiente manual: registrar `http://localhost` como plataforma móvil/escritorio en **Cliente local - Demo** y repetir la prueba real. La recepción de una respuesta OAuth en la página local no equivale a acceso autorizado: se requiere el HTTP de la API. La Parte 3 sigue abierta.

Verificación de esta corrección: `pnpm.cmd check` aprobó tipos, **39 pruebas unitarias/HTTP** y compilación. Cuatro pruebas nuevas cubren el contrato interactivo, destino permitido, nonce, propagación de errores y el receptor real MSAL con PKCE S256 y cierre ante fallo de apertura; se sustituyó únicamente la construcción remota de la URL para no contactar Entra. No equivalen a una autenticación real de los usuarios Demo.

### Cierre de la Parte 3 — evidencia real

El usuario completó el ajuste de URI y los inicios de sesión reales con PKCE. Se verificaron en la salida HTTP y en SQL:

- Administrador Demo: `/auth/me` 200 (perfil 1) y entrada de 5 unidades 201, movimiento 1, stock 0 → 5.
- Mecánico Demo: salida de 2 unidades 201, movimiento 2, stock 5 → 3.
- Mecánico Demo: entrada rechazada con 403 `ROLE_FORBIDDEN`, request ID `b9d74acf-24e1-4dfb-b112-104081876f58`.
- SQL conserva stock 3 y exactamente dos movimientos autorizados; auditoría `CONSULTA_PERFIL`, `INVENTARIO_ENTRADA`, `INVENTARIO_SALIDA` y `HTTP_RECHAZADA` con los usuarios esperados.
- Última regresión automatizada: 39 pruebas unitarias/HTTP y 17 de integración aprobadas; compilación y tipos correctos, cero bases efímeras restantes.

**Parte 3 cerrada para demostración local.** Los pendientes históricos de inicio de sesión anteriores quedan resueltos por esta evidencia. Retención, permisos SQL de producción e identidad administrada cloud siguen pendientes de despliegue. Próxima parte: alertas fiables (Observer, State y Outbox), aún no implementada.

## Parte 4 — Alertas fiables

### Entrega 4.1 — detección y escritura durable

Guía y comandos: `docs/parte-04-alertas.md`. Umbral inclusivo stock <= mínimo; un solo ciclo abierto por producto. Reposición por encima del mínimo atiende la alerta y cancela la tarea todavía pendiente. Nueva caída abre otro ciclo; replay de un movimiento no vuelve a publicar.

- **Observer:** publicador/suscriptores internos esperados antes del commit; composición fuera de la Facade.
- **State:** clases de estado que deciden transiciones; `PENDIENTE → ATENDIDA` aplicado en el observador; transición `ENVIADA` probada solo en dominio, pendiente de transporte real.
- **Outbox (lado productor):** migración 003, alerta + tarea + auditoría en la transacción de inventario. Sin correos en la petición HTTP.
- Índice único filtrado para un solo ciclo abierto y tarea única por ciclo; no se modifican 001/002.
- Pruebas con bases efímeras: umbral exacto, concurrencia, idempotencia, reposición parcial, cierre y reapertura, persistencia desde otra conexión y rollback por fallos de Outbox/auditoría.

La Parte 4 **no está cerrada**: faltan worker con reclamación/leases, reintentos, recuperación y transporte de correo (4.2). No se afirma entrega exactly-once ni envío de mensajes en esta entrega. La verificación manual del producto Demo será ejecutada por el usuario.

Verificación 4.1: `pnpm.cmd check` aprobó tipos, **45 pruebas unitarias/HTTP** y compilación; `pnpm.cmd test:sql` aprobó **27 pruebas de integración** (72 total). La migración 003 se aplicó y verificó en `jorge_motors_dev`: se conservan stock 3 y los dos movimientos del producto Demo; cero alertas/tareas antes de la prueba manual, cero bases temporales restantes. No se modificó Azure ni se ejecutaron movimientos sobre el producto Demo por el asistente.

Prueba manual inicial 4.1 confirmada: Mecánico Demo registró movimiento 3 (salida 1, stock 3 → 2) con HTTP 201. SQL muestra alerta 1 `PENDIENTE`, stock detectado/mínimo 2/2, y tarea Outbox `PENDIENTE`. Auditorías `INVENTARIO_SALIDA` y `ALERTA_CREADA` corresponden al usuario 2 y comparten request ID `4bde34ca-f818-4731-8205-824aa2a66eb5`. No se envió correo. Falta validar manualmente atención y cancelación por reposición.

**Cierre de la entrega 4.1:** Administrador Demo registró movimiento 4 (entrada 2, stock 2 → 4) con HTTP 201. Lectura SQL posterior confirma alerta 1 `ATENDIDA`, fecha de atención y tarea `CANCELADA`. Auditorías `INVENTARIO_ENTRADA` y `ALERTA_ATENDIDA` del usuario 1 comparten request ID `9d8562eb-e84c-4d19-ad23-4a41b71a465a`, con estado anterior `PENDIENTE` y nuevo `ATENDIDA`. No se envió correo ni se modificó Azure. La verificación manual pendiente de 4.1 queda resuelta; la Parte 4 completa espera 4.2.

### Entrega 4.2 — consumidor con reservas y reintentos

Implementados núcleo `NotificationWorker`, puerto `NotificationTransport`, repositorio `SqlNotificationDispatch` y migración incremental 004. Se conservan 001/002/003 sin cambios.

- Reclamación SQL atómica con lock de aplicación corto; el envío queda fuera de la transacción. Lease de 120 segundos, token por reserva y máximo cinco intentos (incluidas interrupciones). Rechazo de confirmaciones de dueños vencidos o reemplazados.
- Backoff exponencial con jitter, próxima fecha guardada y lotes acotados. Fallo permanente o quinto intento termina `AGOTADA`; quinto lease vencido también se recupera a estado terminal en la siguiente pasada.
- Aceptación, State `ENVIADA` y auditoría atómicos. Fallo de confirmación después de aceptación externa conserva reserva y no se reclasifica como fallo definitivo de transporte. No se promete exactly-once.
- Reposición cancela avisos no aceptados, incluidas reservas e intentos agotados; un envío ya aceptado no se borra. Se prueba la carrera de reposición durante el transporte con resultado `ACEPTACION_NO_CONFIRMADA`.
- Auditoría de actor de servicio nulo, correlación por reserva y códigos acotados; sin mensajes completos de excepción ni tokens Entra.
- `outbox:status`: consulta local sin mutación ni tokens de reserva. `worker:demo`: 16 escenarios SQL con transporte ficticio sobre base aleatoria y `READ_COMMITTED_SNAPSHOT ON`; incluye proceso hijo terminado tras reclamar y recuperación posterior. No se procesa la base real con el simulador.

**4.2 verificada en simulación local.** Correo real, destinatarios, adaptador/entrada operativa, planificación del Job, permisos cloud, métricas y reconciliación siguen pendientes de integración/despliegue. No se modificó Azure ni se envió correo. La migración 004 se aplicó a `jorge_motors_dev`; la consulta posterior conserva alerta 1 `ATENDIDA`, tarea `CANCELADA` e intentos 0. No se alteró el inventario del usuario.

Verificación final del 21/10/2026: `pnpm.cmd check` aprobó tipos, **53 pruebas unitarias/HTTP** y compilación. `pnpm.cmd test:sql` aprobó **43 pruebas SQL** (27 previas y 16 del worker): **96 pruebas aprobadas**. `worker:demo` también pasó por separado con RCSI habilitado en su base aislada. Cero bases efímeras restantes; API `/health` respondió `ok`. El producto Demo permanece con stock 4 y cuatro movimientos. Para reproducir: `pnpm.cmd outbox:status` y `pnpm.cmd worker:demo` desde `backend/`.

### Corrección posterior — falso VACIA por precisión temporal

El usuario reportó 15/16 pruebas aprobadas: el caso de fallo permanente devolvió `VACIA` antes de invocar al transporte. Se identificó y reprodujo una diferencia de precisión: una fecha `datetime2(3)` puede redondearse por encima del reloj original `datetime2(7)` dentro del mismo tick. La selección la consideraba aún futura. Se normalizaron las comparaciones de disponibilidad y reservas a precisión 3 mediante un fragmento SQL fijo, sin cambios de esquema ni esperas artificiales.

Se añadieron dos regresiones: SQL con instantes fijos (incluido cambio de segundo y exclusión de tareas futuras), y 100 altas/reclamaciones inmediatas. Verificación actual: **53 unitarias/HTTP + 45 SQL = 98 aprobadas**, tipos/compilación correctos, y tres demos consecutivas con **18/18** aprobadas, más la demo dentro de la regresión completa. La verificación inicial de 96 pruebas es histórica y queda ampliada por esta corrección. No se modificó el inventario de demostración ni Azure, y no se enviaron correos.

## Parte 5.1 — Catálogo administrativo

Guía: `docs/parte-05-catalogo.md`. Categorías y productos con altas, listados paginados y actualización de metadatos solo para Administrador. Se rechaza edición directa de stock, SKU, activo e identidad. El SKU es único y se normaliza; dinero decimal exacto como texto. No hay borrado físico ni bajas/reactivación todavía.

Se reutilizan Repository, Facade, Chain of Responsibility y Observer/State/Outbox. Se agrega concurrencia optimista con ETag/If-Match (técnica de consistencia, no GoF); la versión de producto cubre metadatos y stock. La migración 005 agrega rowversion, amplía snapshots de auditoría y permite alertas de catálogo sin movimientos ficticios. Outbox V2 se distingue de V1 y el worker valida ambos formatos.

Producto nuevo nace con stock cero y alerta pendiente; editar el mínimo reevalúa ciclos sin alterar cantidades. Cada mutación conserva auditoría y comparte transacción con sus efectos de alerta/Outbox. No se configuran correos ni recursos Azure. El cliente `catalog:check` permite verificación manual con PKCE sin exponer tokens. Cierre manual de 5.1 pendiente de las pruebas con usuarios Demo.

Verificación del 21/10/2026: `pnpm.cmd check` aprobó tipos, **61 pruebas unitarias/HTTP** y compilación. `pnpm.cmd test:sql` aprobó **60 pruebas de integración** (15 catálogo, 27 inventario y 18 worker): **121 pruebas aprobadas**. Se probaron lectura/escritura solo para Administrador, ETags de categoría/producto, conflicto por stock/metadatos concurrentes, dinero exacto hasta DECIMAL(18,2), snapshots extensos, altas duplicadas concurrentes, reevaluación del mínimo, rollback y compatibilidad V1/V2 del worker.

Migración 005 aplicada y revalidada en SQL local. Se conservaron producto 1 con stock 4 y cuatro movimientos, alerta atendida y tarea V1 cancelada; no se crearon categorías/productos nuevos en la base real por el asistente. Cero bases efímeras restantes. `.env` continúa excluido de Git; no se alteró staging ni se crearon commits. Las identidades/recursos cloud se mantuvieron sin cambios.

### Cierre de 5.1 — pruebas delegadas y evidencia real

El 21/10/2026 el usuario autorizó ejecutar las pruebas restantes para acelerar la validación. Se repitió la regresión completa: **61 unitarias/HTTP + 60 SQL = 121 aprobadas**, con tipos y compilación correctos. Las altas y ediciones de productos, concurrencia, permisos, alertas y rollback se comprobaron en bases locales efímeras con identidades firmadas de prueba; no son nuevos inicios de sesión contra Microsoft. Cero bases efímeras restantes al terminar.

Las pruebas interactivas previas del usuario sí usaron identidades Demo reales. Una consulta SQL de solo lectura confirmó:

- Categoría 1: `Demo académico`, versión `00000000000007D4`, sin alteraciones tras los rechazos.
- Edición autorizada: `CATEGORIA_ACTUALIZADA`, usuario 1, HTTP 200, request ID `81cd0636-a46d-44d8-b4eb-b461a948e926`.
- Versión antigua: `HTTP_RECHAZADA`, usuario 1, `STALE_VERSION`, HTTP 412, request ID `28b8c8b5-9de4-45e0-a296-8c0167cb5891`.
- Edición del Mecánico: `HTTP_RECHAZADA`, usuario 2, `ROLE_FORBIDDEN`, HTTP 403, request ID `c097f007-912c-49ee-9613-9187d3140f69`.
- Producto Demo original: stock 4, cuatro movimientos, alerta `ATENDIDA`, tarea `CANCELADA`, cero intentos de envío.

**Parte 5.1 cerrada para demostración local**, combinando identidad real ya verificada y pruebas automatizadas aisladas. No se creó el producto propuesto `DEMO-FIL-002` en la base permanente, no se enviaron correos ni se modificó Azure. Proveedores sin acceso al sistema y facturas de compra corresponden a la siguiente entrega; interfaz, correo real y despliegue siguen pendientes.

## Parte 5.2a — Contactos de proveedores

Guía: `docs/parte-05-2-compras.md`. Nuevo módulo de compras con contratos, `ProveedoresFacade`, repositorio SQL transaccional, rutas administrativas y cliente `supplier:check`. Migración incremental 006 agrega proveedores con código único inmutable, razón social, correo opcional, activo y rowversion. No se crean usuarios ni roles de proveedor; no hay vínculo de destinatarios/alertas ni envío de correo todavía.

Se aplican Facade, Repository y Chain of Responsibility, con el pool Singleton existente. Auditoría y escritura comparten Unit of Work; ETag/If-Match rechaza versiones antiguas. La edición permite desactivar/reactivar sin borrar historia. Los snapshots no replican el correo completo: solo su presencia. No se declaran Observer/State nuevos por editar un contacto ni Strategy de reportes implementada.

Verificación del 21/10/2026: **65 unitarias/HTTP + 70 SQL = 135 pruebas aprobadas**, tipos y compilación correctos. Diez nuevas pruebas SQL verifican permisos, Unicode, no creación de usuarios/movimientos/tareas, ediciones/estados, concurrencia, parametrización, paginación y rollback por fallo de auditoría. Todas las escrituras de prueba fueron aisladas; no se contactó Microsoft ni correo. Facturas, recepción, campos fiscales, asociación producto-proveedor y adjuntos permanecen pendientes.

Migración 006 aplicada y verificada dos veces exclusivamente en `localhost/jorge_motors_dev`, mediante configuración explícita de conexión local sin cargar `.env`. Lectura posterior: cero proveedores permanentes, dos usuarios, cuatro movimientos, stock Demo 4, categoría `Demo académico` con versión `00000000000007D4`, alerta `ATENDIDA`, tarea `CANCELADA` con cero intentos. Cero bases efímeras restantes. La API existente conserva health 200 y rechaza la nueva consulta de proveedores sin sesión con 401. No se modificaron recursos Azure, staging ni commits. **5.2a implementada y validada localmente con identidades de prueba; el acceso interactivo a esta nueva ruta con token Microsoft sigue disponible como demostración opcional, no ejecutada por el asistente.** Siguiente entrega: 5.2b facturas y recepción atómica.

## Parte 5.2b — Registro y recepción atómica de compras

Guía: `docs/parte-05-2b-facturas.md`. El usuario confirmó soles (PEN) al consultar la propuesta de precios finales y recepción completa. El MVP registra importes finales de dos decimales, sin cálculo/desglose automático de impuestos. No es emisión ni validación tributaria; no se presenta el código de proveedor como RUC ni se declara valorización contable.

`FacturasFacade`, contratos, adaptador SQL y rutas administrativas permiten crear/consultar/editar borradores, anular solo borradores y confirmar una recepción completa. Crear/editar/anular no modifica stock. Proveedor/número son inmutables; su unicidad se conserva incluso para anuladas. Confirmar produce entradas vinculadas por línea, conserva snapshots y atiende alertas según el stock resultante, sin cambiar automáticamente el precio maestro de producto.

Se extrajo `registrarMovimientoEnTransaccion`, compartida con `InventarioFacade`, para no abrir una UoW independiente por línea. Movimiento, stock, alerta/Outbox, vínculo, factura y auditoría se confirman en una sola transacción. Facade, Repository, Chain of Responsibility y Observer/State existentes se reutilizan; las transiciones puras de factura no se presentan como otro GoF State. Strategy sigue pendiente.

ETag/If-Match valida el borrador revisado. La recepción exige UUID explícito: replay comprobado con mismo documento, actor, clave y versión original devuelve 200 sin sumar stock otra vez; otro actor/clave no recibe dos veces. Los productos se procesan por ID ascendente. El dinero se calcula en céntimos BigInt y se persiste en DECIMAL(18,2), rechazando desbordamiento.

Migración 007 agrega cabecera y detalle, índices únicos, restricciones y protección contra DML ordinario de documentos finalizados. Las migraciones 001–006 no se modificaron. Cliente `invoice:check` con PKCE y JSON local de tamaño acotado; ejemplo ficticio con IDs que deben existir antes de usarlo.

Verificación del 21/10/2026: **72 unitarias/HTTP + 92 SQL = 164 pruebas aprobadas**, tipos y compilación correctos. Siete nuevas unitarias y 22 nuevas SQL cubren importes, validación estricta, unicidad, recepción concurrente, reintentos, edición/confirmación simultáneas, salida concurrente, fallos en segunda línea y rollback de auditoría/Outbox, estados, snapshots e inmutabilidad. Se usaron claves RSA de prueba y bases locales efímeras, no tokens del tenant real. No se envió correo ni se confirmó una compra en el inventario del usuario.

**5.2b implementada y verificada para la demostración local de recepción.** Adjuntos privados y ciclo de archivos huérfanos son la siguiente entrega 5.2c; aún no se declara completado todo el módulo documental. También permanecen pendientes relación producto-proveedor/destinatarios autorizados, reportes, interfaz y despliegue manual Azure.

Migración 007 aplicada y verificada dos veces en `localhost/jorge_motors_dev` con conexión local explícita sin cargar `.env`. Verificación posterior: cero facturas/detalles y proveedores permanentes, dos usuarios, cuatro movimientos, stock Demo 4, categoría 1 intacta con versión `00000000000007D4`, alerta `ATENDIDA` y tarea `CANCELADA` con cero intentos. Cero bases efímeras restantes. Health sigue respondiendo 200 y la ruta real de facturas devuelve 401 sin token. No se modificaron Azure, staging ni commits; `git diff --check` no reportó errores de espacios.

## Parte 5.2c — Adjuntos privados locales

Guía: `docs/parte-05-2c-adjuntos.md`. Migración 008, `AdjuntosFacade`, repositorio/UoW SQL, puerto `AttachmentStore` y Adapter local con objetos identificados por UUID. API binaria protegida de subida/listado/descarga, solo Administrador; no hay enlaces públicos ni rutas estáticas. PDF/PNG/JPEG con validación básica de nombre/extensión/MIME/firma, máximo 5 MiB y cinco adjuntos activos por factura. No se afirma validación estructural completa ni antivirus.

Primero se confirma la intención durable; después archivo y confirmación de metadatos. Si falla SQL tras escribir, el registro permanece pendiente y admite recuperación con la misma clave o limpieza al caducar. El mismo bloqueo serializa carga/reintento/limpieza. Se mantiene durante E/S para esta demo local acotada, con el costo explícito en conexiones y latencia; antes de Blob se revisarán reservas/cancelación/tiempos. Producción falla cerrada: todavía no hay adaptador Blob ni almacenamiento definitivo de contenedores.

Descarga comprueba tamaño/SHA-256 y audita autorización/preparación antes de devolver bytes, sin afirmar recepción completa del cliente. Se ofrece como attachment/octet-stream con cabeceras restrictivas. Metadatos confirmados son inmutables y no hay eliminación ordinaria de documentos listos. Limpieza local manual: consulta por defecto; `--apply` elimina solo objetos registrados pendientes con más de 30 minutos, máximo 25 por pasada, preservando estado y auditoría. No se programó un Job.

La prueba de seis cargas concurrentes detectó saturación del controlador nativo Windows: consultas bloqueadas ocupaban trabajadores e impedían progresar al propietario del lock. Se observaron esperas SQL y un control con más trabajadores pasó. Se limitó el pool ODBC a tres conexiones con la configuración predeterminada, sin relajar pruebas ni aumentar timeouts; Tedious conserva cinco. Regresión corregida de concurrencia y prueba pura del límite incluidas.

Verificación del 21/10/2026: tipos/compilación correctos, **79 unitarias/HTTP + 110 escenarios SQL únicos = 189 aprobados**. La regresión general pasó 109 SQL y la suite final de adjuntos se repitió con 18/18 tras añadir la admisión 429 (sin contar escenarios repetidos dos veces). Nuevos casos cubren protección, formatos/límites, reintentos simultáneos, fallos de reserva/confirmación, alteración/ausencia de archivo, limpieza concurrente, rollback y caducidad. Las pruebas retiraron sus bases y archivos ficticios temporales; no usaron identidades Microsoft reales ni documentos del usuario.

Adapter es el patrón añadido; Facade, Repository, Chain of Responsibility y Singleton se reutilizan. No se generan movimientos ni eventos de stock al adjuntar. `.local-data` se excluye de Git y de futuros contextos Docker, junto con `.env` en Docker. No se declara completado CI/CD por agregar esos archivos.

**5.2c verificada en local.** El acceso interactivo real a esta ruta es una demostración opcional no ejecutada por el asistente. Quedan Blob privado, análisis de archivos y su integración cloud, políticas de retención/corrección, destinatarios de alertas, reportes Strategy, frontend y despliegue manual.

Migración 008 aplicada y verificada dos veces con configuración local explícita, sin cargar `.env`. Consulta de limpieza sin `--apply`: cero candidatos, ninguna eliminación. Lecturas finales: cero adjuntos y facturas permanentes, dos usuarios, cuatro movimientos, stock Demo 4, categoría intacta con versión `00000000000007D4`, alerta `ATENDIDA`, tarea `CANCELADA` e intentos 0. Cero bases efímeras restantes. Health 200 y ruta real de adjuntos 401 sin token; exclusión Git del almacén comprobada. No se modificaron Azure, staging ni commits; no se enviaron correos ni se crearon adjuntos permanentes. Próxima entrega: reportes PDF/Excel con Strategy; Blob/antivirus y destinatarios requieren su integración posterior.

## Parte 5.3a — Datos comunes de reportes

Guía `docs/parte-05-3-reportes.md`. Nuevo módulo de reportes: Facade, repositorio/UoW y ruta GET `/api/v1/reportes/inventario`, exclusiva de Administrador, con auditoría. Filtros explícitos de categoría, inactivos y bajo mínimo; precio maestro en PEN como texto exacto, estados de stock y resumen de conteos. Límite de 1000 filas con detección de exceso, no truncado silencioso. No es valoración contable ni un reporte histórico.

Se reutilizan Facade, Repository, Chain of Responsibility y Singleton. La lectura usa HOLDLOCK y auditoría en una transacción. Sin nuevas migraciones, paquetes, archivos exportados ni cambios Azure. **Strategy todavía no está implementado**: primero se valida la fuente común; 5.3b incorporará las dos alternativas PDF/Excel y su verificación de archivos. Las guías de PDF/hojas de cálculo se inspeccionaron para preparar esa etapa, no se generaron artefactos de esos formatos en 5.3a.

Validación del 21/10/2026: `pnpm.cmd check` aprobó tipos, **82 unitarias/HTTP** y compilación. Suite focalizada de catálogo/reportes: **19 SQL aprobadas**, incluidas cuatro nuevas de reportes (roles, auditoría/lectura sin cambios, filtros y rechazo de 1001 productos). Se eliminaron los datos/base efímeros de esa suite; no se repitió la regresión SQL completa del resto de módulos en esta entrega. Los datos de prueba usaron firmas ficticias, no un nuevo inicio de sesión real.

Chequeo final de tipos repetido tras añadir las pruebas SQL. Base Demo: stock 4 y cuatro movimientos, cero facturas/adjuntos y cero bases efímeras restantes. API existente: health 200 y ruta real de reportes 401 sin token. Sin nuevas migraciones ni escrituras de negocio sobre la base Demo; los probes sin sesión sí generan su auditoría de rechazo. No se modificaron Azure, staging ni commits. **5.3a completada localmente; siguiente entrega 5.3b, exportadores PDF/Excel y Strategy.**

## Parte 5.3b — Exportación PDF/Excel con Strategy

Implementado el contrato `InventoryReportStrategy`, con `PdfInventoryStrategy` y `ExcelInventoryStrategy`, inyectados por composición en `ReportesFacade`. Ambos consumen la misma lectura autorizada; cambian solamente la generación del formato. Es evidencia concreta de **Strategy**, no solo una interfaz o un formato declarado. Se reutilizan Facade, Repository, Singleton y Chain of Responsibility; Observer/State permanecen en alertas.

Ruta administrativa `/api/v1/reportes/inventario/exportar?formato=pdf|xlsx`, mismos filtros de 5.3a. Render fuera de transacción SQL, revalidación del perfil y auditoría obligatoria de archivo generado antes de entregar bytes. La auditoría no asegura que el usuario terminó de descargarlo. Se acotan productos (1000), tamaño (10 MiB) y exportaciones simultáneas por instancia (dos), incluso si un cliente desconecta mientras trabaja el generador. No se guardan reportes en almacenamiento público ni se envían por correo.

PDF con fuente latina embebida, títulos repetidos, filas ajustadas y paginación; precios exactos desde texto. Excel tipa cantidades, fecha UTC y precios con formato PEN, conserva SKU/nombres como texto literal sin fórmulas ni enlaces. Rechaza importes fuera de su precisión segura con 422 en lugar de redondear. Un texto sin glifo PDF devuelve 422 y recomienda XLSX. No se añade valorización, impuestos, kardex ni reporte de facturas.

Paquetes de producción PDFKit/ExcelJS/fontkit/Noto Sans y tipos de desarrollo instalados, lockfile actualizado y validado con `--frozen-lockfile`. Se corrigió el aviso indirecto de uuid fijando solo `exceljs>uuid` a 11.1.1; `pnpm audit --prod` terminó con cero avisos conocidos. No se requieren herramientas de Codex, Python u Office para generar en el backend; las fuentes se resuelven desde la dependencia también en código compilado.

Verificación del 21/10/2026: **93 unitarias/HTTP y 117 SQL = 210 pruebas aprobadas**, chequeo de tipos y compilación correctos. Se ejecutó nuevamente toda la suite SQL, no solo catálogo/reportes. Incluye autenticación/permisos, misma consulta, auditoría fallida, revocación durante render, celdas literales, límite monetario, varias páginas, ausencia de página vacía adicional, concurrencia y desconexión. Las bases y archivos temporales de pruebas SQL fueron eliminados por sus fixtures.

Se generaron muestras ficticias privadas de 18 productos con textos largos, estados y cantidades límite. PDF: ambas páginas inspeccionadas visualmente y registros/pies comprobados por extracción independiente. XLSX: relectura, inspección de tipos/valores, XML y revisión visual. La vista previa de Artifact Tool distorsionó el importe extremo; Excel instalado confirmó el precio correcto, sin `####`, abriendo solo la muestra en lectura con macros/enlaces deshabilitados y sin guardar. Su PDF nativo también se inspeccionó. Las guías PDF/hojas de cálculo orientaron esta verificación de legibilidad y precisión. La prueba visual detectó y permitió corregir un pie PDF que generaba páginas adicionales; se añadió regresión.

Cliente `pnpm.cmd report:check pdf|xlsx [categoriaId]` preparado para demostración opcional con inicio Microsoft controlado por el usuario, sin imprimir tokens; guarda en `.local-data/reportes/` con UUID y escritura exclusiva. Este inicio interactivo no fue ejecutado por el asistente. Muestras de QA bajo `.local-data/report-qa/`, excluidas de Git/Docker; no contienen información empresarial real.

**5.3b y Parte 5.3 completadas para demostración local.** Sin migraciones nuevas, cambios Azure, correos, staging ni commits. La siguiente parte es la **6: interfaz e integración por rol según Figma**; antes de implementar sus pantallas se revisará el diseño vigente y la configuración SPA de Entra, sin modificar automáticamente la nube. Blob/antivirus, destinatarios/correo real, Docker/CI y despliegue mantienen sus entregas pendientes.

## Parte 6.1 — Avance autónomo autorizado e interfaz local

El usuario autorizó avanzar de forma autónoma mientras se ausentaba. Se respetó el acuerdo de no modificar Azure, no iniciar sesión por él, no publicar GitHub ni enviar correo. La evidencia posterior del usuario confirmó PDF y XLSX con HTTP 200 mediante identidad real de Administrador; el intento `xls` fue un formato no admitido, no un fallo de los exportadores.

Se revisó el Figma vigente mediante metadata, contextos de diseño y capturas de nueve pantallas. Se adaptaron los nodos de acceso, estructura administrativa, inventario, movimientos, proveedores, reportes y mecánico a React/Vite/TypeScript, con tokens/componentes CSS y fuentes IBM Plex locales. No se modificó el archivo Figma ni se usaron sus capturas como fondos. Sin imágenes/SVG estáticos en los nodos seleccionados; no hay URLs temporales Figma en runtime. La guía de Figma orientó la adaptación, y la guía web se aplicó solo al flujo local, sin Site hospedado.

Se sustituyeron las contraseñas locales por MSAL/Entra, se corrigió contraste de texto pequeño detectado por la revisión automática y se omitieron cifras o funciones no implementadas (SMS, RUC validado, valorización y envíos reales). Las compras, posteriores al prototipo, reutilizan los mismos componentes y lenguaje visual. No se declara una copia pixel-perfect de funciones obsoletas.

Frontend preparado: perfil resuelto por API, navegación administrativa o mecánico, búsqueda de stock, alta categoría/producto y edición versionada de producto, movimientos con clave estable por intención, historial, reporte PDF/XLSX, proveedores, creación/revisión/recepción/anulación de compra y documentos privados. El mínimo es inclusivo. Los importes de consulta se presentan desde cadenas decimales, sin convertir el máximo SQL a Number.

La API necesitaba una lectura específica para Mecánico. Se añadieron `InventoryReadFacade`, contrato de UoW y adaptador SQL para stock/categorías sin precio y movimientos limitados por identidad cuando el actor es Mecánico. Paginación máxima 100, búsqueda literal parametrizada, auditoría obligatoria y respuestas sin caché. Se reutilizan **Facade, Repository, Singleton y Chain of Responsibility**; no se concede acceso al catálogo administrativo. Sin migración nueva.

Verificaciones locales: **96 unitarias/HTTP backend + 119 SQL + 6 unitarias frontend + 9 escenarios de navegador = 230 pruebas aprobadas**, tipos y build de ambos proyectos correctos. La suite SQL completa se volvió a ejecutar; no se suman nuevamente escenarios focalizados repetidos. Los escenarios UI emplean una entrada separada con sesión/API ficticias del servidor temporal 5174 y nunca la API real 3000. Incluyen conflicto 412, reintento de salida/recepción conservando clave, bloqueo por stock, descarga, compras y móvil. Axe no detectó infracciones en los criterios A/AA revisados para acceso y stock; esto no certifica accesibilidad completa. Se inspeccionaron capturas de acceso, inventario y móvil.

Se corrigió un problema de enlace del receptor de `fetch`, detectado solo en navegador, y se añadió su regresión. También se corrigieron el cuerpo opcional de referencia para coincidir con el DTO y la aceptación de UUID con guiones en rutas de adjuntos. MSAL v5 usa `redirect.html` como entrada independiente del router, también necesaria para el fallback silencioso por iframe. El build verifica que los archivos de la sesión ficticia no se incluyen en producción; las pantallas y MSAL se cargan por módulos, sin advertencia de chunk inicial superior a 500 kB. Auditoría de paquetes de producción frontend: cero avisos conocidos al verificar.

Límites explícitos: intención de movimiento/recepción en memoria del componente, no recuperable al recargar/cerrar; comprobar historial/documento si se pierde una respuesta y la pantalla. Edición de categorías y borradores existentes, selección de más de 100 proveedores en compra, alertas detalladas, gestión web de usuarios y kardex exportable siguen pendientes. No se presenta el Adapter local de archivos como listo para producción ni se afirma una demostración de Microsoft real en la SPA.

**6.1 completada localmente; 6.2 requiere al usuario.** Guía: `docs/parte-06-frontend.md`. Crear un registro SPA de un solo tenant, con retorno `http://localhost:5173/redirect.html` y raíz para cierre de sesión, permiso delegado de la API y cliente permitido en backend. No se reutilizó/modificó automáticamente el registro de escritorio. No se creó `.env.local` con IDs inventados ni se cambió `.env` del backend; mientras falta la configuración el login real permanece deshabilitado, sin bypass.

## Parte 7 — Preparación, todavía no cierre

`backend/Dockerfile` multi-stage con usuario no-root, sin secretos, dependencias runtime y migraciones; contexto en raíz. Frontend estático previsto para SWA, con fallback y retorno MSAL. `.github/workflows/verify.yml`: ejecución exclusivamente manual, lectura del repositorio, acciones fijadas por SHA verificados, comprobaciones de código/UI y futura construcción/smoke de la imagen en runner. No contiene push a ACR, login Azure ni despliegue. Su YAML y límites de configuración fueron comprobados con un script local; **el workflow no se ejecutó en GitHub**.

Docker Desktop no tenía daemon disponible. No se inició Docker ni WSL, por lo que **no se construyó ni ejecutó la imagen**. Se documenta el procedimiento y los bloqueos en `docs/parte-07-docker-ci.md`: SQL por identidad administrada, Blob/análisis, correo/destinatarios, observabilidad y pruebas cloud. El tag base Docker sigue siendo mutable; no se promete reproducibilidad completa hasta fijar digest y verificarla.

Lectura final de la base Demo: stock 4, cuatro movimientos, cero facturas y adjuntos, cero bases de prueba restantes; health real 200. Se conservaron staging y commits sin cambios del asistente, y `.env` del backend intacto. Los servidores temporales del navegador se cerraron al terminar sus pruebas. No se crearon recursos Azure, no hubo despliegue, envío de correo ni costos Azure por estas operaciones locales.

## Continuación — Adaptador Entra para Azure SQL

Tras comprobar nuevamente 6 pruebas unitarias, 9 escenarios de navegador, build y configuración del workflow, se preparó el siguiente tramo independiente de la configuración del portal. `SQL_DRIVER=entra` usa la autenticación `azure-active-directory-default` de Tedious para Azure SQL, con TLS y sin usuario/contraseña SQL. Admite identidad administrada asignada por el sistema o, mediante `SQL_ENTRA_CLIENT_ID`, asignada por el usuario. La validación rechaza DNS ajenos a Azure SQL, certificado no verificado y mezcla de credenciales. El modo Windows local y el modo SQL existentes conservan su ruta.

**98 pruebas unitarias/HTTP backend aprobadas**, incluido el nuevo contrato de configuración. Sumadas una sola vez a las 119 SQL ya aprobadas, 6 frontend y 9 navegador, hay **232 pruebas locales aprobadas**. La conexión Entra se probó por configuración, no contra una base Azure. La [Parte 8.1](parte-08-azure-sql.md) deja al responsable los pasos de creación y los permisos SQL mínimos; las migraciones requieren una identidad administrativa separada del runtime. No se modificó `.env`, la base demo ni recursos cloud.

## Continuación — Adapter de Azure Blob, sin despliegue

Se añadió `BlobAttachmentStore` bajo el puerto existente `AttachmentStore`. `ATTACHMENT_STORAGE=blob` selecciona el SDK con identidad administrada y contenedor privado; producción sin configuración válida sigue fallando cerrada. Escritura condicional exclusiva, replay de bytes idénticos, lectura acotada con ETag, UUID interno y errores sanitizados conservan el contrato del Adapter local. Las asignaciones RBAC, creación del contenedor y prueba real pertenecen a la [Parte 8.2](parte-08-2-blob.md), que el equipo aplicará manualmente.

Verificación de este tramo: **102 pruebas unitarias/HTTP backend**, compilación y tipos aprobados; los **18 escenarios SQL de adjuntos** se repitieron con base y archivos efímeros eliminados. No se suman los 18 a las 119 SQL previas porque son escenarios ya incluidos allí. No se contactó Azure. La SPA sigue sin registro Web en el tenant examinado: en Registros de aplicaciones → Todas las aplicaciones solo figuran la API y el Cliente local. La prueba real de inicio de sesión web sigue pendiente.

No hay análisis antimalware ni limpieza de objetos pendientes en Blob. La segunda fase de carga mantiene una transacción SQL durante la operación remota; el límite de 12 segundos no convierte esto en diseño de producción. Antes de usar facturas reales se necesitan limpieza cloud, red/recuperación y pruebas de identidad/costo. No se modificaron `.env`, la base Demo ni recursos Azure, y no se ejecutaron Docker/Actions o despliegues.

## Parte 6.2 — Sesión web real y evidencia por rol

El responsable creó manualmente el registro SPA de un solo tenant con `http://localhost:5173/redirect.html` y `http://localhost:5173/` bajo la plataforma de página única, añadió el permiso delegado `Inventario.Access` de la API y concedió consentimiento. Se configuró el Client ID público solo en `frontend/.env.local` y se añadió a `ENTRA_ALLOWED_CLIENT_IDS` local, conservando el cliente CLI. Los archivos de entorno siguen excluidos de Git; no se creó secreto de cliente. El build del frontend pasó tras la configuración.

Evidencia visual aportada por el responsable el 21/10/2026: el **Administrador** inició sesión en la SPA, leyó el producto Demo con stock 4 y descargó PDF y XLSX reales desde la aplicación. El **Mecánico** inició sesión, consultó stock sin precio, abrió el formulario de salida (sin confirmar movimiento) y vio únicamente sus movimientos #2 y #3. Su navegación no mostraba Reportes, Proveedores, Compras ni entrada de stock. La restricción del servidor ante llamadas directas cuenta con pruebas anteriores; estas capturas demuestran la experiencia de usuario, no son por sí solas una nueva prueba HTTP 403.

**Parte 6.2 verificada para la demostración local.** La integración real de Entra con Azure SQL y despliegue siguen pendientes. Se detectó el nombre Demo `demostraciÃ³n` ya almacenado incorrectamente en SQL, visible en SPA/PDF/XLSX. Se hizo robusto el script de semillas futuras frente a páginas de códigos de `sqlcmd`; el registro existente no se corrigió directamente para conservar la auditoría. Debe editarse desde la aplicación con Administrador y comprobar que el stock no cambie.

Corrección confirmada después por la SPA: el Administrador editó el nombre a `Filtro ficticio para demostración`. Una consulta SQL **solo lectura** verificó nombre correcto, stock 4, cuatro movimientos y auditoría `PRODUCTO_ACTUALIZADO / EXITO / usuario 1 / HTTP 200`. No se ejecutó un `UPDATE` manual ni se resembró el producto.

## Parte 7 — Imagen Docker verificada localmente

El responsable construyó `jorge-motors-api:demo` desde `backend/Dockerfile`: BuildKit completó 20/20 etapas. Una prueba posterior arrancó la imagen en `127.0.0.1:3100`; `/api/v1/health` respondió `{"status":"ok","service":"jorge-motors-api"}` y el proceso corre como `uid=1000(node)`. El contenedor temporal se detuvo y eliminó; la imagen permanece local. Evidencia y límites en `docs/parte-07-docker-ci.md`.

Esta prueba valida empaquetado y arranque HTTP, no la conexión de Entra/SQL/Blob desde Linux. El workflow de GitHub Actions aún no se ha ejecutado, la imagen no se ha publicado y no se ha desplegado Azure. Próximo paso verificable: ejecutar manualmente `verify.yml` en GitHub tras revisar/subir la rama; después preparar los recursos Azure por el responsable.
