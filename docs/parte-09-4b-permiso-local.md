# Parte 9.4b — Permiso local firmado

**Estado:** emisión, verificación y almacenamiento protegido implementados y probados con claves de prueba. La [Parte 9.5c](parte-09-5c-carga-local-escritorio.md) añade una vista local que utiliza este permiso; falta validación con Entra/Azure reales.

Después de validar el access token de Entra, el perfil activo, el rol y la firma del equipo, `POST /api/v1/auth/offline-grant` devuelve un JWT firmado por la API. Lleva identidad `tenant_id + object_id`, ID interno, nombre, rol, dispositivo y política `UNTIL_RECONNECT`. La [Parte 9.7](parte-09-7-continuidad-offline.md) retiró el vencimiento inicial de 24 horas para permitir cortes prolongados. La emisión queda auditada; no se registra el token.

La clave privada RSA reside **solo en la API**, en `OFFLINE_GRANT_PRIVATE_KEY_PEM`, como secreto de entorno. La clave pública se incluye en `desktop/auth-config.json` como `offlineGrantPublicKeyPem`. El instalador jamás lleva la privada. La API responde 503 si no hay clave; no concede acceso libre. Para rotar la clave será necesario publicar una versión que acepte la nueva clave pública y renovar los permisos; una rotación inmediata puede invalidar permisos pendientes, que deberán renovarse en línea.

El escritorio obtiene el permiso después del inicio de sesión en línea, comprueba firma RS256, emisor, audiencia, fecha de emisión, identidad y `device_id`, y lo guarda cifrado con `safeStorage` de Electron en los datos del usuario de Windows. El ID del dispositivo se genera una vez y persiste allí. Si Windows no ofrece cifrado, no se guarda un permiso local. Al cerrar sesión se elimina el permiso. El permiso no sustituye el access token para llamadas cloud.

**Límite actual:** la vista local utiliza el permiso para inventario. La revocación de un usuario o equipo mientras la PC está desconectada solo se detecta al reconectar. Quedan pendientes pruebas reales con Entra/Azure y reconciliación administrativa de operaciones rechazadas.

**Verificado:** ruta HTTP con usuario activo, dispositivo inválido, perfil deshabilitado y servicio sin clave; rechazo de firma alterada y otro dispositivo; continuidad de un permiso nuevo tras un corte prolongado; guardado/lectura/borrado protegido simulado. No se modificó Azure y no se probó el tenant desde el ejecutable.
