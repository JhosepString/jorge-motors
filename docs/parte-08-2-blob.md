# Parte 8.2 — Adjuntos privados en Azure Blob

**Adapter preparado; conexión real pendiente.** El código implementa el puerto `AttachmentStore` con Azure Blob Storage, pero no se creó ningún recurso ni se ejecutó una operación contra Azure. El despliegue y la comprobación en el portal quedan a cargo del equipo.

## Patrón aplicado

`AdjuntosFacade` depende de `AttachmentStore`, no del SDK de Azure. `LocalAttachmentStore` y `BlobAttachmentStore` son dos **Adapter** del mismo contrato. Cambiar el almacén no cambia la autorización, los metadatos SQL ni las rutas HTTP. No se añade un patrón distinto para cada proveedor.

El objeto se llama `<UUID>.bin`, no usa el nombre aportado por el usuario. La API vuelve a comprobar la sesión y el rol Administrador antes de entregar bytes; no hay URL pública ni SAS. El Adapter usa `ManagedIdentityCredential` y TLS, sin clave ni cadena de conexión. Las cargas usan `If-None-Match: *` para no sobrescribir; un reintento con el mismo UUID solo se acepta si los bytes son idénticos. Las lecturas verifican tamaño y ETag; el caso de uso verifica además SHA-256. El SDK aplica dos intentos y cada operación tiene un límite de 12 segundos.

## Configuración manual en Central US

1. Comprueba primero el presupuesto, la suscripción y el costo esperado de Storage, transacciones y tráfico. El Bicep de `infra/foundation.bicep` **define** una cuenta StorageV2 `Standard_LRS` y el contenedor privado `facturas`; no lo ejecutes sin revisar `what-if`. Si ya existe una cuenta válida, reutilízala y no crees otra por duplicado. Anota el nombre exacto de la cuenta.
2. Confirma en el portal: región Central US, `facturas` privado, acceso público a blobs deshabilitado, Shared Key deshabilitada, HTTPS/TLS y política de red compatible con Container Apps. La plantilla inicial permite acceso de red público, pero **no** acceso anónimo; antes de producción se debe definir una política de red más restrictiva y probar la conectividad. No habilites claves compartidas por conveniencia.
3. Activa la identidad administrada de la Container App que ejecutará la API. Para identidad asignada por el sistema no se necesita Client ID. Si es asignada por el usuario, registra su Client ID.
4. En el contenedor `facturas`, abre **Control de acceso (IAM) → Agregar asignación de rol**. Asigna a esa identidad `Storage Blob Data Contributor` con ámbito del contenedor (o el menor ámbito disponible en la interfaz). Ese rol de datos permite cargar, leer y eliminar los objetos pendientes. Un rol de administración sobre la cuenta Storage no sustituye necesariamente al rol de datos. Espera la propagación de RBAC antes de probar.
5. Configura en la Container App, sin secretos: `ATTACHMENT_STORAGE=blob`, `BLOB_ACCOUNT_NAME=<nombre real>`, `BLOB_CONTAINER_NAME=facturas` y, solo para identidad asignada por el usuario, `BLOB_MANAGED_IDENTITY_CLIENT_ID=<UUID>`. Mantén `NODE_ENV=production`. No copies el `.env` local ni configures `ATTACHMENT_LOCAL_ROOT` como almacén productivo.
6. Cuando Azure SQL, Entra y la API ya funcionen, crea una factura **de prueba sin datos reales** y sube un PDF/PNG/JPEG ficticio con un Administrador. Comprueba 201, listado y descarga autorizada; verifica en el portal un blob `<UUID>.bin` privado. Prueba acceso con Mecánico (403) y una clave de reintento estable para evitar duplicados. Revisa auditoría y costos. `/health` no valida Blob, SQL ni permisos.

## Límites antes de presentarlo como producción

- No hay antivirus ni análisis profundo de contenido. La firma/MIME y el hash no garantizan que un documento sea seguro.
- La limpieza automática de reservas pendientes solo está implementada para el disco **local**. No ejecutes `attachment:cleanup --apply` pensando que limpiará Blob. Un fallo entre carga y confirmación SQL puede dejar un objeto pendiente hasta desarrollar un limpiador cloud con revalidación y auditoría.
- La operación de almacenamiento remoto ocurre dentro de una transacción SQL. Los límites de tiempo acotan la espera, pero no reemplazan un flujo de reserva/finalización con recuperación y fencing para carga real.
- No se han probado Managed Identity, RBAC, conectividad, latencia, costos ni recuperaciones con Azure real. No se deben cargar facturas de negocio todavía.

Referencias: [identidades administradas en Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity), [rol Storage Blob Data Contributor](https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles/storage), [condiciones de escritura de Blob](https://learn.microsoft.com/en-us/rest/api/storageservices/specifying-conditional-headers-for-blob-service-operations).
