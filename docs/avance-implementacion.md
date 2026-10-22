# Bitácora de implementación — Jorge Motors

Fecha de inicio: 20 de octubre de 2026. Entorno objetivo: demo académico en Azure for Students, Central US.

## Acuerdo de trabajo

Se entrega una parte verificable por vez, con código, pruebas y explicación de los patrones. El usuario crea y modifica Azure manualmente, ejecuta despliegues y administra GitHub. Preparar un archivo o un workflow no autoriza a desplegarlo. La documentación del Avance 2 se conserva como evidencia histórica.

## Partes y criterios de cierre

| Parte | Resultado | Patrones o decisiones | Estado |
| --- | --- | --- | --- |
| 1. Base local de la API | Arranque, health, errores, configuración y pruebas | Chain of Responsibility inicial; composición e inyección de dependencias | Completada y verificada localmente |
| 2. Dominio y persistencia del inventario | Repositorios, migraciones Azure SQL y salidas concurrentes verificadas | Capas, monolito modular, Repository, Facade; cliente/pool por proceso | Pendiente |
| 3. Acceso de usuarios | Entra ID, tokens y permisos Administrador/Mecánico | Extensión de Chain of Responsibility; RBAC | Pendiente |
| 4. Alertas fiables | Alerta, transición y notificación durable con reintentos | Observer, State, eventos internos y Outbox | Pendiente |
| 5. Operaciones del administrador | Catálogo, proveedores, facturas de compra y reportes | Adaptadores de infraestructura; Strategy para PDF/Excel | Pendiente |
| 6. Interfaz e integración | Flujos por rol según Figma consumiendo la API | Cliente-servidor y separación presentación/negocio | Pendiente |
| 7. Docker y CI/CD | Imagen reproducible y workflow con despliegue manual | Empaquetado, pruebas y entrega versionada; no son patrones GoF | Pendiente |
| 8. Azure y cierre | Despliegue por el usuario, pruebas integradas y documentación C4 actualizada | Vista de despliegue, observabilidad y atributos de calidad | Pendiente |

En la Parte 2 se realizará una validación local de la persistencia compatible con Azure SQL; la conexión a recursos de Azure esperará a que el usuario los configure. Se fijará el driver, autenticación y estrategia de pruebas antes de crear migraciones.

## Parte 1 — Qué se implementó

- Express 5 + TypeScript estricto en Node.js 24.
- Separación de aplicación (`app.ts`) y proceso (`server.ts`).
- Validación de puerto, host y origen del frontend con Zod.
- Identificador de solicitud y logs JSON con estado y duración.
- Health público en `/api/v1/health`, errores uniformes, CORS explícito y límites JSON.
- Pruebas HTTP de caminos exitosos y fallidos.

### Patrón: Chain of Responsibility

**Problema:** aplicar reglas HTTP independientes en un orden predecible, deteniendo la solicitud cuando una regla la rechaza.

**Solución:** handlers de Express compuestos con `app.use`; `next()` delega y `next(error)` deriva al tratamiento central de errores. Un controlador puede terminar la cadena enviando la respuesta.

**Evidencia:** `backend/src/app.ts`, `backend/src/middleware/` y `backend/tests/http.test.ts`. La prueba de origen no permitido recibe 403 en una ruta que respondería 200: el middleware evita ejecutar el controlador.

**Alcance actual:** cadena HTTP inicial. No se presenta como autenticación implementada: falta integrar Entra ID, verificar permisos y validar DTO del negocio.

### Arquitectura y otros patrones

La separación arranque/aplicación facilita pruebas y configura las dependencias desde fuera. Esto es una base estructural, no demuestra todavía la arquitectura del dominio ni los otros cinco patrones GoF. No se declara Singleton, Facade, Observer, State, Strategy o Repository como implementados en esta parte.

### RNF y límites

Respalda parcialmente RNF-07 (organización), RNF-08 (errores) y RNF-11 (errores de solicitudes controlados). Health aporta observabilidad inicial a RNF-10, pero no mide disponibilidad. CORS y Helmet aportan controles iniciales; RNF-14 requiere HTTPS en el despliegue. No hay mediciones de rendimiento, pruebas de stock, autenticación ni recuperación de datos en esta entrega.

### Demostración local

Desde `backend/`, instalar con `pnpm install --frozen-lockfile`, ejecutar `pnpm check` y arrancar con `pnpm dev`. Mostrar health, una ruta inexistente y la prueba que interrumpe la cadena. No se requiere Azure para esta demostración.

## Registro de validación

Verificado el 20 de octubre de 2026 con Node.js v24.19.0 y pnpm 11.25.0:

- `pnpm install --frozen-lockfile`: instalación correcta. El proyecto permite explícitamente el script de instalación de esbuild usado por tsx.
- `pnpm check`: chequeo de tipos correcto, 8 pruebas aprobadas y compilación correcta.
- Arranque real de `dist/server.js` en un proceso temporal: `GET /api/v1/health` respondió HTTP 200 con `{"status":"ok","service":"jorge-motors-api"}`. El proceso de comprobación se cerró al terminar.
- `git diff --check`: sin errores de espacios.

La Parte 1 está completada. La siguiente entrega será la Parte 2: dominio y persistencia del inventario, con contratos Repository y coordinación Facade, sin publicar endpoints de negocio desprotegidos. La verificación de Singleton/cliente de conexión se documentará cuando se elija e integre el driver.
