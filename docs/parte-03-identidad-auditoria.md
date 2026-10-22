# Parte 3 — Entra ID, permisos y auditoría

Fecha: 21 de octubre de 2026. **Estado: Parte 3 completada para la demostración local, con identidades reales de Entra y evidencia SQL. Despliegue cloud pendiente.**

## 1. Resultado y patrón

Se añadieron verificación criptográfica de access tokens Entra v2, scope delegado `Inventario.Access`, roles `Administrador`/`Mecanico`, perfil local habilitado y endpoints de movimientos protegidos. La identidad se relaciona por tenant/object ID, no por correo; no se almacenan contraseñas.

**Chain of Responsibility:** contexto → controles HTTP y parseo JSON → token → perfil activo → permiso → validación DTO → controlador/Facade. Los errores recorren un camino alternativo con respuesta uniforme y auditoría. Firma inválida no llega al repositorio de perfiles; entrada por mecánico no llega a la Facade.

Evidencias: `backend/src/middleware/authentication.ts`, `backend/src/modules/auth/infrastructure/entra.ts` y `backend/src/modules/inventario/presentation/inventory.routes.ts`. Continúan Repository, Facade y Singleton de la Parte 2. Auditoría es una responsabilidad transversal, no un patrón GoF adicional.

## 2. Paso A — Registrar la API manualmente

En Azure Portal/Entra: **Microsoft Entra ID → Registros de aplicaciones → Nuevo registro**. Usa tu directorio actual; no necesitas otro tenant.

| Campo | Valor |
| --- | --- |
| Nombre | `Jorge Motors - API - Demo` |
| Tipos de cuenta | Solo cuentas de este directorio organizativo (un tenant). |
| URI de redirección | Vacío: la API verifica tokens, no realiza el inicio de sesión. |

Conserva **Id. de directorio (inquilino)** e **Id. de aplicación (cliente)**. El ID de objeto del registro no es el client ID.

En **Exponer una API**, configura el URI `api://<CLIENT_ID_DE_LA_API>` y agrega el ámbito:

- Nombre: `Inventario.Access`.
- Consentimiento: administradores.
- Nombre visible: `Acceder al inventario de Jorge Motors`.
- Descripción: `Permite al empleado usar la API según su rol asignado.`
- Habilitado: sí.

En **Manifiesto**, conserva las propiedades existentes y establece `requestedAccessTokenVersion` en **2**, dentro del objeto `api` del formato Microsoft Graph. En el formato antiguo puede aparecer como `accessTokenAcceptedVersion`. El endpoint OAuth v2 por sí solo no fuerza la versión del access token del recurso.

En **Roles de aplicación**, crea:

| Nombre visible | Miembros permitidos | Valor exacto | Habilitado |
| --- | --- | --- | --- |
| Administrador | Usuarios/Grupos | `Administrador` | Sí |
| Mecánico | Usuarios/Grupos | `Mecanico` | Sí |

Los valores son sensibles a mayúsculas. No concedas roles de administración del directorio para representar estos permisos del taller.

## 3. Paso B — Registrar el cliente de prueba

Crea otro registro: **`Jorge Motors - Cliente local - Demo`**, del mismo tenant. Guarda su **Id. de aplicación (cliente)**.

En **Autenticación → Agregar una plataforma → Aplicaciones móviles y de escritorio**, registra la URI **`http://localhost`**. No selecciones Web ni SPA para este cliente de consola. MSAL abre un receptor temporal en `127.0.0.1`, usa un puerto libre y Authorization Code + PKCE S256; el registro de localhost permite el puerto dinámico. No se requiere client secret. Esto corresponde al cliente local, no a la API.

Corrección del 21/10/2026: la prueba inicial con Device Code fue bloqueada con error 530035 por las protecciones predeterminadas del directorio. **Se mantienen las protecciones y MFA**; `auth:check` ya no usa Device Code ni tiene fallback a ese método. No se necesita unir Windows a Entra. La opción anteriormente habilitada de flujos de cliente público no sustituye el registro de la URI de escritorio; no habilites concesión implícita ni agregues secretos.

