# Parte 9.5d — Actualización del catálogo y cupos locales

**Estado:** actualización por páginas implementada y probada localmente; no validada todavía con Azure/Entra reales.

Después de la carga inicial, el escritorio puede volver a consultar `GET /api/v1/sync/bootstrap` para actualizar perfil, productos, categorías, stock y cupos. Usa un cursor de actualización separado del cursor inicial. Si se interrumpe una página, la siguiente ejecución reanuda desde la última aplicada. Cada página y su cursor se confirman en una transacción SQLite.

El cupo de la API representa lo que el servidor aún reserva para ese dispositivo. Durante la actualización se descuentan las salidas locales `PENDING` y `REJECTED`, porque ya consumieron cupo en ese equipo. Las salidas `CONFIRMED` no se descuentan otra vez: la nube ya las incorporó. Si la cuota cloud es menor que las salidas sin resolver, la página se rechaza sin modificar datos ni cursor. Un conflicto así necesita revisión; la aplicación no restaura ni borra movimientos físicos automáticamente.

El escritorio ejecuta envío de pendientes y después actualización al iniciar sesión y cada minuto mientras exista sesión en línea. El botón **Sincronizar ahora** hace el mismo ciclo. No hay peticiones cloud cuando solo existe permiso offline. La vista local muestra el stock descargado y el cupo actual de ese equipo.

Esta solución vuelve a leer el catálogo completo por páginas. Es adecuada para la escala inicial del taller, pero no es un feed de cambios con versión estable: una modificación simultánea entre páginas puede requerir la siguiente actualización para quedar reflejada. Todavía faltan reconciliación de eliminaciones, facturas/adjuntos y una pantalla de conflictos. La acreditación criptográfica del dispositivo continúa en la [Parte 9.5e](parte-09-5e-identidad-equipo.md).

**Verificación:** aumento de cupo con salida pendiente, confirmación que no descuenta dos veces, cupo cloud insuficiente que revierte la página, reanudación tras corte, pruebas backend y empaquetado Electron. No se modificó Azure.
