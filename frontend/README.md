# Frontend Jorge Motors

React + Vite + TypeScript, CSS propio y fuentes IBM Plex locales. Backend separado en `../backend/`. No se publica ni modifica Azure desde este proyecto al instalar o arrancar.

## Arranque local

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd check
pnpm.cmd dev
```

Abrir `http://localhost:5173`. Sin configuración Entra se muestra el acceso, pero el botón permanece deshabilitado: no hay usuarios falsos ni un modo de saltarse autenticación en la aplicación real.

Antes de iniciar sesión, seguir la [guía de la Parte 6](../docs/parte-06-frontend.md): registro SPA manual, retorno **`http://localhost:5173/redirect.html`**, permiso delegado de la API y cliente permitido en el backend. No modificar el registro de escritorio que utilizan los comandos CLI existentes. Copiar `.env.example` a `.env.local` solo después de obtener el nuevo ID SPA.

Las variables `VITE_*` son públicas y se incorporan a la compilación. Nunca incluir secretos de aplicación, passwords, cadenas SQL ni tokens. MSAL gestiona la sesión; las cuentas operativas y permisos definitivos proceden de la API. Cambiar roles en el navegador no concede acceso al backend.

## Funciones preparadas

- Administrador: resumen sin valoración ficticia, inventario y búsqueda, alta de categoría/producto, edición versionada de producto, movimientos, historial, reportes PDF/Excel, proveedores, creación de facturas, revisión, recepción/anulación de borrador y adjuntos privados.
- Mecánico: stock sin precios, registrar salida y consultar únicamente sus movimientos.
- Errores visibles, estados vacíos/carga, reintento sin duplicar una intención de movimiento y formato PEN sin coma flotante para mostrar importes.

Edición de categorías y de líneas/fecha de una factura existente, selección paginada de más de 100 proveedores al crear compra, alertas detalladas, gestión web de usuarios, kardex exportable y correo real permanecen pendientes. Las operaciones no ofrecidas conservan su acceso CLI/API cuando ya estén implementadas allí. No se anuncian SMS, IGV automático ni validación tributaria.

La clave de movimiento/recepción se conserva en el componente mientras está abierto, no tras recargar/cerrar. Ante una respuesta incierta, reintentar en la misma pantalla antes de salir; si se perdió la pantalla, comprobar historial/documento antes de volver a registrar. No se afirma recuperación durable del formulario del navegador.

## Verificación

```powershell
pnpm.cmd check
pnpm.cmd test:e2e
pnpm.cmd audit --prod
```

En Windows, Playwright utiliza Edge instalado y un servidor temporal en **5174**. No comparte el servidor real 5173. En CI utiliza Chromium instalado por el workflow. Los escenarios de interfaz interceptan una API ficticia del propio servidor de pruebas; no llaman a localhost:3000, Microsoft, SQL ni correo. La entrada de prueba `e2e/fixture.html` no forma parte del build; `scripts/verify-build.mjs` lo comprueba.

El build genera `dist/index.html`, `dist/redirect.html`, fuentes/estilos/scripts y la configuración estática de Azure. La página de retorno MSAL es independiente de React y del router. No añadir COOP a esa página ni impedir que la SPA la use en un iframe del mismo origen; revisar también CSP antes de publicar. Ver [guía Microsoft del redirect bridge](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/redirect-bridge).

Una prueba automática de accesibilidad no certifica conformidad completa. El inicio de sesión Microsoft real y la validación de ambos roles en el navegador requieren la configuración y demostración manual del responsable.
