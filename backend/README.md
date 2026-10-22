# API de Jorge Motors — Parte 1

Base HTTP local con Express 5 y TypeScript estricto. Runtime: Node.js 24 LTS. Gestor de dependencias: pnpm 11.25.0; `pnpm-lock.yaml` fija las versiones para repetir la instalación.

## Ejecutar

Instala Node.js 24 LTS y pnpm 11.25.0 si todavía no están en tu terminal. Desde `backend/`:

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env
pnpm dev
```

La copia de `.env.example` solo es necesaria la primera vez. Conserva tu `.env` si ya existe.

En otra terminal:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health
```

Resultado: `status: ok`, `service: jorge-motors-api`. El endpoint es público y solo comprueba que el proceso HTTP responde; no afirma que Azure SQL esté disponible.

## Verificación

```powershell
pnpm check
```

Ejecuta el chequeo de tipos, las pruebas HTTP y la compilación. Para ejecutar lo compilado: `pnpm start`. Detén el servidor con Ctrl+C. En desarrollo escucha en `127.0.0.1`. Al preparar Docker configuraremos `HOST=0.0.0.0` explícitamente.

## Estructura actual

```text
src/
  app.ts                       Composición de la cadena HTTP, sin abrir puertos
  server.ts                    Arranque, configuración y cierre del servidor
  config/env.ts                Validación de configuración con Zod
  middleware/
    request-context.ts         Identificador y registro de cada solicitud
    not-found.ts               Terminación de rutas inexistentes
    error-handler.ts           Respuesta uniforme de errores
  modules/health/
    health.routes.ts           GET /api/v1/health
  shared/
    app-error.ts               Errores controlados
    logger.ts                  Contrato de logging y adaptación a consola
tests/http.test.ts             Pruebas de comportamiento HTTP
```

Los módulos de negocio se crearán cuando tengan código; todavía no existen endpoints de inventario ni conexión a la base de datos. El esquema SQLite de `database/` sigue siendo material del avance anterior, no la persistencia de esta API.

## Patrón aplicado: Chain of Responsibility

`app.ts` compone handlers independientes en orden:

1. Contexto y seguimiento de solicitud.
2. Cabeceras de seguridad con Helmet.
3. Política de origen CORS.
4. Parseo JSON con límite de 64 KB.
5. Rutas HTTP.
6. Ruta inexistente.
7. Manejador central de errores.

Un handler delega mediante `next()`, responde o desvía al manejador de errores con `next(error)`. La prueba de origen rechazado evidencia que la cadena se interrumpe antes del controlador de salud. Esta es la primera implementación del patrón; autenticación, autorización y validación de DTO se añadirán en las partes correspondientes.

CORS es una política del navegador y no reemplaza autenticación ni autorización. Zod valida ahora la configuración del proceso, no datos de operaciones del inventario.

## Evidencias para la exposición

- Mostrar `app.ts`: orden de los handlers y responsabilidades.
- Mostrar `request-context.ts`: delegación con `next()`.
- Ejecutar `pnpm check`: se verifican éxito, rechazo, límites y errores.
- Consultar `/api/v1/health`: primera ruta funcional y registro estructurado.
- Consultar una ruta inexistente: error con `code`, `message` y `requestId`.

La API no registra cuerpos, tokens ni cadenas de conexión. Los errores inesperados devuelven un mensaje genérico y un identificador para correlacionar el fallo. El logging detallado y redactado se ampliará con observabilidad.

Plan y trazabilidad: `../docs/avance-implementacion.md`.
