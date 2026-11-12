# Parte 9.5c — Descarga inicial y operación local desde el escritorio

**Estado:** código y pruebas locales para carga inicial, vista de inventario y captura de movimientos por cupo. **No se ha probado con Entra/Azure reales ni se distribuye todavía a empleados.**

La API ofrece `GET /api/v1/sync/bootstrap?deviceId=...&after=...&limit=100` con token y perfil activo. Devuelve el perfil, producto, categoría, stock consolidado y cupo de ese dispositivo. El cliente descarga por páginas y guarda cada página y su cursor en una transacción SQLite. Una interrupción reanuda desde la última página confirmada. Una base SQLite copiada a otro `deviceId` se rechaza. La descarga no transmite precios al rol Mecánico.

El proceso Electron incorpora el runtime SQLite dentro del paquete. Tras un inicio de sesión en línea intenta la descarga inicial; si falla, no habilita el modo local. Cuando existe un permiso firmado vigente y la carga inicial terminó, la interfaz muestra un **Modo local** con inventario y cupo disponible en ese equipo. El empleado puede registrar una salida dentro de su cupo; un Administrador también puede capturar una entrada pendiente. La operación se guarda en SQLite y se marca pendiente. La sincronización intenta ejecutarse tras iniciar sesión y cada minuto mientras haya sesión en línea; también hay un botón manual. Los errores de red conservan los pendientes.

El modo local indica que el stock total es la última cifra descargada. El cupo local sí disminuye inmediatamente con una salida. El proceso principal comprueba el permiso firmado y obtiene el usuario de ese permiso antes de cada lectura o escritura local; la página no puede enviar otro usuario ni una clave de idempotencia elegida por ella.

La [Parte 9.5d](parte-09-5d-actualizacion-local.md) añade actualización completa por páginas después de la primera carga, incluso con salidas pendientes.

**Faltan antes del release operativo:** reconciliación de eliminaciones y archivos, revisión visible de conflictos, prueba con dos PCs y Entra real, despliegue de API/migración en Azure, firma del ejecutable y prueba del instalador y desinstalador en Windows limpio. La política de continuidad offline se actualizó en la [Parte 9.7](parte-09-7-continuidad-offline.md).

**Pruebas:** endpoint HTTP y consulta SQL temporal de cupo, cliente que reanuda una descarga, rollback local ante error de datos, rechazo de base de otro equipo, compilación backend/frontend y paquete Electron. No se han cambiado recursos Azure.
