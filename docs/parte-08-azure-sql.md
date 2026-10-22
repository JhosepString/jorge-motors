# Parte 8.1 — Conexión de la API con Azure SQL

**Adaptador implementado y probado por configuración; conexión cloud pendiente.** No se creó Azure SQL, no se activó identidad administrada ni se asignaron permisos. El responsable aplicará estos pasos en Azure cuando cierre primero la demostración local de la SPA.

## Qué cambia en el código

`SQL_DRIVER=entra` selecciona Tedious con `azure-active-directory-default`. En Container Apps, la identidad administrada obtiene y renueva el token; el proceso no guarda contraseña SQL. `SQL_SERVER` debe ser el FQDN `*.database.windows.net`, `SQL_TRUST_CERTIFICATE=false`, puerto 1433 y TLS activado. Se rechazan `SQL_USER` y `SQL_PASSWORD` si se elige Entra. `SQL_ENTRA_CLIENT_ID` solo se usa para una identidad asignada por el usuario; se omite para una identidad asignada por el sistema. El adaptador Windows local sigue intacto.

La identidad de la aplicación **no es** la identidad del Administrador o Mecánico que inicia sesión. Entra autentica al servicio ante la base, mientras el JWT de cada persona continúa autorizando las rutas. Un rol Azure RBAC sobre el recurso SQL no sustituye al usuario contenido dentro de la base.

## Configuración manual en Azure Central US

1. Crear Azure SQL Database y un servidor lógico en Central US; registrar nombres y política de red elegida. Confirmar disponibilidad y costo en la suscripción Student antes de crear recursos. Configurar un administrador Microsoft Entra del servidor.
2. Aplicar las migraciones `001` a `008` con una identidad de administración autorizada para DDL. Conservar esta identidad fuera del runtime. **No ejecutar migraciones al arrancar la API.**
3. Activar identidad administrada en la Container App. Para empezar, la asignada por el sistema evita administrar otro recurso de identidad. Anotar el nombre exacto del principal. Si se prefiere identidad asignada por el usuario, registrar además su Client ID en `SQL_ENTRA_CLIENT_ID`.
4. Conectado a **la base de la aplicación** como administrador Entra, crear un usuario contenido para ese principal. Sustituir `[NOMBRE_EXACTO_IDENTIDAD]` por el nombre real, revisar el SQL y ejecutarlo manualmente:

```sql
CREATE USER [NOMBRE_EXACTO_IDENTIDAD] FROM EXTERNAL PROVIDER;
GRANT SELECT, INSERT, UPDATE ON SCHEMA::jm TO [NOMBRE_EXACTO_IDENTIDAD];
GRANT DELETE ON OBJECT::jm.factura_compra_linea TO [NOMBRE_EXACTO_IDENTIDAD];
```

La API lee y escribe en `jm`; al editar un borrador elimina únicamente sus líneas. No conceder `db_owner` ni `db_ddladmin` al runtime. Los permisos del worker de Outbox están comprendidos en `SELECT`, `INSERT` y `UPDATE`. Si se separan las identidades del worker y de la API, repetir el análisis de permisos para cada una y reducir los grants por objeto.

5. En la configuración de la Container App establecer `SQL_DRIVER=entra`, `SQL_SERVER=<servidor>.database.windows.net`, `SQL_DATABASE=<base>`, `SQL_TRUST_CERTIFICATE=false` y, solo para identidad asignada por el usuario, `SQL_ENTRA_CLIENT_ID=<UUID>`. No agregar `SQL_USER` ni `SQL_PASSWORD`. Confirmar conectividad de red al puerto 1433 mediante la política de red elegida; evitar habilitar el acceso amplio de todos los servicios Azure solo por comodidad.
6. Verificar desde la aplicación una operación autenticada de lectura y una escritura controlada, además de una prueba de rol denegado. `/health` comprueba únicamente HTTP y no demuestra acceso a SQL. Revisar auditoría y datos en Azure SQL para confirmar la operación. No copiar la base local de demostración sin decidir qué datos deben migrarse.

## Evidencia disponible y pendientes

Las pruebas unitarias cubren configuración Entra con identidad del sistema y asignada por el usuario, TLS, ausencia de contraseña y rechazo de opciones inseguras. Las pruebas SQL locales siguen utilizando Windows Integrated Authentication. **No existe todavía una prueba contra Azure SQL** ni una imagen Docker ejecutada con esa identidad.

Azure SQL puede añadir costos por cómputo, almacenamiento y red. La región, SKU, presupuesto y reglas de red los elegirá el responsable en el portal antes de desplegar. Para producción faltan igualmente Blob privado/análisis de adjuntos, correo real, observabilidad y respaldo/restauración probados.

Referencias: [Microsoft Learn: Node.js y conexiones sin contraseña](https://learn.microsoft.com/en-us/azure/azure-sql/database/azure-sql-passwordless-migration-nodejs), [identidades administradas en Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity), [usuarios Entra contenidos en Azure SQL](https://learn.microsoft.com/en-us/azure/azure-sql/database/authentication-microsoft-entra-connect-to-azure-sql).
