# Jorge Motors: guía de pruebas de seguridad y patrones

Estado comprobado el **5 de noviembre de 2026**. Abre este archivo en la vista previa
de VS Code (`Ctrl+Shift+V`) para seguir los enlaces al código. La API de esta PC
usa Azure SQL; el frontend y la API todavía se ejecutan localmente. Los comandos
de prueba SQL crean bases temporales en SQL Server **local**, no en Azure.

## 1. Preparación (PowerShell)

Desde la raíz del repositorio, abre dos terminales:

```powershell
cd backend
node -v                 # 24.x
pnpm.cmd -v             # 11.25.0
pnpm.cmd dev            # mantener abierta esta terminal; API en 127.0.0.1:3000
```

```powershell
cd frontend
pnpm.cmd dev            # interfaz en http://localhost:5173
```

Si ya están escuchando en esos puertos, no abras otra instancia. `backend/.env`
debe contener `SQL_DRIVER=entra`, el servidor Azure SQL y los IDs Entra vigentes;
`frontend/.env.local` debe contener el ID del cliente SPA. Son archivos locales,
no se suben a GitHub. Una cuenta Azure CLI autorizada permite que **esta API
local** se conecte a Azure SQL. No muestres `.env`, tokens, contraseñas ni códigos MFA
en la proyección.

## 2. Seguridad: pruebas observables sobre la API activa

Ejecuta desde cualquier terminal PowerShell. Estas solicitudes no modifican
inventario. La ruta `/health` solo prueba HTTP; las otras rutas verifican la cadena
de seguridad y pueden escribir registros de rechazo en auditoría.

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health

$sinToken = Invoke-WebRequest http://127.0.0.1:3000/api/v1/auth/me -SkipHttpErrorCheck
$sinToken.StatusCode
($sinToken.Content | ConvertFrom-Json).error.code

$tokenFalso = Invoke-WebRequest http://127.0.0.1:3000/api/v1/auth/me `
  -Headers @{ Authorization = 'Bearer token-invalido' } -SkipHttpErrorCheck
$tokenFalso.StatusCode
($tokenFalso.Content | ConvertFrom-Json).error.code

$origenAjeno = Invoke-WebRequest http://127.0.0.1:3000/api/v1/health `
  -Headers @{ Origin = 'https://example.invalid' } -SkipHttpErrorCheck
