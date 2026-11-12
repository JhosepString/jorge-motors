# Parte 9.2 — Base local de inventario

**Estado:** núcleo de persistencia local implementado y probado; integración con la interfaz, autorización local y API de sincronización pendientes.

`backend/src/infrastructure/local/local-inventory.ts` abre una base SQLite desde una ruta de datos del usuario, activa claves foráneas y WAL, y aplica una migración con checksum. Node 24 incluye `node:sqlite`; no requiere instalar un servidor SQL en la PC. El instalador de la siguiente parte deberá proporcionar la ruta estable y el ID del dispositivo.

La primera migración crea cachés de usuario, categoría y producto; cupo de salida por producto; movimientos locales inmutables; cola de sincronización; estado de cursor; y auditoría local. No reutiliza el esquema SQLite del Avance 2, que describe otra versión del sistema.

`registerMovement` valida actor, rol y producto. La salida consume únicamente el cupo asignado a ese equipo. La entrada queda pendiente y no aumenta ese cupo. Movimiento, descuento, auditoría y operación pendiente se confirman o revierten juntos. El mismo usuario y clave de idempotencia devuelven el movimiento previo; reutilizar la clave con otro contenido se rechaza. La caché impide sobrescribir el cupo si hay salidas pendientes del producto.

La carga de caché (`cacheUser`, `cacheCategory`, `cacheProduct`) se usa en la descarga autenticada de la Parte 9.5c. No constituye autorización por sí sola: el proceso de escritorio comprueba el permiso firmado antes de permitir escrituras. Todavía no se cifra el archivo SQLite. La base debe considerarse **solo apta para desarrollo** hasta completar protección de datos, registro seguro del dispositivo y pruebas reales. La Parte 9.5a actualiza los estados `CONFIRMED` y `REJECTED`.

**Verificación ejecutada:** `pnpm run typecheck` y `pnpm exec tsx --test tests/local-inventory.test.ts`. La prueba usa un archivo SQLite real y comprueba migración/reapertura, cupo, idempotencia, persistencia de pendientes, rollback e inmutabilidad. No altera la base SQL local ni Azure SQL.

**Siguiente entrega:** proceso de escritorio que arranque el frontend y conecte sus casos de uso al almacén local; después, autenticación local y sincronización con API cloud. La integración debe preservar los contratos REST y las reglas ya existentes del backend, sin activar escrituras offline desde la interfaz antes de tener control de acceso.
