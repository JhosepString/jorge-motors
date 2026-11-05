# Jorge Motors — guía para demostrar los patrones en VS Code

Esta guía acompaña la **presentación local**. Ábrela en VS Code con `Ctrl+Shift+V` (vista previa de Markdown) y haz clic en los enlaces al código. Las líneas indicadas son puntos de partida; el enlace abre el archivo correspondiente. No requiere cambiar `.env`, conectar Azure SQL ni ejecutar migraciones.

## Recorrido sugerido (8–10 minutos)

1. Abre la aplicación local como **Mecánico**. Muestra «Consultar stock» y «Mis movimientos». Explica que el servidor filtra por identidad y no entrega precios al mecánico. No hace falta registrar una salida nueva.
2. Abre esta guía en VS Code y sigue las evidencias de **Chain → Facade → Repository → Singleton**. Son las piezas que participan en una solicitud de inventario.
3. Sigue **Observer → State** para explicar qué ocurre cuando el stock llega al mínimo. El evento interno y el registro Outbox son locales; no afirmes que se envió un correo real.
4. Abre la pantalla de reportes como **Administrador** y, si ya tienes archivos descargados, enseña el PDF y el XLSX. Luego abre **Strategy** para mostrar por qué ambos formatos parten del mismo reporte.
5. Cierra con **Adapter**: almacenamiento local para la demo y adaptador Azure Blob preparado, pero no desplegado como parte de la demostración local.

## Evidencia rápida, patrón por patrón

| Patrón | Explicación breve para exponer | Enlace directo al código |
| --- | --- | --- |
| **Chain of Responsibility** | Cada middleware resuelve una responsabilidad y pasa la petición al siguiente: contexto, autenticación, perfil, rol, ruta y manejo de errores. Una entrada de Mecánico se rechaza con `403` antes de ejecutarse. | [Orden general de middlewares](../backend/src/app.ts) (línea 24); [autenticación y rol](../backend/src/middleware/authentication.ts) (líneas 5 y 33); [rutas de inventario](../backend/src/modules/inventario/presentation/inventory.routes.ts) (líneas 19–35). |
| **Facade** | El controlador invoca `registrarEntrada` o `registrarSalida`; la fachada coordina validación, reglas, stock, movimiento, auditoría y evento dentro de la unidad de trabajo. | [InventarioFacade](../backend/src/modules/inventario/application/inventario.facade.ts) (líneas 20–40 y 45–102). |
| **Repository** | La aplicación usa contratos para consultar y guardar datos; el SQL queda en el adaptador de infraestructura. No es un ORM. | [Contratos de repositorio](../backend/src/modules/inventario/application/contracts.ts) (líneas 40–52); [implementación SQL](../backend/src/infrastructure/database/sql-inventory.ts). |
| **Singleton** | El proceso comparte una instancia del proveedor de conexiones, en lugar de crear un pool por petición. | [SqlPoolSingleton](../backend/src/infrastructure/database/sql-pool.ts) (desde la línea 65); [uso en composición](../backend/src/infrastructure/runtime-services.ts) (línea 47). |
| **Observer** | Tras un movimiento confirmado en la transacción, se publica un evento interno de cambio de stock. El observador crea o atiende una alerta y registra una tarea Outbox durable antes del commit. | [Publicador y suscripción](../backend/src/shared/transactional-publisher.ts); [publicación desde inventario](../backend/src/modules/inventario/application/inventario.facade.ts) (final de `registrarMovimientoEnTransaccion`); [observador de alertas](../backend/src/modules/alertas/application/stock-alert.observer.ts). |
| **State** | Cada estado de alerta decide sus transiciones permitidas: `PENDIENTE`, `ENVIADA` y `ATENDIDA`. Por ejemplo, una alerta atendida no vuelve a enviarse. | [Estados y transiciones](../backend/src/modules/alertas/domain/alerta.ts) (líneas 3–39); [pruebas](../backend/tests/alerts.test.ts) (líneas 17–42). |
| **Strategy** | La fachada arma una sola lectura autorizada del inventario y elige la estrategia de salida `pdf` o `xlsx`. Cambia la generación del archivo, no la regla de negocio. | [Contrato y selección](../backend/src/modules/reportes/application/inventory-report.ts) (líneas 31–34 y 56–95); [estrategias Excel y PDF](../backend/src/modules/reportes/infrastructure/report-strategies.ts) (líneas 31 y 80); [inyección de ambas](../backend/src/infrastructure/runtime-services.ts) (líneas 90–92). |
| **Adapter** | La lógica de adjuntos usa `AttachmentStore`; una implementación guarda archivos privados en el equipo y otra está preparada para Azure Blob. La fachada no depende de las API de cada proveedor. | [Contrato](../backend/src/modules/compras/application/attachment-contracts.ts) (línea 11); [adaptador local](../backend/src/infrastructure/storage/local-attachment-store.ts); [adaptador Blob](../backend/src/infrastructure/storage/blob-attachment-store.ts); [selección por configuración](../backend/src/infrastructure/runtime-services.ts) (líneas 36–44). |

## Historia única para explicarlos sin memorizar definiciones

> «Un mecánico consulta el stock y registra una salida. La cadena HTTP verifica su identidad y permisos. `InventarioFacade` coordina la operación usando contratos Repository; sus implementaciones SQL persisten stock, movimiento y auditoría en una transacción. El pool Singleton se reutiliza. Si el saldo llega al mínimo, un evento interno avisa al Observer, que crea una alerta; State controla sus transiciones. El administrador exporta ese inventario a PDF o Excel mediante Strategy. Los adjuntos de compras usan Adapter para cambiar el almacenamiento sin cambiar el caso de uso».

**Precisión importante:** `Repository` y `Adapter` son patrones/decisiones de arquitectura, pero no forman parte de la lista GoF. `Outbox` es el mecanismo de entrega durable, no un patrón GoF adicional. El correo externo y el despliegue de Blob no se presentan como terminados.

## Evidencia que puedes mostrar sin alterar la demo

- En el navegador: stock, historial por usuario y los reportes ya generados. Son consultas o visualización de archivos existentes.
- En VS Code: haz clic en cada enlace de la tabla y señala el método o clase indicados.
- En una terminal dentro de `backend`: `pnpm.cmd test` ejecuta las pruebas unitarias sin apuntar al Azure SQL recién creado. Para una explicación rápida de State y Observer, abre directamente [alerts.test.ts](../backend/tests/alerts.test.ts).
- `pnpm.cmd outbox:status` consulta el Outbox local **solo si** el `.env` sigue configurado para la base local; no reclama tareas ni envía correos. No ejecutes `worker` real durante la exposición.

## Antes de comenzar

Conserva las terminales y el `.env` de la demostración local. No ejecutes `db:migrate`, no cambies `SQL_DRIVER` ni `SQL_SERVER` y no cambies el destino a Azure hoy. Si decides registrar un movimiento en vivo, recuerda que **sí modificará el stock local**; puedes explicar los patrones con el historial existente sin hacerlo.

Para documentación más detallada del avance, abre [avance-implementacion.md](avance-implementacion.md). Para el montaje del frontend local, abre [parte-06-frontend.md](parte-06-frontend.md).
