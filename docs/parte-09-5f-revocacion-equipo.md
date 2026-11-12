# Parte 9.5f — Revocación de equipos

**Estado:** implementada en API, SQL y vista de administración; probada con una base SQL Server efímera. El transporte del frontend local a la API desde Electron se implementó en la [Parte 9.5g](parte-09-5g-puente-api-escritorio.md); su uso con Entra/Azure reales está pendiente.

Un administrador autenticado puede abrir **Equipos**, ver instalaciones registradas, su estado y el total de cupos todavía reservados, e indicar un motivo para revocar una instalación. La API registra la revocación y su auditoría en una transacción. El rol Mecánico no puede listar ni revocar equipos. El registro de la misma instalación queda bloqueado incluso si conserva su clave privada.

La revocación bloquea en línea nuevas descargas, operaciones de sincronización, permisos offline y asignaciones de cupo. **No libera el cupo existente.** Un equipo desconectado puede haber consumido parte del cupo y conservar operaciones pendientes; devolverlo automáticamente al stock libre permitiría usar la misma pieza dos veces. El administrador debe recuperar el equipo o su copia local, revisar pendientes y reconciliar físicamente antes de liberar reservas. Ese procedimiento de liberación auditada todavía no está implementado.

La revocación no llega instantáneamente a una PC sin internet. Con la [política de continuidad](parte-09-7-continuidad-offline.md), esa PC puede seguir capturando operaciones hasta reconectarse. Al volver a conectarse, la API rechaza nuevas solicitudes de ese equipo y el escritorio borra el permiso local; los pendientes permanecen para revisión administrativa. Una instalación nueva recibe otro identificador y su propio cupo inicial es cero; no hereda el cupo retenido del equipo anterior.

**Verificación:** alta y firma válida; listado administrativo; cupo asignado; revocación; nuevo intento de descargar, registrar o asignar cupo rechazado; cupo anterior preservado; segundo intento de revocación; rol Mecánico rechazado. Sin cambios en Azure ni en datos reales.