$origenAjeno.StatusCode
($origenAjeno.Content | ConvertFrom-Json).error.code
```

Resultados esperados y **observados en esta PC**: health `200`; sin Bearer `401 /
TOKEN_REQUIRED`; token inválido `401 / INVALID_TOKEN`; origen ajeno `403 /
ORIGIN_NOT_ALLOWED`. CORS limita navegadores; no sustituye autenticación.
Comprueba la persistencia de los rechazos en Azure SQL con:

```powershell
cd backend
pnpm.cmd demo:evidence
```

La salida muestra base, stock, alertas, Outbox y los últimos códigos de auditoría,
sin imprimir tokens. El 5/11 se observaron rechazos `TOKEN_REQUIRED` e
`INVALID_TOKEN` en `jm.auditoria`; el producto Demo 1 conservó stock `4`.
Si la base serverless está pausada, la primera consulta puede tardar. El código
de esta consulta de solo lectura está en [demo-evidence.ts](../backend/src/cli/demo-evidence.ts).

### Identidad Microsoft real y permisos por rol

Esta parte exige que una persona complete el inicio de sesión y MFA en el
navegador. El asistente **no** completó esa interacción en esta comprobación.

```powershell
cd backend
pnpm.cmd auth:check
```

Selecciona **Administrador Demo**. Esperado: `HTTP 200` y perfil
`ADMINISTRADOR`. Repite con **Mecánico Demo**: `HTTP 200`, perfil `MECANICO`.
Para demostrar una prohibición real sin cambiar stock, inicia como Mecánico:

```powershell
pnpm.cmd auth:check entrada 1 1
```

Esperado: `HTTP 403`, `ROLE_FORBIDDEN`; el movimiento no debe crearse. El comando
termina con código de salida distinto de cero porque el rechazo es intencional.
Consulta de nuevo `pnpm.cmd demo:evidence` para ver la auditoría. **No ejecutes
ese comando como Administrador** si no quieres sumar una unidad al stock.
En la interfaz, verifica que el Mecánico no vea precios ni reportes; esa
ocultación visual es secundaria: el `403` del servidor demuestra la barrera real.

Como Administrador puedes generar reportes sin cambiar stock:

```powershell
pnpm.cmd report:check pdf
pnpm.cmd report:check xlsx
```

Ambos comandos piden inicio de sesión Microsoft y guardan archivos privados en
`backend/.local-data/reportes/`; deben responder `HTTP 200`. Con Mecánico deben
responder `403` y no entregar un archivo. La generación sí deja auditoría.

La validación JWT está en [entra.ts](../backend/src/modules/auth/infrastructure/entra.ts):
firma, emisor, audiencia, tenant, cliente permitido y ámbito. El middleware
[authentication.ts](../backend/src/middleware/authentication.ts) exige Bearer,
busca el perfil activo y aplica rol. [auth.routes.ts](../backend/src/modules/auth/presentation/auth.routes.ts)
expone `/auth/me`. Microsoft Entra aplica MFA según su política; el backend
valida el token recibido, no implementa un segundo factor propio.

## 3. Pruebas automatizadas con SQL Server real

Desde `backend/`, con SQL Server local y ODBC Driver 18 instalados:

```powershell
pnpm.cmd check       # tipos, pruebas unitarias/HTTP y compilación
pnpm.cmd test:sql    # integración sobre bases locales jm_test_<UUID>
```

El 5/11 pasaron **102/102** pruebas de `check` y **119/119** pruebas SQL.
`test:sql` crea y elimina sus bases temporales; los escenarios usan SQL Server
real, transacciones, concurrencia y restricciones. Los tokens de las pruebas
automatizadas están firmados con claves efímeras de prueba: **no demuestran MFA
ni inicio de sesión con el tenant real**. Eso se comprueba por separado en el
apartado anterior. Las pruebas del worker usan un transporte ficticio y no
envían correo.

## 4. Los seis patrones GoF: código, comportamiento y evidencia

| Patrón | Cómo funciona aquí | Dónde verlo | Prueba reproducible |
| --- | --- | --- | --- |
| **Singleton** | Una instancia por proceso comparte la promesa de conexión y el pool SQL; conexiones simultáneas no crean pools independientes. | [sql-pool.ts](../backend/src/infrastructure/database/sql-pool.ts), [runtime-services.ts](../backend/src/infrastructure/runtime-services.ts) | `pnpm.cmd check`; observa las pruebas de pool en [attachments.test.ts](../backend/tests/attachments.test.ts). `demo:evidence` comprueba la conexión configurada, pero por sí solo no demuestra unicidad. |
| **Facade** | `InventarioFacade` ofrece entrada/salida y coordina reglas, repositorios, movimiento, auditoría y evento dentro de una operación. | [inventario.facade.ts](../backend/src/modules/inventario/application/inventario.facade.ts), [inventory.routes.ts](../backend/src/modules/inventario/presentation/inventory.routes.ts) | `pnpm.cmd test:sql`; salida/entrada persisten saldos y la falla de auditoría revierte la operación en [inventory-sql.test.ts](../backend/tests/integration/inventory-sql.test.ts). |
| **Observer** | Un movimiento publica `StockCambiado` antes del commit; `StockAlertObserver` abre o atiende alertas y escribe Outbox en la misma transacción. | [transactional-publisher.ts](../backend/src/shared/transactional-publisher.ts), [inventory-events.ts](../backend/src/infrastructure/inventory-events.ts), [stock-alert.observer.ts](../backend/src/modules/alertas/application/stock-alert.observer.ts) | `pnpm.cmd check` prueba suscripción/propagación de fallos en [alerts.test.ts](../backend/tests/alerts.test.ts); `pnpm.cmd test:sql` comprueba alerta y Outbox reales, además del rollback. |
| **Strategy** | El caso de uso obtiene un reporte autorizado y elige generador PDF o XLSX mediante el mismo contrato. | [inventory-report.ts](../backend/src/modules/reportes/application/inventory-report.ts), [report-strategies.ts](../backend/src/modules/reportes/infrastructure/report-strategies.ts) | `report:check pdf` y `report:check xlsx` con Administrador; las pruebas SQL/HTTP están en [catalog-sql.test.ts](../backend/tests/integration/catalog-sql.test.ts). |
| **State** | Los objetos `Pendiente`, `Enviada` y `Atendida` deciden las transiciones válidas de una alerta; un estado atendido no puede reenviarse. | [alerta.ts](../backend/src/modules/alertas/domain/alerta.ts), [stock-alert.observer.ts](../backend/src/modules/alertas/application/stock-alert.observer.ts) | `pnpm.cmd check` ejecuta [alerts.test.ts](../backend/tests/alerts.test.ts); `pnpm.cmd test:sql` verifica estados persistidos y reintentos del Outbox en [outbox-sql.test.ts](../backend/tests/integration/outbox-sql.test.ts). |
| **Chain of Responsibility** | Express procesa contexto, Helmet, CORS, JSON, rutas, autenticación/rol y errores; un rechazo detiene la petición antes del caso de uso. | [app.ts](../backend/src/app.ts), [request-context.ts](../backend/src/middleware/request-context.ts), [authentication.ts](../backend/src/middleware/authentication.ts), [error-handler.ts](../backend/src/middleware/error-handler.ts) | Los `401`/`403` de la sección 2 sobre la API activa; pruebas de cadena en [http.test.ts](../backend/tests/http.test.ts) y [auth.test.ts](../backend/tests/auth.test.ts). |

### Patrones y mecanismos complementarios

- **Repository:** [contratos](../backend/src/modules/inventario/application/contracts.ts) frente a [adaptador SQL](../backend/src/infrastructure/database/sql-inventory.ts). Las pruebas SQL ejercitan el contrato contra el motor real.
- **Unit of Work:** [sql-transaction.ts](../backend/src/infrastructure/database/sql-transaction.ts) confirma o revierte stock, movimiento, auditoría, alerta y Outbox juntos. `test:sql` fuerza fallos y comprueba rollback.
- **Idempotencia:** [inventario.facade.ts](../backend/src/modules/inventario/application/inventario.facade.ts) busca la clave antes de crear otro movimiento; [inventory-sql.test.ts](../backend/tests/integration/inventory-sql.test.ts) envía duplicados concurrentes y comprueba un único descuento.
- **Outbox:** [stock-alert.observer.ts](../backend/src/modules/alertas/application/stock-alert.observer.ts) registra la tarea durable con la alerta; [outbox-sql.test.ts](../backend/tests/integration/outbox-sql.test.ts) verifica reclamación, reintento y recuperación con transporte ficticio. No hay evidencia de correo real enviado.
- **Adapter:** [contrato de adjuntos](../backend/src/modules/compras/application/attachment-contracts.ts), [almacenamiento local](../backend/src/infrastructure/storage/local-attachment-store.ts) y [Azure Blob](../backend/src/infrastructure/storage/blob-attachment-store.ts). Las pruebas SQL usan disco local temporal; Blob cloud todavía no está verificado.

Repository, Unit of Work y Outbox no son patrones GoF. **Adapter sí pertenece
al catálogo GoF**, y aparece como patrón adicional a los seis destacados en la
presentación original. La arquitectura general es monolito modular en capas
con cliente React y API REST.

## 5. Demostración opcional de Observer y State con datos cloud

Solo si quieres **modificar deliberadamente** la base Demo: antes de empezar,
`pnpm.cmd demo:evidence` debe mostrar producto `1`, mínimo `2` y stock `4`.
Como Administrador, `pnpm.cmd auth:check salida 1 2` baja el stock a `2`, crea
una alerta `PENDIENTE` y una tarea Outbox. Repite `demo:evidence` para verlo.
Luego `pnpm.cmd auth:check entrada 1 2` devuelve stock a `4`, atiende la alerta
y cancela la tarea aún no aceptada. Repite `demo:evidence`. **Cada comando crea
un movimiento y auditoría permanentes**, aunque el stock final vuelva a 4.
Si el estado inicial no coincide o la primera operación falla, no ejecutes la
segunda a ciegas. Ninguno de estos pasos envía correo.

Para la exposición sin cambios permanentes, usa `pnpm.cmd test:sql` y señala
los casos de [outbox-sql.test.ts](../backend/tests/integration/outbox-sql.test.ts).