En **Permisos de API → Agregar un permiso → Mis API**, selecciona Jorge Motors API y agrega el permiso **delegado** `Inventario.Access`. Con una identidad autorizada para ello, concede consentimiento del administrador. No agregues permisos de Microsoft Graph para esta prueba.

Este registro permite probar la API sin construir aún React. Más adelante, el frontend tendrá un registro SPA con Authorization Code + PKCE y su client ID se añadirá a la lista de clientes permitidos.

## 4. Paso C — Asignar roles

En **Aplicaciones empresariales**, abre la aplicación de la **API**, entra en **Usuarios y grupos** y asigna directamente a cada empleado su rol. Usa usuarios existentes del directorio para el demo: un Administrador y un Mecánico.

Los roles deben aparecer en el token destinado a la API. Por ello se asignan en la aplicación empresarial de la API, no solo en la del cliente. Para el demo usa asignación individual y evita depender de licencias para asignación por grupos.

En **Entra ID → Usuarios → usuario**, copia su **Id. de objeto** dentro del directorio. Este identifica a la persona y no es el ID de objeto de la aplicación. Si usas tu correo personal, utiliza el object ID de su representación en este tenant.

## 5. Preparar SQL y variables locales

Desde `backend/`:

```powershell
pnpm.cmd install --frozen-lockfile
```

Si falta tu base exclusiva local, puedes crearla explícitamente:

```powershell
sqlcmd -S localhost -E -C -b -Q "IF DB_ID(N'jorge_motors_dev') IS NULL CREATE DATABASE [jorge_motors_dev];"
```

Si ya existe, confirma que es la del proyecto. Conserva tu `.env` y agrega solo las variables que falten, reemplazando los placeholders por UUID reales:

```dotenv
SQL_DRIVER=windows
SQL_SERVER=localhost
SQL_DATABASE=jorge_motors_dev
SQL_TRUST_CERTIFICATE=true
ENTRA_TENANT_ID=UUID_DEL_DIRECTORIO
ENTRA_API_CLIENT_ID=CLIENT_ID_DE_LA_API
ENTRA_ALLOWED_CLIENT_IDS=CLIENT_ID_DEL_CLIENTE_LOCAL
ENTRA_TEST_CLIENT_ID=CLIENT_ID_DEL_CLIENTE_LOCAL
```

`ENTRA_ALLOWED_CLIENT_IDS` admite UUID separados por comas. Los IDs no son secretos; no se requiere una contraseña de aplicación. No dejes placeholders ni una configuración Entra parcial: se rechaza al iniciar.

```powershell
pnpm.cmd db:migrate
```

Se aplican/verifican `001_inventory` y `002_audit`. No edites la migración 001 ya aplicada. Reinicia la API con Ctrl+C y `pnpm.cmd dev` después de actualizar `.env`.

## 6. Crear perfiles operativos

Ejecuta una vez por empleado, sustituyendo el object ID de cada persona:

```powershell
pnpm.cmd db:user:add UUID_DEL_USUARIO_ADMIN ADMINISTRADOR "Administrador de prueba"
pnpm.cmd db:user:add UUID_DEL_USUARIO_MECANICO MECANICO "Mecánico de prueba"
```

Se crea un perfil en SQL Server local, no una persona ni una asignación de rol en Entra. Los roles locales `ADMINISTRADOR`/`MECANICO` deben corresponder a `Administrador`/`Mecanico` del token. No se eleva el rol automáticamente.

Este procedimiento de bootstrap se audita en la misma transacción del alta, con código `LOCAL_BOOTSTRAP_PROFILE_CREATED`. Se ejecuta con privilegios Windows y no se atribuye al empleado recién creado. La futura administración desde la interfaz usará actor Entra verificado.

## 7. Probar identidad real e inventario

