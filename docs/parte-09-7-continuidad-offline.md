# Parte 9.7 — Continuidad durante cortes prolongados

**Estado:** permiso local sin vencimiento temporal implementado y probado; pendiente de validación con Entra/Azure reales y en dos PCs.

El permiso emitido tras una autenticación en línea y la prueba de posesión de la clave del equipo contiene usuario, rol, tenant, equipo, fecha de emisión y la política `UNTIL_RECONNECT`. La API lo firma; Windows lo guarda cifrado con `safeStorage`. El escritorio verifica firma, emisor, audiencia, identidad y equipo. El permiso nuevo no incluye `exp`, por lo que un corte de más de 24 horas no impide abrir la aplicación y registrar movimientos dentro del cupo local. Los permisos antiguos de 24 horas requieren una nueva conexión para recibir la política nueva.

Un intento de reconexión que falla por red conserva el permiso anterior del mismo usuario y sus pendientes. Si la API responde que el perfil ya no está autorizado o que el equipo fue revocado, el escritorio borra el permiso local. La sincronización nunca descarta una operación pendiente por una respuesta de revocación; el administrador debe revisarla. Cerrar sesión borra el permiso.

**Límite inevitable:** mientras una PC esté desconectada, no puede conocer una baja en Entra ni la revocación del equipo. Un permiso sin vencimiento permite seguir capturando datos locales indefinidamente si esa PC nunca vuelve a conectarse. El cupo de salida limita las piezas que puede gastar, pero no impide entradas pendientes. Si el taller necesita detener el acceso tras un plazo máximo, habrá que definir una política de vencimiento que renuncia a la continuidad ilimitada. Al reconectar, la API vuelve a exigir token y perfil activo antes de aceptar cambios.

**Verificación:** firma alterada y equipo ajeno rechazados, permiso válido después de un año, reloj anterior a la emisión rechazado, permiso antiguo rechazado, corte de red que conserva el permiso, denegación explícita que lo borra, sincronización y descarga que detectan revocación sin perder datos locales. No se modificó Azure.
