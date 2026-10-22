# API de Jorge Motors — Partes 1, 2 y 3

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

La Parte 2 añade inventario y persistencia SQL. La Parte 3 publica rutas protegidas, validador Entra y auditoría transaccional; para usar tokens reales debes completar los registros y perfiles indicados en la guía. El esquema SQLite de `database/` sigue siendo material del avance anterior.

## Parte 2: inventario y SQL local

Guía detallada y demostración de patrones: [Parte 2](../docs/parte-02-inventario.md).

```powershell
pnpm.cmd check
pnpm.cmd test:sql
```

Las pruebas SQL requieren SQL Server local, ODBC Driver 18 y autenticación Windows con permiso para crear una base temporal. Usan una base `jm_test_<UUID>` creada para cada ejecución y eliminada al terminar; no usan la base configurada en `.env`.

Patrones implementados en esta parte: **Repository**, **Facade** y **Singleton**. El dominio está en `src/modules/inventario/` y la persistencia en `src/infrastructure/database/`. Alertas y correo siguen pendientes.

## Parte 3: acceso y auditoría

La [guía de Entra ID y auditoría](../docs/parte-03-identidad-auditoria.md) incluye la configuración manual de la API y del cliente de pruebas. No necesitas crear client secrets. Sin token se rechaza el acceso; sin configuración no se habilita acceso libre.

Rutas disponibles: GET `/api/v1/auth/me`, POST `/api/v1/inventario/salidas` y POST `/api/v1/inventario/entradas`. Solo health es público. Los POST exigen `Idempotency-Key` y obtienen al usuario del token/perfil, no del cuerpo.

La auditoría de éxito se guarda en la transacción del movimiento; los rechazos HTTP tienen registro independiente y respaldo técnico explícito si SQL falla. La guía explica cómo revisar la tabla y las pruebas de esta garantía.

Una vez configurado tu tenant, migrada la base y creado tu perfil, `pnpm.cmd auth:check` inicia una prueba interactiva de `/auth/me`. Se ejecuta manualmente por ti y no imprime el token.

## Parte 4.1: alertas y Outbox pendiente

La [guía de alertas](../docs/parte-04-alertas.md) documenta Observer interno, State y la escritura atómica de tareas Outbox. Aplica `pnpm.cmd db:migrate` antes de probar movimientos con esta versión. Un stock menor o igual al mínimo abre una alerta sin duplicarla; reponer por encima del mínimo la atiende y cancela el aviso no aceptado. El consumidor se describe en 4.2; no hay envío real de correo todavía.

## Parte 4.2: worker y simulación aislada

La migración 004 agrega reservas temporales, intentos y estados de procesamiento. `pnpm.cmd outbox:status` consulta sin modificar las tareas de la base local; `pnpm.cmd worker:demo` demuestra concurrencia, reintentos, recuperación y cancelación con transporte ficticio en una base efímera que se elimina al terminar. No envía correos ni marca enviados sobre `jorge_motors_dev`. El núcleo del worker está implementado; adaptador de correo real, comando operativo y programación en Azure se integrarán al desplegar.

## Parte 5.1: catálogo administrativo

La [guía del catálogo](../docs/parte-05-catalogo.md) documenta altas/consultas/edición de categorías y productos, auditoría transaccional, dinero exacto y ETag/If-Match para evitar sobrescrituras. Aplica migraciones (incluida 005) antes de usar `/api/v1/catalogo`. Solo Administrador: `pnpm.cmd catalog:check categorias` permite probarlo con inicio de sesión real; el Mecánico debe recibir 403. No hay edición de cantidades, SKU, activo ni borrado físico. El alta/edición reevalúa alertas mediante Outbox V2, compatible con el worker actualizado.

## Parte 5.2a: proveedores externos

La [guía de compras](../docs/parte-05-2-compras.md) describe contactos externos sin cuenta Entra ni perfil de usuario. `/api/v1/compras/proveedores` permite alta, consulta, edición y desactivación/reactivación solo al Administrador, con auditoría atómica y ETag/If-Match. Aplicar migraciones hasta 006 antes de usar las rutas. `pnpm.cmd supplier:check listar` prueba el acceso interactivo; para los demás comandos, ver la guía. Guardar un correo no envía mensajes. Registro y recepción están en 5.2b; adjuntos siguen pendientes.

## Parte 5.2b: facturas y recepción