Con la API activa, en otra terminal ejecuta:

```powershell
pnpm.cmd auth:check
```

La herramienta abre el navegador predeterminado con el selector de cuentas Microsoft. Selecciona **Administrador Demo** o **Mecánico Demo**, no tu identidad personal de administración de Azure. Completa tú la contraseña, cambio inicial o MFA que Microsoft solicite. No compartas contraseñas, códigos ni tokens en el chat. El cliente mantiene el token solo en memoria, consulta `/api/v1/auth/me` y muestra únicamente la respuesta de la API. La página de retorno solo confirma la recepción de la respuesta de Microsoft: el acceso al backend se confirma en la terminal. El proceso termina a los cinco minutos si no completas el flujo.

Se espera `HTTP 200` con ID interno, nombres y rol. Si Microsoft rechaza el inicio, consulta los detalles o los registros de inicio de sesión: no cambies políticas generales para saltar el control. `AADSTS50011` indica que hay que revisar la URI de retorno del cliente de escritorio. Esta prueba no debe ejecutarse mediante Device Code.

Para tener un producto ficticio, desde `backend/` puedes ejecutar:

```powershell
sqlcmd -S localhost -E -C -d jorge_motors_dev -b -i ..\database\azure-sql\demo-product.sql
```

El script no reemplaza productos ni restablece stock; crea `DEMO-FIL-001` inicialmente con cero y muestra su ID. Con ese ID:

```powershell
# Como Administrador: entrada real al inventario local de prueba.
pnpm.cmd auth:check entrada ID_DEL_PRODUCTO 5
# Como Mecánico: salida autorizada.
pnpm.cmd auth:check salida ID_DEL_PRODUCTO 2
# Como Mecánico: entrada rechazada con 403.
pnpm.cmd auth:check entrada ID_DEL_PRODUCTO 1
```

Los comandos con entrada/salida sí modifican el inventario cuando el usuario tiene permiso. Cada ejecución representa una operación nueva y genera otra clave; no los repitas esperando deduplicación. Las pruebas automáticas sí verifican la repetición con la misma clave.

## 8. Contrato de endpoints

| Método y ruta | Acceso |
| --- | --- |
| GET `/api/v1/health` | Público, no consulta SQL. |
| GET `/api/v1/auth/me` | Empleado habilitado y rol coherente. |
| POST `/api/v1/inventario/salidas` | Administrador o Mecánico. |
| POST `/api/v1/inventario/entradas` | Administrador. |

Los POST requieren `Authorization: Bearer <access-token>`, `Idempotency-Key: <UUID>` y este cuerpo:

```json
{"productoId":1,"cantidad":2,"motivo":"Uso en taller","referencia":"OT-externa-001"}
```

`referencia` es opcional. El usuario se obtiene del token/perfil; no se acepta `usuarioId`, rol ni clave de idempotencia en el body. Respuestas principales: 201 creado; 200 reintento idéntico; 400 datos; 401 token; 403 permisos/perfil; 404 producto; 409 conflicto; 503 configuración/dependencia indisponible. Sin configuración nunca se habilita acceso libre.

## 9. Auditoría implementada

`jm.auditoria` guarda ID de evento, fecha UTC, request ID, acción, resultado, usuario interno si es conocido, tenant/object ID verificados, entidad, código, estado HTTP y saldos anterior/nuevo cuando corresponde.

La auditoría de éxito comparte transacción con stock y movimiento: si falla, todo se revierte. Un reintento conserva un único movimiento y agrega evidencia de la petición repetida. Los rechazos HTTP se registran fuera de la transacción revertida.

Tokens inválidos no se decodifican para atribuir identidad: actor desconocido queda nulo. Si falla SQL al registrar un rechazo, se emite `audit_persistence_failed` con `destination=console_fallback`. Eso es un respaldo técnico, no una fila confirmada en SQL ni una garantía de conservación sin colector.

