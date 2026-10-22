# Parte 4 — Alertas de stock y notificaciones fiables

Fecha: 21 de octubre de 2026.

**Entrega 4.1 completada:** generación, atención y persistencia de alertas y tareas pendientes en SQL local. **Entrega 4.2 implementada y probada con transporte simulado:** worker con reclamación concurrente, reintentos, recuperación y auditoría. **Correo real y ejecución programada en Azure pendientes de despliegue**. No se envían correos todavía ni se inicia un worker automáticamente con la API.

Verificación: 45 pruebas unitarias/HTTP y 27 de integración SQL aprobadas (72 total), tipos y compilación correctos. Migración 003 aplicada en la base local. **Entrega 4.1 completada y verificada manualmente**: salida del Mecánico 3 → 2 creó alerta/tarea pendientes; reposición del Administrador 2 → 4 atendió la alerta y canceló la tarea. Ambas operaciones devolvieron 201 y sus transiciones quedaron auditadas en SQL con el usuario y request ID correspondientes. Estado final: stock 4, alerta 1 `ATENDIDA`, tarea `CANCELADA`. No se envió correo.

## Reglas del negocio

- Un movimiento nuevo deja stock menor o igual al mínimo: si no existe alerta abierta, abre un ciclo `PENDIENTE` y encola una tarea. El mínimo es inclusivo; mínimo 0 y stock 0 también disparan alerta.
- Si ya existe alerta abierta, nuevas salidas o entradas insuficientes no duplican ni la alerta ni el aviso. El payload representa la primera detección, no una fotografía actualizada después de cada movimiento.
- Una reposición que deja stock estrictamente mayor al mínimo atiende la alerta y cancela la tarea todavía pendiente, para no enviar un aviso de una necesidad ya resuelta.
- Una entrada que sigue dejando un producto inicialmente bajo también puede detectar una alerta que aún no existía.
- Tras atender un ciclo, una nueva caída permite un ciclo nuevo con su propia tarea. Repetir la clave de un movimiento antiguo no publica otro evento ni reabre una alerta.
- No se permite cerrar manualmente una alerta dejando stock insuficiente en esta entrega. No hay destinatarios ni proveedores con acceso a la aplicación.

Estas reglas se ejecutan con cada movimiento nuevo confirmado por la aplicación. No se realiza backfill de stock existente, barrido periódico, cambio del mínimo ni CRUD de productos en esta entrega. Esas operaciones deberán publicar su propio evento o reconciliar alertas cuando se implementen.

## Patrones y evidencia para la exposición

| Patrón | Implementación real | Evidencia |
| --- | --- | --- |
| Observer GoF | Publicador con suscripción/baja y objetos observadores independientes; la Facade publica, el observador decide las alertas. | `src/shared/transactional-publisher.ts`, `src/infrastructure/inventory-events.ts`, `src/modules/alertas/application/stock-alert.observer.ts`. |
| State GoF | Objetos `Pendiente`, `Enviada`, `Atendida` encapsulan transiciones; el contexto `Alerta` delega el comportamiento. No se limita a un campo SQL. | `src/modules/alertas/domain/alerta.ts` y pruebas de transiciones válidas/rechazadas. |
| Transactional Outbox | Se guarda la tarea en la misma transacción de stock, movimiento, alerta y auditoría; consumidor separado con reserva y reintentos. | `src/infrastructure/database/sql-alerts.ts`, `sql-notification-dispatch.ts`, migraciones 003/004 y pruebas de rollback/recuperación. |

La composición se hace fuera de la Facade: esta conoce el contrato del publicador, no clases concretas de alertas ni servicios de correo. No se utiliza un bus global con efectos secundarios al importar módulos. Los suscriptores se esperan secuencialmente antes del commit y sus errores no se ignoran. Es Observer interno en un monolito modular, no microservicios ni mensajería distribuida.

Los estados del negocio son distintos de los de la tarea:

