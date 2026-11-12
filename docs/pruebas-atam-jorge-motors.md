# Pruebas del taller ATAM — Jorge Motors

**Fecha de ejecución:** 5 de noviembre de 2026  
**Documento contrastado:** `C:\Users\josen\Downloads\Taller_ATAM_Jorge_Motors_1neuv.pdf`  
**Alcance:** código y pruebas del repositorio local. Las pruebas SQL usan bases temporales en `localhost`; no escriben en Azure SQL ni envían correos.

## Resultado verificable

| Escenario del taller | Prueba y resultado | Alcance de la evidencia |
| --- | --- | --- |
| Dos mecánicos retiran 2 unidades cada uno de un producto con stock 3 | **Aprobado.** Una salida se confirma, la otra recibe `INSUFFICIENT_STOCK`; quedan stock 1 y un movimiento. | [Prueba SQL](../backend/tests/integration/inventory-sql.test.ts), con dos perfiles ficticios distintos y base efímera. También se prueban idempotencia, rollback e historial inmutable. |
| Usuario anónimo o mecánico intenta registrar una entrada | **Aprobado.** Anónimo `401`, mecánico `403`, rechazo auditado y stock intacto. | [Prueba HTTP+SQL](../backend/tests/integration/inventory-sql.test.ts) y [pruebas de autenticación](../backend/tests/auth.test.ts). Los tokens de esta suite son firmados para pruebas; no constituyen una prueba de MFA real. |
| Falla el envío de un aviso de bajo stock | **Aprobado con transporte simulado.** El Outbox persiste, reprograma fallos temporales, recupera leases vencidos y agota exactamente 5 intentos sin afirmar entrega. | [Pruebas del worker SQL](../backend/tests/integration/outbox-sql.test.ts). **El proveedor no recibe correos reales todavía.** |
| Se apaga la PC de la API o Azure SQL está pausada | **Pendiente de prueba de disponibilidad de extremo a extremo.** `/api/v1/health` tiene pruebas HTTP, pero no demuestra continuidad cuando se apaga la PC. | La API sigue siendo local; la restauración de Azure SQL y el tiempo de reanudación tras pausa no fueron medidos. |
| 20 usuarios consultan stock; p95 ≤ 2 s | **Pendiente de medición con identidad real.** Se añadió una prueba ejecutable de 20 lecturas simultáneas y cálculo de p95. | [Medidor ATAM](../backend/src/cli/atam-load-check.ts) usa **una** sesión Entra y 20 solicitudes contra la API local configurada. Eso mide concurrencia de peticiones, no 20 identidades ni disponibilidad desde otra PC. |
| Añadir exportación CSV sin afectar PDF/XLSX | **Pendiente como cambio futuro.** PDF y XLSX existentes pasan sus pruebas; CSV no está implementado. | [Strategy de reportes](../backend/src/modules/reportes/infrastructure/report-strategies.ts), [contrato de formatos](../backend/src/modules/reportes/application/inventory-report.ts). No se puede declarar exitosa una extensión aún no realizada. |

## Comandos ejecutados y resultados

Desde la raíz del repositorio, en PowerShell:

```powershell
cd backend
pnpm.cmd check
pnpm.cmd test:sql
pnpm.cmd audit --prod --audit-level=high
cd ..\frontend
pnpm.cmd check
pnpm.cmd test:e2e
pnpm.cmd audit --prod --audit-level=high
```

| Comando | Resultado de esta ejecución |
| --- | --- |
| Backend `check` | Tipos y compilación correctos; **102/102** pruebas aprobadas. |
| Backend `test:sql` | **119/119** pruebas aprobadas; bases temporales eliminadas. |
| Frontend `check` | Tipos y compilación correctos; **6/6** pruebas aprobadas. |
| Frontend `test:e2e` | **9/9** pruebas aprobadas. Usan respuestas de API simuladas para los flujos de pantalla. |
| Auditoría de dependencias de producción | Backend y frontend: **sin vulnerabilidades conocidas** en el resultado actual de `pnpm audit`. |

**Total:** 236 pruebas automatizadas aprobadas (102 + 119 + 6 + 9). La cifra del PDF «más de 230» queda respaldada por esta ejecución. La primera corrida de Playwright falló en dos casos porque heredaba la configuración real de `.env.local` mientras esperaba la pantalla sin configuración; se aisló el servidor de prueba en [playwright.config.ts](../frontend/playwright.config.ts) y la repetición aprobó los nueve casos.

