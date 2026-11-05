# Demo híbrida en dos PCs — estado 5 de noviembre de 2026

La API y el frontend corren en cada PC. Ambas APIs usan la misma Azure SQL Database
`jorge_motors_dev` del servidor `jorge-motors-sql-demo-josen.database.windows.net`
en Central US. Microsoft Entra gestiona el inicio de sesión y MFA.

## Ya preparado en la PC principal y Azure

- Las migraciones 001–008 están aplicadas en Azure SQL.
- Se copiaron desde SQL Server local 2 usuarios Demo, 2 categorías, 1 producto,
  1 stock, 4 movimientos, 1 alerta, 1 tarea Outbox y 235 registros de auditoría.
  Los IDs originales se conservaron; las columnas `rowversion` se regeneraron.
- Los usuarios Entra `admin.demo@joseneyraquiroz08gmail.onmicrosoft.com` y
  `mecanico.demo@joseneyraquiroz08gmail.onmicrosoft.com` tienen usuarios contenidos
  en Azure SQL con SELECT/INSERT/UPDATE sobre `jm` y DELETE únicamente sobre
  `jm.factura_compra_linea`. La API sigue imponiendo permisos por rol.
- `backend/.env` de la PC principal usa `SQL_DRIVER=entra`, DNS Azure SQL y TLS.
  La conexión mediante credencial Azure CLI funcionó; la API responde health.
- El firewall permite las IP del rango de salida observado para la PC principal:
  `38.187.19.210`–`38.187.19.213`. Si cambia la red, ajustar la regla a la IP
  nueva. Hay reglas antiguas que conviene revisar al cerrar la prueba.

## Cuando esté disponible la segunda PC

1. Copiar el repositorio y configurar Node 24, pnpm 11.25.0 y Azure CLI.
   En `backend/` y `frontend/`: `pnpm.cmd install --frozen-lockfile`.
2. Iniciar sesión en Azure CLI con **la misma identidad Demo que usará esa PC**:
   `az login --tenant 7f1563e9-20f9-4cd2-b943-b9bfb0c0b5c5 --allow-no-subscriptions`.
   Completar el MFA personalmente; no compartir códigos ni tokens. La identidad
   ya tiene acceso contenido a la base y no necesita permisos de suscripción.
3. En `backend/.env`, conservar los IDs Entra de la configuración principal y
   establecer `SQL_DRIVER=entra`, `SQL_SERVER=jorge-motors-sql-demo-josen.database.windows.net`,
   `SQL_DATABASE=jorge_motors_dev`, `SQL_TRUST_CERTIFICATE=false`,
   `FRONTEND_ORIGIN=http://localhost:5173`. No poner contraseña SQL.
4. En `frontend/.env.local`, conservar el tenant, API client ID y SPA client ID
   vigentes; usar `VITE_API_BASE_URL=http://127.0.0.1:3000/api/v1` y
   `VITE_REDIRECT_URI=http://localhost:5173/redirect.html`.
5. Obtener la IP pública de salida de la segunda PC y añadir una regla de
   firewall Azure SQL para esa IP exacta. La IP que informa el error SQL es la
   relevante si la red usa varias salidas. No abrir `0.0.0.0`–`255.255.255.255`.
6. Ejecutar `pnpm.cmd dev` en `backend/` y `frontend/` en terminales separadas.
   Abrir `http://localhost:5173`, iniciar sesión y completar MFA.
7. En ambas PCs comprobar inventario y el mismo stock. Hacer una entrada/salida
   de prueba controlada desde una PC y refrescar la otra; comprobar historial,
   auditoría y restricción del rol Mecánico. Esta operación altera la base cloud.

La base es serverless con pausa automática; la primera conexión tras una pausa
puede tardar. El endpoint `/health` solo verifica HTTP, no SQL ni MFA.

El script `backend/scripts/copy-local-demo-to-azure.mjs` se ejecutó una vez.
Rechaza destinos que ya contengan datos y no debe usarse de nuevo sobre esta base.