- **Alerta:** `PENDIENTE → ENVIADA → ATENDIDA`, o directamente `PENDIENTE → ATENDIDA` si se repone antes de enviar. `ENVIADA` significa aceptación del servicio de correo, no lectura ni reposición. En 4.2 se ejercita con una aceptación ficticia exclusivamente en una base efímera.
- **Outbox desde 4.2:** `PENDIENTE → PROCESANDO → ENVIADA`; fallo temporal devuelve a `PENDIENTE` con próxima fecha; fallo permanente o presupuesto agotado termina en `AGOTADA`. La reposición cancela tareas `PENDIENTE`, `PROCESANDO` o `AGOTADA` y borra la reserva. Una tarea `ENVIADA` conserva su aceptación aunque se atienda la alerta. La migración 004 agrega estos campos sin editar 003.

## Transacción y concurrencia

1. La UoW valida usuario e idempotencia y bloquea producto/stock.
2. Calcula y guarda stock, movimiento y auditoría del movimiento.
3. Publica `StockCambiado`; el observador usa repositorios de la **misma transacción**.
4. Crea alerta + Outbox + auditoría, o atiende + cancela pendiente + auditoría.
5. Commit conjunto. Cualquier fallo revierte todos esos cambios. Los rechazos HTTP siguen el mecanismo de auditoría separado de la Parte 3.

El índice único filtrado en `jm.alerta(producto_id)` impide más de una alerta no atendida por producto. Una restricción única liga la tarea a su ciclo. Se mantiene el orden de bloqueo producto/stock → alerta → Outbox. Las próximas operaciones y el worker deben respetarlo al finalizar tareas para evitar deadlocks.

Observer en memoria no garantiza recuperación tras reinicios. Lo que conserva el trabajo es la fila Outbox confirmada. En 4.1 se probó persistencia; 4.2 agrega pruebas de recuperación desde otra conexión y de una reserva abandonada por un proceso hijo que terminó antes del envío. No se promete entrega exactly-once: un envío externo puede duplicarse si el proceso cae antes de registrar su aceptación. Se pasa el ID estable de tarea como clave de idempotencia al adaptador; su efecto dependerá de las garantías del proveedor real.

## Aplicación local y verificación manual

La migración incremental `003_alerts_outbox` crea `jm.alerta` y `jm.notificacion_outbox`; no modifica 001/002, no cambia el stock existente ni manda correos. En `backend/`:

```powershell
pnpm.cmd db:migrate
pnpm.cmd check
pnpm.cmd test:sql
```

Con API activa y producto Demo en stock 3/mínimo 2, ejecutar **una vez**:

```powershell
pnpm.cmd auth:check salida 1 1
```

Iniciar sesión como Mecánico Demo: debe devolver 201 y stock 2. En SSMS, base local `jorge_motors_dev`:

```sql
SELECT a.id, a.producto_id, a.estado, a.stock_detectado, a.stock_minimo,
       o.estado AS estado_tarea, o.payload
FROM jm.alerta a
JOIN jm.notificacion_outbox o ON o.alerta_id = a.id
WHERE a.producto_id = 1
ORDER BY a.id;

SELECT TOP (20) fecha, request_id, accion, resultado, usuario_id,
       entidad_id, valores_anteriores, valores_nuevos
FROM jm.auditoria
WHERE accion IN ('ALERTA_CREADA', 'ALERTA_ATENDIDA')
ORDER BY id DESC;
```

La primera consulta debe mostrar alerta y tarea `PENDIENTE`. No implica que exista un correo enviado. Para atenderla en la demostración:

```powershell
pnpm.cmd auth:check entrada 1 2
```

Como Administrador Demo, stock 2 → 4: alerta `ATENDIDA` y tarea `CANCELADA`. Cada ejecución del cliente genera una clave nueva y modifica el inventario si se autoriza; no repetir los comandos sin comprobar el saldo actual. No se ejecuta automáticamente ninguna de estas operaciones sobre tu producto Demo.

