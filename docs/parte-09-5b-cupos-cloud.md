# Parte 9.5b — Cupos centrales y aceptación de movimientos

**Estado al 7 de noviembre de 2026:** esquema y API aplicados a Azure SQL. El formulario de asignación de cupos desde **Equipos** está incluido en el instalador actualizado. Se probó una salida offline de una unidad con cupo reservado; se confirmó al reconectar, con stock y cupo verificados directamente en Azure SQL.

La migración `009_offline_quotas.sql` crea `jm.cupo_dispositivo`, recibos de sincronización y recibos de asignación. Los triggers impiden que el stock quede por debajo de la suma de cupos o que la suma de cupos supere el stock. La ruta normal de salidas también comprueba el stock libre, de modo que las unidades reservadas para equipos desconectados no pueden gastarse en línea.

`POST /api/v1/sync/quotas` requiere Administrador y `{ allocationId, deviceId, productId, quantity }`. Solo agrega un cupo si hay stock libre; repetir el mismo `allocationId` devuelve el resultado anterior sin duplicar la reserva. La pantalla **Equipos** permite elegir equipo, buscar producto y asignar unidades. Si falla la red, conserva el `allocationId` para reintentar la misma solicitud. La descarga del equipo entrega el cupo; aún faltan devolución y reasignación auditadas.

`POST /api/v1/sync/operations` requiere token Entra y perfil activo. Valida una operación `INVENTORY_MOVEMENT`, consulta un recibo previo por `operationId` y rechaza el mismo ID con otro contenido. Para una salida, bloquea producto y stock, consume el cupo del equipo, registra el movimiento con la regla actual de inventario, auditoría y alertas, y guarda el recibo **en una transacción SQL**. Si falla cualquier paso, se revierten todos. Una entrada desconectada solo se admite para Administrador. El autor lo determina el token verificado, nunca un `userId` enviado por el cliente.

El servidor devuelve `CONFIRMED` con el ID remoto. Los errores de validación, falta de cupo o cambio de permisos se devuelven como HTTP 4xx y el cliente local conserva el pendiente; aún falta un flujo de revisión de conflictos y respuestas `REJECTED` definitivas. Los reintentos después de un commit devuelven el recibo guardado.

**Pruebas:** migración repetible, asignación idempotente, reserva mayor que el stock rechazada por API y trigger, salida en línea bloqueada si consume reserva, aceptación offline, replay sin duplicados, contenido cambiado rechazado, y conservación de alertas/auditoría. La prueba crea y elimina una base temporal en SQL Server local. Las rutas HTTP también comprueban token, rol y formato.

**Antes de uso real:** probar el ciclo en dos equipos, cerrar el flujo de revisión de conflictos y la devolución/reasignación de cupos. El registro de dispositivo con prueba de posesión, la actualización local, la migración cloud, el instalador y una salida offline real en este equipo ya están implementados y comprobados.
