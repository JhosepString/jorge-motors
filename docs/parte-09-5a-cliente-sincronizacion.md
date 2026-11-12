# Parte 9.5a — Cola y cliente de sincronización

**Estado:** cliente y persistencia de resultados implementados y probados localmente. La [Parte 9.5b](parte-09-5b-cupos-cloud.md) añade el endpoint y el libro de cupos; la [Parte 9.5c](parte-09-5c-carga-local-escritorio.md) conecta el cliente al ejecutable. **No está desplegado ni validado en Azure.**

`LocalSyncClient` lee únicamente operaciones pendientes del usuario actual y las envía de una en una por HTTPS con un access token vigente. Cada reintento conserva el mismo `operationId` y los mismos datos. Un corte de red, respuesta ambigua, 401, 503 o recibo inválido deja la operación pendiente; una confirmación válida guarda el ID remoto y marca movimiento/cola como confirmados en una transacción SQLite. Una respuesta explícita `REJECTED` conserva el movimiento y su motivo para revisión. No se restituye automáticamente un cupo por un rechazo: la pieza física podría haber salido del taller.

Contrato previsto para `POST /api/v1/sync/operations`: cuerpo `{ operationId, deviceId, kind, payload }`; el autor se obtiene del token, nunca del cuerpo. Respuesta 200/201 `{ data: { operationId, status: "CONFIRMED", remoteId } }`, o `{ data: { operationId, status: "REJECTED", code } }` cuando el servidor decide un rechazo permanente. La API debe guardar un recibo durable para devolver el mismo resultado ante reintentos, verificar que el mismo ID no cambie contenido, y confirmar movimiento, cupo, auditoría y recibo en **una** transacción. La descarga de cambios y su cursor están pendientes.

## Bloqueo de integridad antes de activar la API

La Parte 9.5b implementa el libro central de cupos, la protección de salidas online y la aceptación transaccional. La Parte 9.5c incorpora la carga inicial y los intentos de sincronización desde Electron. Faltan descarga incremental, devolución auditada de cupos y despliegue/verificación de la API cloud; hasta una asignación explícita el cupo inicial sigue en cero.

**Pruebas ejecutadas:** desconexión ambigua tras posible commit, reinicio y reintento con el mismo ID, confirmación persistente, recibo contradictorio y respuesta 503 que conserva el pendiente. Se probaron también las reglas locales de cupo e idempotencia. No se modificó Azure SQL.
