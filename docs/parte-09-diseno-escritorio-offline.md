# Parte 9.1 — Diseño de la aplicación instalable y operación sin conexión

**Estado:** propuesta técnica para la Parte 1; funciones descritas aquí aún no están implementadas. **Plataforma inicial:** Windows 10/11 de 64 bits. Un instalador para otro sistema operativo requerirá otro paquete y pruebas.

## Objetivo y experiencia

El empleado ejecuta `JorgeMotors-Setup.exe` sin usar terminal. El instalador deja los archivos, la base local, los accesos directos y la entrada de desinstalación de Windows. Al abrir el acceso directo aparece la interfaz local. En el primer uso, con internet, inicia sesión con Microsoft Entra ID y se descargan los datos autorizados. En usos posteriores la aplicación abre aunque no haya internet, dentro de la vigencia de su autorización local. Cuando vuelve la conexión, sincroniza automáticamente y muestra el estado de cada operación. La ISO no forma parte del entregable: solo contendría el instalador y añadiría el paso de montarla.

El instalador no incluye secretos de Azure ni credenciales SQL. La autenticación inicial, MFA y descarga inicial requieren internet. Entra ID no autentica por primera vez a un usuario desconectado. El acceso directo no evita el inicio de sesión requerido por Microsoft.

## Topología objetivo

```text
PC Windows: Electron (React + lógica local) → SQLite privada + cola de operaciones
             │ HTTPS al recuperar internet
             ▼
API de sincronización → Azure SQL (dato consolidado) + Blob (adjuntos)
             ▲
          Entra ID (inicio de sesión en línea)
```

La API cloud ofrece una URL HTTPS administrada por Azure; no se necesita comprar un dominio propio. Cada PC habla con esa API, no con Azure SQL ni Blob directamente. El backend actual `node-mssql` y su API REST proporcionan reglas reutilizables, pero requieren adaptadores SQLite y endpoints de sincronización nuevos. La [demo híbrida actual](demo-hibrida-dos-pc.md) usa Azure CLI, firewall por IP y dos servidores de desarrollo: **no cumple** este diseño ni se debe empaquetar tal cual. El Outbox actual registra avisos a proveedores; no es todavía una cola de sincronización entre PC y nube.

## Datos por equipo

La base local guarda productos, categorías, proveedores y existencias necesarias para el trabajo; el perfil y rol autorizados; movimientos del equipo; facturas y metadatos de adjuntos; cola de cambios; cursor de descarga; y estado de sincronización. Los archivos pendientes se conservan en una carpeta privada de la aplicación. Se cifra la base o, como mínimo, los datos sensibles y la credencial local mediante mecanismos protegidos por Windows. Nunca se guardan contraseñas de Entra ni tokens en texto plano. Cada instalación tiene un `device_id` estable, independiente del usuario y de la IP de la red.

Azure SQL conserva el registro consolidado. No se copian archivos de base de datos de una PC a otra. Las operaciones confirmadas en la nube se descargan usando un cursor; los IDs locales y remotos se relacionan sin depender de que los autoincrementos coincidan. Los documentos se suben por separado y quedan pendientes hasta su confirmación.

## Identidad y autorización sin internet

- Primer acceso: navegador del sistema, Entra ID, MFA si corresponde, token para la API, perfil activo y rol coincidente. El usuario se identifica por `tenant_id + object_id`, nunca por correo.
- La aplicación emite y guarda una autorización local **vinculada al usuario y dispositivo**, firmada por la API tras una validación en línea. La política implementada en la [Parte 9.7](parte-09-7-continuidad-offline.md) no caduca por tiempo y permite continuar durante cortes prolongados. La sesión de Windows de otro empleado no hereda la autorización.
- Si no hay conexión y la firma, identidad y equipo del permiso son válidos, se abre el trabajo local con el rol y permisos ya comprobados. Una autorización alterada se rechaza.
- Al reconectar, la API verifica nuevamente que el usuario siga activo y tenga el rol correspondiente antes de aceptar pendientes. Una baja o cambio de rol hecho en Entra durante la desconexión no se conoce de inmediato en la PC: los cambios pendientes pueden quedar rechazados y requieren revisión. El registro local conserva autor y momento de captura.
- La API existente valida access tokens para sus endpoints en línea. La autorización local es una capacidad **nueva**, no una reutilización indefinida de un JWT expirado.

## Inventario y conflictos

El stock no puede quedar negativo y el historial de movimientos es inmutable; una corrección crea un movimiento compensatorio. Un simple valor de stock en caché no permite prometer esta regla si dos equipos trabajan aislados.

