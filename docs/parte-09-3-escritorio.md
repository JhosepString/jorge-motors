# Parte 9.3 — Contenedor de escritorio

**Estado:** ventana Electron y empaquetado de directorio verificados. **No es aún el instalador funcional para usuarios finales.**

`desktop/main.mjs` abre el React compilado dentro de una ventana aislada. `desktop/static-server.mjs` sirve los archivos solo por `127.0.0.1` y rechaza métodos de escritura; la navegación fuera de la aplicación está bloqueada. La ventana no expone Node al frontend. `desktop/scripts/prepare-frontend.mjs` copia la compilación al paquete. Electron Builder ya produjo `desktop/release/win-unpacked/Jorge Motors.exe` en esta PC.

Esta entrega comprobó el contenedor visual. La [Parte 9.4](parte-09-4-identidad-escritorio.md) añadió el flujo nativo de Entra y la [Parte 9.5c](parte-09-5c-carga-local-escritorio.md) conectó la vista local con SQLite. Aún falta configuración/validación real del tenant y del despliegue cloud. El `Jorge Motors.exe` actual no se entrega a empleados.

Para desarrollo, desde `frontend/` ejecutar `pnpm build`; desde `desktop/`, `pnpm prepare:frontend` y `pnpm run pack`. Esto solo lo hace el desarrollador, nunca el usuario final. El `.exe` instalador y desinstalador pertenecen a la parte 6, cuando la autenticación y sincronización estén completas. El puerto local 5173 se usa provisionalmente por el retorno SPA existente; el flujo nativo permitirá un puerto libre sin colisiones.

**Verificación:** compilación frontend, copia de archivos, prueba HTTP del servidor estático y empaquetado Windows. El archivo no está firmado y usa aún el icono predeterminado de Electron.