## Auditoría y límites

Se agregan `ALERTA_CREADA` y `ALERTA_ATENDIDA`, con el usuario autenticado que realizó el movimiento y el mismo request ID. Las fotografías anteriores/nuevas conservan estado y stock cuando corresponde. `entidad_id` identifica alertas para esas acciones y movimientos para acciones de inventario; consultar siempre por acción para no confundir IDs de tablas diferentes.

No hay pantalla ni endpoint de alertas aún, ni servicio de correo real, destinatarios, reconciliación o promesa de entrega. El worker y sus reservas/reintentos se implementan en 4.2 a continuación. La infraestructura y el envío real serán configurados por el usuario en su etapa, sin deshabilitar protecciones de Entra.

## Entrega 4.2 — consumidor recuperable

Código principal: `src/modules/alertas/application/notification-worker.ts` (caso de uso y puerto de transporte) y `src/infrastructure/database/sql-notification-dispatch.ts` (repositorio SQL). El transporte ficticio existe solo en tests; no se incluye en el servidor ni en un comando que procese la base real.

1. **Reclamar:** transacción corta con `sp_getapplock` para serializar la selección en esta cola pequeña. No se bloquea la cola durante el envío. Se incrementa el intento y se genera un token UUID de reserva con vencimiento en dos minutos, usando el reloj SQL.
2. **Comprobar:** verificar la reserva y que la alerta siga pendiente, respetando orden alerta → Outbox. Una reserva vencida o reemplazada no puede confirmar cambios.
3. **Enviar fuera de la transacción:** validar payload versión 1 y pasar ID estable y `AbortSignal` al transporte. Timeout predeterminado de 30 segundos; se exige que el futuro adaptador respete cancelación y no tenga reintentos ocultos ilimitados. El timeout no garantiza deshacer un envío que ya aceptó el proveedor.
4. **Confirmar:** transacción atómica de tarea `ENVIADA`, fecha/ID de aceptación, transición State a `ENVIADA` y auditoría. Si falla SQL después de la aceptación externa, no se clasifica como fallo definitivo del envío: la reserva se conserva para recuperación.
5. **Reintentar:** máximo cinco reservas/intentos por tarea, incluidos procesos interrumpidos antes de enviar. Backoff exponencial base 60 segundos, jitter 0,8–1,2 y tope 3600 segundos. Se almacena la próxima fecha; el proceso no duerme hasta el reintento. Los lotes son acotados (10 por defecto, máximo 100).
6. **Recuperar:** una reserva vencida puede reclamarse con otro token; el dueño anterior no puede actualizarla. Si vence el quinto intento, la siguiente pasada la deja `AGOTADA` para evitar tareas bloqueadas indefinidamente. El barrido terminal procesa hasta 100 tareas vencidas por pasada.

Una tarea `AGOTADA` conserva la alerta pendiente y el código de fallo; no se reencola sola. La operación de revisión/reencolado manual con autorización y auditoría, la pantalla de seguimiento y las alarmas operativas están pendientes. Un próximo movimiento de reposición sí puede atenderla/cancelarla.

La comprobación previa reduce avisos obsoletos, pero no elimina la carrera entre reposición y una llamada externa ya iniciada. Si el transporte acepta después de una cancelación o de perder la reserva, el resultado es `ACEPTACION_NO_CONFIRMADA`; el caller debe reportarlo como incidente/reconciliación, no como éxito confirmado ni como garantía de ausencia de correo. No se sobrescribe la alerta atendida ni se puede retirar un correo ya aceptado.

### Auditoría del worker

Se registran `NOTIFICACION_RECLAMADA`, `NOTIFICACION_REINTENTO`, `NOTIFICACION_AGOTADA`, `NOTIFICACION_ACEPTADA` y `ALERTA_ENVIADA`. El token de cada reserva sirve de request ID de correlación; el actor humano queda nulo porque es una acción de servicio, no se suplanta al empleado que originó el movimiento. Los códigos de fallo están acotados; no se persisten mensajes de excepción, credenciales, direcciones de correo, tokens Entra ni respuestas completas del proveedor.

