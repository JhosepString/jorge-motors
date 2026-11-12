# Parte 9.4 — Identidad de escritorio

**Estado:** flujo de inicio de sesión en línea implementado y probado con simulaciones de MSAL/API. Las Partes 9.4b y 9.5c añaden permiso firmado y vista local. Falta validación contra el tenant real; la aplicación todavía no está lista para empleados.

Microsoft indica que Electron debe usar MSAL Node y no MSAL Browser. `desktop/auth.mjs` usa `PublicClientApplication.acquireTokenInteractive` con PKCE, navegador del sistema y retorno `http://localhost` con puerto elegido por MSAL. El proceso principal conserva el token; el frontend lo solicita por un puente Electron limitado. No se expone Node ni una API IPC genérica a la página.

Un inicio de sesión solo se acepta después de llamar a `/api/v1/auth/me` con el **access token de la API** y recibir un perfil habilitado con rol `ADMINISTRADOR` o `MECANICO`. El backend actual sigue comprobando firma, tenant, audiencia, cliente permitido, scope, rol y perfil activo. El ID token no se usa para autorizar operaciones. Cerrar sesión elimina la cuenta de la caché MSAL del proceso. El token silencioso se renueva solo si MSAL puede hacerlo; un fallo exige otro inicio de sesión interactivo.

La configuración pública está separada en `desktop/auth-config.json` (ejemplo: `desktop/auth-config.example.json`). Contiene tenant ID, ID del cliente de escritorio, ID de la API y URL HTTPS de la API. No contiene secretos. Si falta o es inválida, la aplicación falla cerrada para autenticación; no activa una sesión ficticia. Debe incorporarse al paquete **antes de distribuirlo**.

## Configuración Entra necesaria

1. Registrar un cliente público de tipo **Aplicaciones móviles y de escritorio** en el mismo tenant, con URI de retorno `http://localhost`. Puede ser el registro existente si se añade esta plataforma correctamente; una app separada facilita distinguir SPA y escritorio.
2. Dar al cliente el scope delegado `api://<API_CLIENT_ID>/Inventario.Access` y el consentimiento correspondiente.
3. Incluir el ID del cliente de escritorio en `ENTRA_ALLOWED_CLIENT_IDS` de la API. Los roles `Administrador` y `Mecanico` siguen asignados en la aplicación empresarial de la **API**, y el perfil SQL debe coincidir. No habilitar Device Code, concesión implícita ni secretos de cliente para este flujo.
4. Publicar la API en una URL HTTPS fija; la aplicación instalada no puede depender del backend de desarrollo en `localhost:3000`. La URL predeterminada de Azure evita comprar un dominio.

Estas tareas son de preparación del sistema por el desarrollador/administrador; el empleado solo instalará y abrirá la aplicación. No se ha cambiado el tenant ni creado registros Entra durante esta entrega.

## Límite actual sin conexión

La [Parte 9.4b](parte-09-4b-permiso-local.md) incorporó emisión, verificación y guardado de un permiso firmado. La [Parte 9.7](parte-09-7-continuidad-offline.md) actualiza la política para cortes prolongados. El cliente no utiliza un JWT de Entra expirado ni un perfil en SQLite como permiso independiente.

## Verificación

Las pruebas de `desktop/tests/auth.test.mjs` cubren rechazo de configuración insegura, API que deniega el acceso, aceptación del perfil validado, renovación simulada y cierre de sesión. `frontend` compila con el puente de escritorio y conserva el flujo SPA para la demo web. La prueba del servidor estático sigue pasando. No se ha realizado aún MFA real desde el ejecutable.

Referencias: [tutorial oficial Electron + MSAL Node](https://learn.microsoft.com/en-us/entra/identity-platform/tutorial-v2-nodejs-desktop) y [registro de aplicaciones de escritorio](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-registration).
