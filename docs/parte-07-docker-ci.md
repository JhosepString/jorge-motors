# Parte 7 — Docker y verificación CI (preparación)

**Archivos preparados; imagen y workflow aún no ejecutados.** El daemon de Docker Desktop no estaba disponible durante la comprobación local. No se inició Docker/WSL, no se publicó código, no se ejecutó GitHub Actions ni se modificó Azure. No se considera cerrada la Parte 7 por escribir estos archivos.

## Qué se empaqueta

`backend/Dockerfile`, con contexto en la raíz `jorge-motors/`, separa instalación/compilación, dependencias de producción y ejecución. El runtime usa Node 24 en Debian slim, usuario no-root, solo dependencias de producción, JavaScript compilado y migraciones. El servidor escucha en 0.0.0.0:3000; esto solo se aplica al contenedor, no modifica el host local configurado.

El frontend se compila a archivos estáticos para Static Web Apps, no requiere un contenedor ni un servidor Node por usuario. “Contenedor” del modelo C4 y “contenedor Docker” no significan lo mismo. Docker y CI/CD tampoco se cuentan como patrones GoF.

Las fuentes PDF se incluyen a través de dependencias; no dependen de Arial de Windows. No se compila el driver opcional Windows en Linux. La API Linux debe usar el adaptador SQL correspondiente; Windows Integrated Authentication del host no se traslada al contenedor.

La imagen no arranca migraciones ni correo por sí sola, no copia `.env`, datos privados, facturas, `node_modules` del host ni pruebas visuales. Las exclusiones `.dockerignore` y los COPY explícitos reducen el contexto y el runtime. La etiqueta base `node:24-bookworm-slim` es mutable: antes de una entrega reproducible se debe registrar/pinar el digest de la imagen aprobada y analizar sus vulnerabilidades. El lockfile fija paquetes, no vuelve inmutable la imagen base.

## Prueba manual, cuando el usuario inicie Docker Desktop

Desde la raíz del repositorio:

```powershell
docker version
docker build --file backend/Dockerfile --tag jorge-motors-api:demo .
docker run --rm --name jm-api-demo --publish 127.0.0.1:3100:3000 jorge-motors-api:demo
```

En otra terminal, consultar `http://127.0.0.1:3100/api/v1/health`. No usar 3000 en el host mientras la API de desarrollo esté allí. Esta prueba arranca **sin credenciales** y verifica solo vida HTTP; los endpoints protegidos no quedan operativos sin configurar Entra/SQL. No enviar el `.env` de Windows a la imagen ni asumir que su `localhost` es SQL Server del host. Al parar el contenedor con Ctrl+C, `--rm` elimina ese contenedor temporal; la imagen queda disponible localmente.

Para comprobar generadores dentro de la imagen se puede añadir después una prueba controlada sin datos reales. No se presenta health 200 como verificación de base, autenticación, adjuntos o disponibilidad completa.

## GitHub Actions preparado

`.github/workflows/verify.yml` tiene solo `workflow_dispatch`: el responsable lo inicia desde Actions después de subir/revisar el código. Permisos `contents: read`, checkout sin credenciales persistidas, acciones fijadas a SHA verificados del upstream el 21/10/2026. Mantener esas referencias revisadas mediante el procedimiento del equipo.

Dos jobs:

1. Node/pnpm, instalación desde lockfiles, tipos/pruebas/build y auditoría de dependencias para ambos proyectos; navegador Chromium aislado para la UI.
2. Construir una imagen local al runner y comprobar health en 127.0.0.1:3100, luego eliminar el contenedor temporal de ese runner.

No incluye login Azure, secretos de suscripción, credenciales de registro, push a ACR ni despliegue. No se creó un service principal para él. El workflow preparado no está verificado en GitHub y puede necesitar ajustes tras la primera ejecución real. Las pruebas SQL integradas continúan siendo locales en Windows, con base efímera: este workflow Linux **no ejecuta `test:sql`** y no permite afirmar que lo hace.

El futuro paso de publicación se diseñará por separado, iniciado manualmente y con OIDC/identidad de despliegue acotada. El responsable creará los recursos, asignaciones y confianza federada en Azure; no se guardarán secretos de larga duración por conveniencia.

## Bloqueos antes del despliegue Azure

- Configuración SPA y prueba real de la Parte 6.
- El adaptador `SQL_DRIVER=entra` está implementado y probado por configuración, pero todavía falta crear Azure SQL, activar la identidad administrada, crear el usuario contenido en la base y probar la conexión real. Véase [Parte 8.1](parte-08-azure-sql.md). Asignar únicamente un rol Azure al recurso no completa ese acceso.
- Blob privado, autorización de documentos y análisis de archivos pendientes. En producción el Adapter local de adjuntos falla cerrado (503), por lo que no debe presentarse esa función como lista para la nube.
- Correo real/destinatarios y Job cloud, observabilidad, backups/restauración, política de red y prueba de recuperación pendientes.
- Construcción local/runner de la imagen, análisis de vulnerabilidades del sistema base y prueba de funcionamiento, no solo del Dockerfile.

No se han creado recursos facturables Azure. GitHub Actions, ACR, Container Apps y los demás servicios deben evaluarse cuando el responsable vaya a ejecutarlos; no se promete gratuidad por el mero hecho de ser un demo.

Referencias técnicas: [Docker multi-stage y buenas prácticas](https://docs.docker.com/build/building/best-practices/), [checkout](https://github.com/actions/checkout), [setup-node](https://github.com/actions/setup-node), [pnpm/action-setup](https://github.com/pnpm/action-setup).
