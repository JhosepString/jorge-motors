# Parte 9.8 — Preparación del despliegue cloud

**Estado al 6 de noviembre de 2026:** inventario y preflight de solo lectura completados. No se publicaron servicios, no se reactivó Azure SQL y no se aplicaron migraciones.

## Recursos comprobados

| Componente | Estado observado |
| --- | --- |
| Suscripción | Azure for Students, tenant `7f1563e9-20f9-4cd2-b943-b9bfb0c0b5c5` |
| Grupo y región | `rg-jorge-motors-dev`, Central US |
| Azure SQL | `jorge-motors-sql-demo-josen.database.windows.net`, base `jorge_motors_dev`, `GP_S_Gen5`, pausada |
| Storage | `jorgemotorstyts7qt6swfsw`, Central US; acceso público a blobs y Shared Key deshabilitados |
| Entra escritorio | Client ID `06b6e377-10f3-4742-a2b0-39289eb9d027`; redirección `http://localhost` y consentimiento `Inventario.Access` presentes |
| Entra API | Client ID `0ed26762-92c1-46d6-8623-ce827609c1c2`; scope `Inventario.Access` habilitado |
| Hospedaje API | No hay Container App ni App Service publicada en el grupo |
| Proveedores | `Microsoft.App` y `Microsoft.ContainerRegistry` todavía sin registrar |
| Release local | Existe `backend/Dockerfile`; falta `desktop/auth-config.json` con la URL y clave pública reales |

El inventario se reproduce con `./deployment/azure/preflight.ps1` desde la raíz del repositorio. El script consulta metadatos de Azure y archivos locales; no consulta tablas SQL, crea recursos ni imprime secretos.

## Despliegue propuesto

1. Mantener todos los recursos regionales en **Central US**, junto a SQL y Storage. Registrar `Microsoft.App` y `Microsoft.ContainerRegistry`.
2. Crear un Azure Container Registry Basic y un entorno de Azure Container Apps. Publicar la imagen de `backend/Dockerfile` como una Container App con ingreso HTTPS externo y escala mínima cero para el demo. La URL HTTPS asignada por Container Apps sirve de API y evita comprar un dominio. Usar identidad administrada para obtener la imagen del registro.
3. Dar a la identidad administrada de la API acceso de datos a Azure SQL mediante un usuario contenido con permisos de lectura/escritura del esquema `jm`, y `Storage Blob Data Contributor` al contenedor privado `facturas`. No entregar contraseñas SQL ni claves Storage al contenedor. Definir una regla de red comprobada para SQL; no activar el acceso general de todos los servicios de Azure por conveniencia.
4. Configurar la API con `SQL_DRIVER=entra`, servidor SQL existente, `SQL_TRUST_CERTIFICATE=false`, `ATTACHMENT_STORAGE=blob`, cuenta y contenedor Storage existentes, tenant y registro Entra de API. Guardar `OFFLINE_GRANT_PRIVATE_KEY_PEM` como secreto de Container Apps. Conservar la clave privada fuera del instalador y distribuir solo su clave pública.
5. Antes de migrar, guardar una copia recuperable de la base y revisar qué versiones `001`–`011` están aplicadas. Esta consulta reactivará la base pausada. Ejecutar las migraciones con una identidad administradora separada del runtime; comprobar el resultado antes de abrir el ingreso a usuarios.
6. Verificar token real de un usuario Entra, perfil activo en `jm.usuario`, lectura/escritura autorizadas, cupos, firma del permiso offline, revocación de equipo y un ciclo de sincronización entre dos PCs. `/api/v1/health` solo prueba el proceso HTTP.
7. Crear `desktop/auth-config.json` con los IDs anteriores, `apiBaseUrl=https://<FQDN-asignado>/api/v1` y la clave pública de la firma. Compilar el instalador, instalarlo en Windows limpio y probar primer inicio en línea, corte, reconexión, actualización y desinstalación con datos pendientes.

## Costos y decisiones antes de ejecutar

La suscripción Student tiene crédito limitado. Container Registry Basic, el entorno de Container Apps y su registro de logs pueden generar cargos; la API con escala mínima cero reduce cómputo ocioso, pero el registro no se apaga con ella. Azure SQL serverless deja de estar pausada al conectarse y vuelve a facturar cómputo mientras está activa, además del almacenamiento. Storage y sus operaciones también tienen costo. Conviene revisar crédito disponible y presupuesto en Azure antes de crear recursos y establecer alertas de gasto. Esta preparación no presupone costo cero.

El enfoque de Container Apps necesita una ruta de red verificable hasta Azure SQL y Storage. Si la restricción de red exigiera VNet, Private Endpoint o NAT, habría que calcular esos cargos antes de agregarla. La primera validación debe usar datos de demostración y una ventana corta; tras probar, decidir qué recursos mantener. La escala a cero puede causar arranque en frío: la aplicación de escritorio debe tratarlo como desconexión temporal, conservar pendientes y reintentar.

La primera autenticación, la provisión del perfil en SQL y la descarga inicial **sí requieren internet**. Una instalación en una máquina nueva no puede autoautenticar a un usuario de Entra que nunca inició sesión allí. El modo offline funciona después de recibir un permiso firmado y datos/cupos locales; no resuelve revocaciones ocurridas mientras la PC sigue desconectada.

Referencias: [ingreso y FQDN de Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview), [identidades administradas de Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity), [extracción de imágenes con identidad administrada](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull), [autenticación Entra de Azure SQL](https://learn.microsoft.com/en-us/azure/azure-sql/database/authentication-aad-configure?view=azuresql), [facturación de Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/billing).