El trigger impide UPDATE/DELETE ordinarios de auditoría. Un administrador del motor aún puede alterar el esquema; no se afirma WORM. Retención, permisos mínimos y exportación operativa se definirán al desplegar. No se guardan tokens, contraseñas, Authorization ni cuerpos completos. Logs de Entra y Activity Log de Azure son fuentes distintas, no administradas por este código.

Para revisar evidencia en SSMS, en la base del proyecto:

```sql
SELECT TOP (50) fecha, request_id, accion, resultado, usuario_id,
       entidad_id, codigo, http_status, valores_anteriores, valores_nuevos
FROM jm.auditoria ORDER BY id DESC;
```

Todavía no hay pantalla ni endpoint de consulta de auditoría. Cambios de productos, proveedores y facturas se auditarán cuando se implementen esas operaciones.

## 10. Verificación y cierre

```powershell
pnpm.cmd check
pnpm.cmd test:sql
```

Las pruebas usan firmas RSA reales con claves efímeras locales y SQL Server local; no consultan tu tenant. Cubren firma, expiración, issuer/audience/tenant, cliente permitido, scope, roles, perfil inactivo, DTO y detención antes del controlador. SQL verifica éxito/rechazo auditados, reintento e inmutabilidad, y rollback si falla la auditoría. Las bases temporales se eliminan al finalizar.

Resultado local del 21/10/2026: **35 pruebas unitarias/HTTP y 17 de integración aprobadas**, con tipos y compilación correctos. El alta local por CLI también se prueba contra la base efímera, incluidos duplicados y fallo de auditoría.

La integración real se verificó el 21/10/2026 mediante inicio de sesión manual del usuario con PKCE y tokens emitidos por su tenant:

| Evidencia | Resultado |
| --- | --- |
| Administrador Demo consulta `/auth/me` | HTTP 200; perfil interno 1, `ADMINISTRADOR`; auditoría `CONSULTA_PERFIL`. |
| Administrador Demo registra entrada de 5 | HTTP 201; movimiento 1, stock 0 → 5; auditoría `INVENTARIO_ENTRADA`. |
| Mecánico Demo registra salida de 2 | HTTP 201; movimiento 2, stock 5 → 3; auditoría `INVENTARIO_SALIDA`. |
| Mecánico Demo intenta entrada de 1 | HTTP 403 `ROLE_FORBIDDEN`; auditoría `HTTP_RECHAZADA`, usuario 2. |
| Consulta SQL posterior al rechazo | Stock 3; exactamente dos movimientos para el producto Demo. |

Request ID del rechazo verificado: `b9d74acf-24e1-4dfb-b112-104081876f58`. La auditoría de movimientos conserva saldos anterior/nuevo, y la de rechazo no atribuye una modificación de stock. Se confirmó cada registro mediante lectura de SQL local. Las altas iniciales se hicieron con la herramienta local; no son acciones atribuidas a las identidades Demo.

Tras la corrección del cliente: tipos y compilación correctos, 39 pruebas unitarias/HTTP y 17 de integración aprobadas (56 total), sin bases temporales restantes. Las pruebas automatizadas y las evidencias manuales reales son comprobaciones distintas.

**Parte 3 cerrada en alcance local.** Azure fue configurado manualmente por el usuario y el inicio de sesión lo completó él. Siguen pendientes retención y permisos SQL de producción, identidad administrada de acceso a Azure SQL, despliegue cloud y pantalla de auditoría. La siguiente parte es alertas fiables con Observer, State y Outbox; aún no están implementados.

## 11. Referencias oficiales

- [Validación de claims](https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation).
- [Scopes y app roles](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-protected-web-api-verification-scope-app-roles).
- [Exponer una API](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-configure-app-expose-web-apis).
- [Roles de aplicación](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps).
- [Manifiesto y versión del token](https://learn.microsoft.com/en-us/entra/identity-platform/reference-app-manifest).
- [MSAL Node](https://learn.microsoft.com/en-us/entra/msal/javascript/node/acquire-token-requests).