### Demostración segura

Desde `backend/`:

```powershell
pnpm.cmd outbox:status
pnpm.cmd worker:demo
```

- `outbox:status` solo consulta hasta 20 tareas de `jorge_motors_dev` local. No reclama ni cambia estados y no muestra tokens de reserva. La tarea original debe seguir cancelada.
- `worker:demo` ejecuta los 18 escenarios SQL del worker sobre una base `jm_test_<UUID>` nueva con datos ficticios, transporte simulado y `READ_COMMITTED_SNAPSHOT ON`. El proceso hijo abandona una reserva y termina; la prueba adelanta el vencimiento en SQL para demostrar recuperación sin esperar dos minutos. Incluye regresión de precisión temporal y 100 altas/reclamaciones inmediatas.
- Al finalizar elimina únicamente su base efímera. No lee `.env` para elegir destino, no modifica el producto Demo y no llama a Azure ni al correo. La consola identifica explícitamente que es simulación.

Regresión completa: `pnpm.cmd check` y `pnpm.cmd test:sql`. Se conservan las pruebas de inventario y auditoría. Esta verificación valida mecanismo y consistencia, no entregabilidad, reputación del remitente, cuotas ni integración con ACS Email.

Resultado actualizado del 21/10/2026: **53 pruebas unitarias/HTTP + 45 SQL = 98 aprobadas**, con tipos y compilación correctos. Simulación del worker: 18 escenarios aprobados. Migración 004 aplicada localmente, cero bases efímeras restantes y health operativo. El stock real de demostración sigue en 4 y conserva sus cuatro movimientos; su alerta permanece atendida y el aviso cancelado, con cero intentos.

### Corrección de precisión temporal

La ejecución del usuario encontró un fallo intermitente (`VACIA` en vez de `AGOTADA` en el escenario de fallo permanente). Se identificó un defecto de comparación: `disponible_en` y `lease_hasta` usan `datetime2(3)`, mientras `SYSUTCDATETIME()` devuelve precisión 7. Un valor `.1236000` se guarda como `.124`; compararlo con el reloj original puede hacer que la tarea recién creada parezca futura dentro del mismo tick. Se reprodujo la diferencia con SQL determinista y se observaron muestras redondeadas al futuro en el reloj local.

El repositorio ahora usa un fragmento fijo `CONVERT(datetime2(3),SYSUTCDATETIME())` en las comparaciones de disponibilidad/vencimiento y vigencia de reservas. No se alteran migraciones ya aplicadas ni se añaden esperas, márgenes arbitrarios o reintentos para ocultar el fallo. Las pruebas verifican el redondeo, el cambio de segundo, la exclusión de tareas realmente futuras y 100 reclamaciones inmediatas. La demo pasó tres veces consecutivas y también dentro de la regresión completa; esto corrige el defecto de precisión, no promete inmunidad a ajustes externos del reloj del servidor.

Antes de desplegar faltan: adaptador real de correo con destinatarios autorizados y plantillas seguras, configuración de identidad/permisos, comando operativo que componga el worker con ese adaptador, ejecución programada del Job, métricas/alertas/reconciliación y verificación de correo real. El núcleo del worker ya está desacoplado del transporte para esa integración.

## Referencias

- [Transactional Outbox: escritura atómica y consumidor separado](https://learn.microsoft.com/en-us/power-platform/architecture/reference-architectures/transactional-outbox-pattern). Se aplica el principio con SQL Server; no se adopta Dataverse ni Service Bus en esta entrega.
- [Índices filtrados únicos en SQL Server](https://learn.microsoft.com/sql/relational-databases/indexes/create-filtered-indexes).
- [Backoff, jitter y presupuestos finitos de reintentos](https://learn.microsoft.com/en-us/azure/architecture/best-practices/transient-faults).
