# Parte 6 — Interfaz y conexión con la API

## Estado y alcance

**6.1 implementada y verificada localmente con identidades ficticias de prueba. 6.2 (sesión Microsoft real en la SPA) pendiente de configuración manual.** No se modificaron registros Entra, recursos Azure ni el archivo `.env` del backend. No se desplegó ni se enviaron correos.

Se conserva React + Vite + TypeScript, monolito modular en el servidor y comunicación REST. El frontend no abre SQL, no conoce credenciales de servicios y no reproduce las reglas transaccionales como si sustituyeran al backend. El servidor sigue imponiendo rol, identidad, límites, versiones, stock e idempotencia.

## Referencia visual y cambios justificados

Fuente revisada: [Jorge Motors · Rediseño en Figma](https://www.figma.com/design/aVwcR282SCEXWPieTv7aUr/Jorge-Motors-%E2%80%94-Inventario-t%C3%A9cnico). Se consultaron contextos de diseño y capturas de Acceso (2:21), Panel (2:46), Inventario (2:161), Movimiento (2:259), Proveedores (2:424), Reportes (2:512), Stock mecánico (2:685), Salida (2:752) e Historial propio (2:856). Se reutilizan paleta, tipografías, panel lateral, superficies, tablas y estructura de formularios; los datos son dinámicos, no las cifras del mockup.

No había una biblioteca de componentes web existente: se crearon tokens CSS y componentes compartidos, sin añadir Tailwind. Los nodos seleccionados se componen de texto y formas, sin imágenes/SVG externos que descargar; las fuentes IBM Plex se sirven desde paquetes locales y conservan su licencia. Se usó la guía Figma para adaptar el diseño y el flujo local de la guía web, sin registrar ni alojar un Site externo.

| Diseño anterior | Adaptación implementada | Motivo |
| --- | --- | --- |
| Correo/contraseña local y “hash” | Botón Microsoft y explicación de identidad externa | No almacenar contraseñas ni usar bcrypt en este sistema |
| CSV, kardex y valoración estimada | Reporte inventario PDF/XLSX; kardex exportable señalado como pendiente | Mostrar solo funciones y métricas implementadas |
| RUC y SMS de proveedor | Código de negocio, razón social y correo opcional | El modelo actual no valida RUC ni integra SMS |
| “Aviso enviado” en actividad | Historial real y aviso explícito de correo pendiente | No afirmar envíos externos inexistentes |
| Gestión de usuarios dentro de la aplicación | Procedimiento Entra y CLI, sin botones de altas ficticias | La API aún no ofrece esa administración web |
| Texto gris/marrón pequeño de contraste insuficiente | Grises/marrones de texto ligeramente más oscuros | Corregir contraste detectado por revisión WCAG automática |
| Sin pantalla específica de compra | Composición con los mismos tokens y componentes | Integrar los casos de compra implementados después del prototipo |

La fidelidad no se declara pixel-perfect: esas adaptaciones funcionales, la accesibilidad y el comportamiento móvil se documentan en lugar de ocultarse. No se editó el archivo Figma.

## Funciones por rol

Administrador: resumen, consulta/búsqueda de inventario, alta de categorías/productos, edición de producto con If-Match, entradas/salidas, historial global, reporte inventario con filtros y descarga PDF/XLSX, alta/edición/desactivación de proveedores, listado/alta/revisión de facturas, recepción completa/anulación de borrador y subida/descarga de adjuntos privados.

Mecánico: consulta stock sin precios ni acceso al catálogo administrativo, registra salidas y consulta su propio historial. No se admiten un `usuarioId` o un rol enviados por el formulario para elegir el actor.

No se presentan agregados mensuales a partir de una página incompleta. El dashboard muestra conteos del reporte acotado a 1000 productos y los primeros registros de historial por ID ascendente, rotulados así; no se los llama “últimos movimientos”. El stock consultado en formularios es una vista previa: otras operaciones pueden cambiarlo antes de confirmar y prevalece SQL.

## Lecturas nuevas para soportar el Mecánico

Antes solo había escritura de movimientos y catálogo exclusivo del Administrador. Se añadieron, sin migración:

```text
GET /api/v1/inventario/stock
GET /api/v1/inventario/categorias
GET /api/v1/inventario/movimientos
```

`InventoryReadFacade` depende de `ReadUnitOfWork`; `SqlInventoryReadUnitOfWork` implementa consultas parametrizadas y auditoría. Se reutilizan **Facade, Repository, Singleton y Chain of Responsibility**. Separar lectura y escritura aquí no se presenta como una arquitectura CQRS completa.

Paginación por ID ascendente, 25 elementos por defecto y máximo 100, con cursor `siguiente`. Stock solo incluye productos activos y campos expresamente seleccionados, **sin precio, versión administrativa, secretos o claves**. Filtros: `buscar` (hasta 100 caracteres, coincidencia literal de código/nombre/categoría), `categoriaId`, `estado=TODOS|NORMAL|BAJO_MINIMO|AGOTADO`. Bajo mínimo incluye agotados. El historial admite `productoId` y siempre filtra al Mecánico por el ID resuelto desde su identidad, no por query string. Los nombres de producto en ese historial corresponden al catálogo vigente; no se afirma un snapshot histórico del nombre.

Auditorías `INVENTARIO_CONSULTADO` y `MOVIMIENTOS_CONSULTADOS`, conteos y alcance propio cuando aplica. Un fallo de auditoría impide devolver éxito. No se cambian stock, alertas, Outbox ni movimientos por una consulta.

## Organización del frontend

| Carpeta/archivo | Responsabilidad |
| --- | --- |
| `src/core/session.ts` | Adaptador MSAL, PKCE, caché de sesión, token silencioso y acceso/cierre explícitos |
| `src/auth/redirect.ts`, `redirect.html` | Retorno dedicado MSAL v5, sin React/router/consultas API ni logs de códigos |
| `src/core/api.ts` | Cliente REST, token solo en cabecera, errores, formatos monetarios y clave por intención |
| `src/Application.tsx` | Perfil validado por API, navegación por rol y carga diferida de pantallas |
| `src/pages/` | Flujos de inventario, movimientos, reportes, proveedores y compras |
| `src/ui/` | Estados de carga, errores, modal accesible, tablas y paginación |
| `e2e/` | Entrada aislada, sesión y API ficticias; excluida de producción |

Un cliente REST o hook React no se cuenta como un nuevo GoF Strategy/Facade. La evidencia de los seis patrones continúa principalmente en el backend; por ejemplo, descargar PDF/XLSX desde React invoca la Strategy ya implementada allí.

## Paso manual 6.2 — Registrar el cliente SPA

Usar el mismo directorio de empleados ya utilizado por la API. No se necesita dominio de pago ni correo empresarial nuevo para el demo.

1. En Entra ID → Registros de aplicaciones → Nuevo registro, nombre sugerido **Jorge Motors - Web - Demo**. Seleccionar solo cuentas de este directorio.
2. Plataforma **Aplicación de página única (SPA)**. URI exacta: **`http://localhost:5173/redirect.html`**. En Autenticación añadir también **`http://localhost:5173/`** para el retorno tras cerrar sesión. No elegir Web confidencial ni escritorio; no crear secreto de cliente y no activar concesión implícita.
3. Copiar el ID de aplicación (cliente) del nuevo registro SPA. Conservar el cliente de escritorio `06b6e377-10f3-4742-a2b0-39289eb9d027` y su `http://localhost` sin cambios: lo utilizan las pruebas CLI existentes.
4. En **Permisos de API del nuevo registro Web**, añadir permiso delegado de **Jorge Motors - API - Demo** (`0ed26762-92c1-46d6-8623-ce827609c1c2`), scope `Inventario.Access`. Conceder consentimiento según lo que permita/requiera el directorio; no añadir permisos de aplicación ni Microsoft Graph para este flujo.
5. Los empleados deben conservar sus asignaciones Administrador/Mecánico en la aplicación empresarial de la **API**, además del perfil local habilitado que ya se verificó. No conceder administración global, de suscripción o del tenant para usar el sistema.
6. En `backend/.env`, ampliar manualmente `ENTRA_ALLOWED_CLIENT_IDS` con el nuevo ID SPA, separado por coma, **sin quitar el cliente de escritorio**. No cambiar `ENTRA_TEST_CLIENT_ID`. Mantener `FRONTEND_ORIGIN=http://localhost:5173`. Reiniciar el proceso de API para cargar la configuración.
7. Desde `frontend/`, copiar `.env.example` a `.env.local` sin sobrescribir un archivo existente. Sustituir `VITE_ENTRA_SPA_CLIENT_ID` por el nuevo ID. Confirmar tenant/API contra el portal, base API `http://127.0.0.1:3000/api/v1` y retorno `http://localhost:5173/redirect.html`.
8. Ejecutar `pnpm.cmd dev` en `frontend/`; entrar por **`http://localhost:5173`**, no `127.0.0.1`, para coincidir con CORS y retorno registrado. El puerto es fijo y el servidor falla si está ocupado; no salta silenciosamente a otro puerto.
9. Iniciar sesión con Administrador Demo. Comprobar inventario, historial y exportación sin registrar movimientos permanentes si no se necesitan. Cerrar sesión y comprobar Mecánico: no precios, reportes o entradas; historial propio. Registrar una salida solo si se desea modificar deliberadamente el stock Demo.

Ejemplo de configuración del backend (sustituir el marcador, no copiarlo literalmente):

```dotenv
ENTRA_ALLOWED_CLIENT_IDS=06b6e377-10f3-4742-a2b0-39289eb9d027,ID_REAL_DEL_NUEVO_CLIENTE_SPA
ENTRA_TEST_CLIENT_ID=06b6e377-10f3-4742-a2b0-39289eb9d027
FRONTEND_ORIGIN=http://localhost:5173
```

MSAL v5 requiere el retorno dedicado también para renovación silenciosa cuando termina la vigencia del refresh token. El build incluye `redirect.html`; no debe sustituirse por la página principal ni servirse con COOP. Evitar X-Frame-Options DENY o `frame-ancestors 'none'` sobre esa página si impiden el iframe del propio origen. Antes de publicar, revisar CSP con el dominio real de la API y los endpoints Microsoft; no se proporciona una política “cerrada” que impediría el login. Referencias: [registro SPA](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-spa-app-registration), [inicialización MSAL](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/initialization), [redirect bridge v5](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/redirect-bridge).

## Reintentos y límites conocidos

- `Idempotency-Key` de movimiento y recepción estable mientras permanece abierto el componente. Bloqueo ante doble clic y formulario inmovilizado ante red/5xx incierto; reintentar los mismos datos. Un 4xx conocido permite corregir el formulario. No se reintentan mutaciones automáticamente.
- Al cerrar, navegar fuera o recargar se pierde esa intención en memoria. Si ocurrió, consultar historial/documento antes de registrar otra operación. Recuperación durable del formulario y navegación bloqueada siguen pendientes; no se afirma cobertura exactamente una vez del navegador.
- If-Match de producto/proveedor/factura se obtiene del registro revisado. Un 412 muestra conflicto; no sobrescribe usando una versión refrescada a escondidas.
- Proveedores se filtran solo en la página cargada y se etiqueta así. Crear compra ofrece hasta 100 proveedores, con advertencia si hay más; requiere selección paginada futura. Categorías se cargan paginadas con límite de 2000 y error explícito si se excede, no truncado silencioso.
- El formulario de compra crea y revisa líneas; editar un borrador existente sigue en CLI/API. La interfaz no incorpora desactivación de producto, edición de categoría, correcciones compensatorias, alertas detalladas ni gestión de usuarios web.
- Adjuntos mantienen el Adapter local y sus límites: no antivirus ni Blob cloud todavía. No se debe presentar como servicio de archivos apto para producción.

## Verificación y siguiente entrega

Se comprobaron tipos, compilación, núcleo REST/formatos/idempotencia, navegación y permisos visuales, error de concurrencia, reintento de salida con misma clave, bloqueo por cantidad, descarga, móvil y accesibilidad automática. Las pruebas HTTP+SQL del servidor verifican que ocultar botones no es la barrera de seguridad. Se inspeccionaron capturas del acceso, inventario y móvil frente a Figma. El control automático WCAG no sustituye una auditoría completa ni prueba con lector de pantalla.

Ninguna prueba UI usó la base Demo: el servidor de Playwright va en 5174 y toda API está interceptada en ese servidor, nunca en localhost:3000. Las suites SQL crean/eliminan bases aleatorias y datos ficticios. No se inició sesión Microsoft por el usuario. La bitácora contiene los resultados de ejecución y el estado exacto del cierre.

Pendiente para cerrar 6.2: realizar el procedimiento Entra anterior y demostrar ambos roles reales en navegador. Después: empaquetado Docker/CI preparado en [Parte 7](parte-07-docker-ci.md), integración Blob/identidad administrada/observabilidad y despliegue Azure **manual**, no automático.