**Regla elegida para salidas desconectadas:** la API asigna a cada dispositivo un cupo de salida por producto, tomado del stock libre consolidado. La suma de cupos vigentes y stock libre representa el stock total; asignar un cupo no es una salida ni crea una venta. Cada salida local descuenta de su cupo en una transacción SQLite junto con el movimiento y la cola. Si no hay cupo suficiente, la aplicación bloquea esa salida hasta conectarse o hasta que un administrador reorganice cupos en línea. Así, dos equipos aislados no pueden gastar el mismo último repuesto. El cupo se muestra al empleado como disponibilidad de **este equipo**, no como stock total actualizado.

Las entradas desconectadas quedan registradas como **pendientes de confirmación** y no aumentan el cupo utilizable hasta que la API las acepte. Los cambios de catálogo, proveedores, precios, facturas y adjuntos pueden capturarse localmente solo donde sus dependencias estén disponibles; la API decide su confirmación y puede devolver conflicto. En la primera versión, acciones administrativas que requieran unicidad global o una referencia cloud inexistente se limitarán a conexión en línea. Los reportes desconectados deben indicar la hora de la última sincronización y que no representan el consolidado actual.

Un cupo no se libera automáticamente al pasar el tiempo: un equipo desconectado podría seguir consumiéndolo. La devolución o reasignación se hace con protocolo de confirmación; ante pérdida definitiva del equipo, un administrador recupera el cupo mediante un procedimiento auditado que reconcilie sus últimos movimientos. Esto evita duplicar disponibilidad por una expiración silenciosa.

## Protocolo de sincronización

1. Cada escritura local crea un `operation_id` UUID, `device_id`, `tenant_id`, `object_id`, tipo, carga, versión conocida y fecha local. Se guarda junto al cambio local en la misma transacción.
2. El sincronizador envía lotes en orden de dependencia mediante HTTPS. La API valida identidad, perfil, rol, formato, cupo y reglas de negocio. Una operación repetida con el mismo ID y contenido devuelve el resultado anterior; el mismo ID con contenido distinto se rechaza.
3. La API confirma la operación y su auditoría en una transacción. Responde con ID remoto, versión y estado. El cliente marca como confirmada solo después de guardar esa respuesta; un corte tras el commit se resuelve reintentando el mismo `operation_id`.
4. El cliente descarga cambios posteriores a su cursor y aplica los datos confirmados. El cursor avanza en la misma transacción local que aplica el lote. Borrados y desactivaciones se representan explícitamente.
5. Conflictos o rechazos quedan visibles con motivo y opción de corregir o compensar; nunca se descartan en silencio. La UI distingue `Guardado en este equipo`, `Pendiente de sincronizar`, `Confirmado` y `Requiere atención`.

La sincronización debe tolerar reinicio, cortes a mitad de lote, duplicados, desorden y cambios de IP. La disponibilidad de la API no se infiere del endpoint `/health` actual: se comprueba una operación autenticada de sincronización. Se aplican límites de lote y reintentos con espera progresiva.

## Instalación, actualización y desinstalación

El instalador contiene el runtime necesario y crea la base local mediante migraciones al primer arranque. Los datos viven fuera de la carpeta del programa para sobrevivir a actualizaciones. La aplicación inicia y detiene su proceso local al abrirse y cerrarse; la sincronización automática corre mientras esté abierta. Si se necesita sincronizar con la ventana cerrada, se planificará un servicio de Windows aparte.

El desinstalador registrado en Windows ofrece conservar datos para reinstalar o **eliminar completamente los datos de este equipo**. Antes de esta última opción muestra la cantidad de operaciones y adjuntos no confirmados, y ofrece sincronizar o exportar una copia. La confirmación de borrado irreversible es explícita. Desinstalar una PC no borra Azure SQL, Blob ni los usuarios de Entra.

## Criterios para aceptar la implementación

1. Instalación en Windows limpio, apertura por acceso directo y primera autenticación sin terminal, Node, pnpm, Azure CLI, SQL Server ni configuración manual de firewall.
2. Primera sesión y carga inicial en línea; un usuario nuevo o sin permiso local firmado no entra sin internet.
3. Dos PCs desconectadas no consumen el mismo cupo. Salida sin cupo se bloquea y no altera stock. Una entrada pendiente no habilita nuevas salidas.
4. Corte antes y después de confirmar un envío, reintento y reinicio no duplican movimientos ni adjuntos. Los pendientes sobreviven a reinicios y actualizaciones.
5. Un usuario desactivado o con rol cambiado no puede sincronizar nuevos cambios; los pendientes rechazados se muestran sin perderse.
6. Desinstalación normal conserva datos; eliminación completa borra datos locales tras advertir sobre pendientes. Ambas quitan programa y accesos directos.

**Pendiente para implementación:** decidir el tamaño de cupo inicial por producto y dispositivo con el administrador del taller, según operación real. El valor por defecto será cero hasta que se asigne explícitamente; esto mantiene la regla de stock al instalar una PC nueva.