La primera auditoría encontró dos dependencias transitivas con avisos de severidad alta. Se actualizó `@azure/identity` a 4.14.1 y se fijó `express>body-parser` en 2.4.0; la segunda auditoría no reportó vulnerabilidades conocidas. Referencias: [aviso de body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828), [aviso de MSAL Node](https://github.com/advisories/GHSA-xcx6-jx8p-x3h5).

## Ubicación de las tácticas

| Táctica / patrón | Código | Comprobación |
| --- | --- | --- |
| Unit of Work, bloqueo por producto, actualización condicional | [sql-inventory.ts](../backend/src/infrastructure/database/sql-inventory.ts), [inventario.facade.ts](../backend/src/modules/inventario/application/inventario.facade.ts) | Concurrencia, idempotencia, rollback y no negativos en `inventory-sql.test.ts`. |
| RBAC, token y perfil local | [authentication.ts](../backend/src/middleware/authentication.ts), [inventory.routes.ts](../backend/src/modules/inventario/presentation/inventory.routes.ts) | `401/403`, rol incompatible, usuario inactivo, rechazo auditado. |
| Helmet y CORS | [app.ts](../backend/src/app.ts) | Pruebas HTTP de origen permitido/rechazado y cabeceras de seguridad en `backend/tests`. |
| Observer, State y Outbox | [stock-alert.observer.ts](../backend/src/modules/alertas/application/stock-alert.observer.ts), [notification-worker.ts](../backend/src/modules/alertas/application/notification-worker.ts), [sql-notification-dispatch.ts](../backend/src/infrastructure/database/sql-notification-dispatch.ts) | Umbral, tarea durable, cinco reintentos y recuperación de lease. |
| Strategy para exportaciones | [report-strategies.ts](../backend/src/modules/reportes/infrastructure/report-strategies.ts) | PDF y XLSX; CSV pendiente. |
| Paginación y pool | [inventory-read.ts](../backend/src/modules/inventario/application/inventory-read.ts), [sql-pool.ts](../backend/src/infrastructure/database/sql-pool.ts) | Filtros/límites y pool probados; meta de p95 aún sin medir. |

## Prueba de rendimiento lista para ejecutar

Requiere la API local iniciada, conexión a Azure SQL habilitada y una identidad Entra activa. No escribe stock; cada lectura registra auditoría normal del sistema. En `backend`:

```powershell
pnpm.cmd atam:load
```

Se abre Microsoft para iniciar sesión. El programa hace una lectura de calentamiento, lanza 20 lecturas concurrentes de `/api/v1/inventario/stock?limite=25` y muestra solicitudes correctas/fallidas, p95 en milisegundos y si cumple 2000 ms. No muestra ni guarda el token. Para evaluar literalmente **20 usuarios distintos**, se necesitan 20 identidades autorizadas y una herramienta de carga configurada para ellas; este medidor no sustituye esa prueba ni mide el arranque en frío de Azure SQL.

## Pruebas de disponibilidad aún necesarias

1. En un entorno de ensayo con la API y el frontend publicados, abrir la aplicación desde otra PC y registrar hora de inicio, último éxito, primer fallo y recuperación. Al detener la API, comprobar que la ruta de stock deja de responder y que el monitoreo detecta el incidente; reiniciarla y medir MTTR. Con la API alojada actualmente en una PC, apagarla causa indisponibilidad por diseño.
2. Medir por separado la primera lectura después de una pausa real de Azure SQL y las lecturas con la base activa. Registrar p95, errores y duración del primer acceso. No se pausó ni reconfiguró la base de demostración durante estas pruebas.
3. Restaurar un backup de Azure SQL a una **copia de ensayo** y comparar recuentos y saldos. La restauración y el tiempo de recuperación no están comprobados por la suite local.
4. Integrar un transporte de correo real, provocar un fallo controlado del proveedor en ensayo y comprobar recepción posterior, clave de idempotencia y estado del Outbox. La suite actual solo prueba el transporte ficticio.

**Interpretación:** integridad y controles de acceso tienen evidencia automatizada sobre SQL Server local. Las afirmaciones sobre MFA real, disponibilidad, entrega de correo, restauración y p95 en nube necesitan las pruebas de extremo a extremo indicadas antes de darlas por verificadas.