La [guía de facturas](../docs/parte-05-2b-facturas.md) describe borradores en PEN y recepción completa, con stock/movimientos/alertas/auditoría en una sola transacción. `/api/v1/compras/facturas` es exclusivo del Administrador. La confirmación exige If-Match e Idempotency-Key estable; los reintentos comprobados no duplican entradas. Aplica migraciones hasta 007. El cliente `pnpm.cmd invoice:check listar` consulta sin modificar stock; `crear examples/factura-demo.json` exige IDs reales de proveedor/producto y crea solo un borrador. Confirmar sí registra entradas permanentes. Adjuntos, Blob privado y validación fiscal no están implementados.

## Parte 5.2c: adjuntos privados locales

La [guía de adjuntos](../docs/parte-05-2c-adjuntos.md) explica subida/listado/descarga solo para Administrador, límites de 5 MiB y cinco adjuntos por factura, firmas básicas y SHA-256. Migración 008, `AdjuntosFacade`, puerto de almacenamiento y Adapter local fuera de las rutas HTTP estáticas. `attachment:check` permite subir/listar con PKCE y clave estable; `attachment:cleanup` solo consulta pendientes vencidos a menos que se indique `--apply`. La limpieza conserva trazabilidad y no elimina documentos confirmados. No hay antivirus ni adaptador Blob todavía; el almacenamiento local se rechaza en producción.

## Parte 5.3: reportes de inventario y Strategy

La [guía de reportes](../docs/parte-05-3-reportes.md) documenta GET `/api/v1/reportes/inventario` (JSON) y `/api/v1/reportes/inventario/exportar?formato=pdf|xlsx`, solo Administrador, con filtros y auditoría. **Strategy implementado**: PDF/Excel consumen el mismo conjunto autorizado. Máximo 1000 productos, 10 MiB y dos exportaciones en curso por instancia; no se trunca ni se redondean precios incompatibles con Excel. `pnpm.cmd report:check pdf` o `xlsx` descarga con PKCE en `.local-data/reportes/` sin sobrescribir archivos. No requiere nuevas migraciones. PDFKit/ExcelJS y fuente Noto Sans son dependencias desplegables; el backend no depende de Office/Codex. Correo, Blob y frontend mantienen su etapa pendiente.

## Parte 6.1: consultas para la interfaz

`GET /api/v1/inventario/stock`, `/categorias` y `/movimientos`: Administrador/Mecánico activos, campos públicos sin precios, filtros estrictos, paginación acotada y auditoría. El Mecánico siempre recibe solo sus propios movimientos. No se abrió el catálogo administrativo al Mecánico ni se aceptan IDs de actor desde el cliente. La [guía frontend](../docs/parte-06-frontend.md) documenta la SPA y la configuración manual del nuevo cliente Entra; agregarlo a ENTRA_ALLOWED_CLIENT_IDS sin quitar el cliente de escritorio. No hay migraciones nuevas.

`Dockerfile` con contexto en la raíz del proyecto y workflow manual preparados: ver [Parte 7](../docs/parte-07-docker-ci.md). Construcción de imagen, ejecución del workflow y despliegue Azure todavía no verificados. Los adjuntos locales siguen fallando cerrados en producción y la autenticación SQL por identidad administrada sigue pendiente.

## Patrón aplicado: Chain of Responsibility

`app.ts` compone handlers independientes en orden:

1. Contexto y seguimiento de solicitud.
2. Cabeceras de seguridad con Helmet.
3. Política de origen CORS.
4. Parseo JSON con límite de 64 KB.
5. Rutas HTTP.
6. Ruta inexistente.
7. Manejador central de errores.

Un handler delega mediante `next()`, responde o desvía al manejador de errores con `next(error)`. La prueba de origen rechazado evidencia que la cadena se interrumpe antes del controlador de salud. La Parte 3 amplía la cadena con autenticación, perfil, permisos y validación de DTO antes de llegar al controlador.

CORS es una política del navegador y no reemplaza autenticación ni autorización. Zod valida la configuración y los DTO del inventario.

## Evidencias para la exposición

- Mostrar `app.ts`: orden de los handlers y responsabilidades.
- Mostrar `request-context.ts`: delegación con `next()`.
- Ejecutar `pnpm check`: se verifican éxito, rechazo, límites y errores.
- Consultar `/api/v1/health`: primera ruta funcional y registro estructurado.
- Consultar una ruta inexistente: error con `code`, `message` y `requestId`.

La API no registra cuerpos, tokens ni cadenas de conexión. Los errores inesperados devuelven un mensaje genérico y un identificador para correlacionar el fallo. El logging detallado y redactado se ampliará con observabilidad.

Plan y trazabilidad: `../docs/avance-implementacion.md`.
