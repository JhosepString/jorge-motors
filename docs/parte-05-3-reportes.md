# Parte 5.3 — Reportes

## Entrega 5.3a: consulta común del inventario

Se implementó `GET /api/v1/reportes/inventario`, exclusivo de Administrador activo. Respuesta JSON sin caché, con filtros, moneda PEN, resumen y filas. En 5.3a no se generaron archivos ni se declaró Strategy. La entrega 5.3b, descrita abajo, incorpora las dos estrategias concretas.

Filtros opcionales:

- `categoriaId`: entero positivo; una categoría inexistente produce un conjunto vacío, no datos inventados.
- `incluirInactivos=true|false`: falso por defecto.
- `soloBajoMinimo=true|false`: falso por defecto; selecciona solo productos activos con stock menor o igual al mínimo.

La consulta JSON no acepta campos desconocidos, booleanos ambiguos, SQL ni `formato`; este último pertenece exclusivamente a la ruta de exportación. Límite fijo de 1000 filas; SQL lee como máximo 1001 para detectar exceso y devuelve 413 `REPORT_TOO_LARGE`, sin truncar silenciosamente. No es un reporte paginado ni de inventario histórico; para un catálogo mayor se requiere acotar por categoría/estado o diseñar posteriormente exportación por lotes.

Cada fila contiene ID, SKU, nombre, categoría, stock actual, mínimo, precio maestro de compra como texto decimal exacto y activo. No hay valoración contable, costo promedio ni suma de precios/cantidades heterogéneas. El precio no representa necesariamente el último precio registrado en una factura.

Estados: `INACTIVO` tiene prioridad; entre activos, stock cero es `AGOTADO`, stock positivo menor o igual al mínimo es `BAJO_MINIMO` y los demás son `NORMAL`. El resumen cuenta productos, agotados, inactivos y productos activos bajo mínimo (incluye los agotados); las dos últimas métricas operativas no se suman como categorías excluyentes.

Se reutilizan **Facade, Repository y Chain of Responsibility**, con la UoW y pool Singleton existentes. La consulta usa HOLDLOCK sobre las tablas leídas y conserva la auditoría en su transacción; no necesita asumir RCSI activado. Puede competir por locks con operaciones de inventario: no se promete ausencia de esperas ni un SLA de producción. Es una lectura transaccional de estado actual, no una fotografía histórica guardada con una fecha de corte.

Auditoría `REPORTE_INVENTARIO_CONSULTADO`, actor verificado, filtros y conteos. No se modifica inventario, catálogo, alertas, facturas ni adjuntos. Un fallo de auditoría no permite devolver un éxito no registrado. Sin cambios de esquema ni nuevas dependencias.

Ejemplos de consulta autenticada para el futuro frontend:

```text
GET /api/v1/reportes/inventario
GET /api/v1/reportes/inventario?categoriaId=1&soloBajoMinimo=true
GET /api/v1/reportes/inventario?incluirInactivos=true
```

El navegador no obtiene autorización solo por abrir la URL: se necesita el access token verificado en Authorization. No se comparten ni imprimen tokens para esta demostración. Las pruebas automáticas utilizan claves RSA ficticias y SQL local efímero; no inician sesión por el usuario.

## Entrega 5.3b: Strategy PDF y Excel

Implementada `GET /api/v1/reportes/inventario/exportar?formato=pdf|xlsx`. Requiere Administrador activo y acepta los mismos filtros de la consulta JSON. No consulta facturas, movimientos ni adjuntos; no envía correo ni modifica stock. El proveedor no recibe acceso al sistema por disponer de un correo de contacto.

### Patrón aplicado: Strategy

| Participante | Implementación | Responsabilidad |
| --- | --- | --- |
| Contrato Strategy | `InventoryReportStrategy.generar` | Recibe el inventario autorizado y devuelve bytes |
| Estrategias concretas | `PdfInventoryStrategy`, `ExcelInventoryStrategy` | Cambian el algoritmo de presentación, no las consultas ni permisos |
| Contexto | `ReportesFacade.exportarInventario` | Valida, obtiene datos, selecciona estrategia y audita |
| Composición | `runtimeServices` | Inyecta el mapa `pdf`/`xlsx` sin acoplar aplicación a las bibliotecas |

Evidencia: `backend/src/modules/reportes/application/inventory-report.ts` y `backend/src/modules/reportes/infrastructure/report-strategies.ts`. Las pruebas intercambian las implementaciones reales y estrategias simuladas bajo el mismo caso de uso. Repository, Facade, Singleton y Chain of Responsibility se reutilizan, no se duplican.

### Flujo, seguridad y límites

1. La cadena verifica token, perfil y rol. Solo después se reserva un cupo de exportación.
2. Una transacción SQL revalida el administrador y lee el conjunto acotado mediante el repositorio común. Sus bloqueos terminan antes de renderizar.
3. La estrategia genera el archivo en memoria, sin carpeta HTTP pública, enlaces compartidos ni almacenamiento permanente de reportes en el servidor.
4. Una segunda transacción revalida el perfil activo y registra `REPORTE_INVENTARIO_GENERADO` con formato, filtros, conteos, bytes y fecha UTC. Si falla la auditoría o se revoca el perfil durante la generación, no se devuelven bytes.
5. HTTP entrega un archivo adjunto de nombre fijo con MIME específico, `no-store`, `nosniff` y CSP restrictiva. CORS permite al futuro frontend leer Content-Disposition. La auditoría afirma **generación autorizada**, no recepción ni apertura por el cliente.

Máximo 1000 productos, 10 MiB por archivo y dos exportaciones simultáneas por instancia de API. La tercera recibe 429 `REPORT_BUSY` y Retry-After. Una desconexión no libera el cupo mientras el trabajo sigue activo. El límite no es una cuota global entre réplicas ni un control de frecuencia por usuario. El render ocurre en el proceso Node, no en un Job ni un worker thread: no se declara SLA ni capacidad de producción. Para mayor volumen se evaluarán trabajos asíncronos y descarga privada temporal.

El archivo refleja el conjunto leído, no una consulta histórica a la fecha de generación ni un bloqueo de inventario hasta que finaliza la descarga. La API puede auditar generación aunque una conexión se haya cortado antes de recibir el archivo. No se archivan reportes ni se afirma una transacción distribuida entre SQL y HTTP.

### Exactitud y presentación

- PDF A4 horizontal, fuente Noto Sans embebida, encabezado repetido, filas ajustadas al texto y paginación. Los importes PEN se formatean desde su cadena decimal sin convertirlos a coma flotante, incluido el máximo DECIMAL(18,2).
- La fuente distribuida cubre texto latino/español, no todos los alfabetos. Un carácter sin glifo devuelve 422 `REPORT_PDF_TEXT` y recomienda Excel; no se sustituye silenciosamente por un cuadrado. Se normalizan saltos de línea/tabulaciones para presentar celdas PDF.
- XLSX de una hoja, fecha UTC tipada, filtros, filas/columnas identificadoras congeladas, textos literales, conteos y cantidades numéricas, precio numérico con formato PEN de dos decimales. Ningún nombre o SKU se transforma en fórmula ni hipervínculo. Es una **exportación estática**, no una plantilla de inventario editable conectada al sistema.
- Excel rechaza conservadoramente precios superiores a `9999999999999.99` con 422 `REPORT_EXCEL_PRECISION`: se reserva precisión para los dos centavos decimales dentro de 15 cifras. Se recomienda PDF, sin redondear ni cambiar valores a texto para aparentar un resultado numérico.
- No se suma el stock de productos heterogéneos como dinero ni se calcula valorización, impuestos, costo promedio o último precio de factura.

### Demostración con identidad real (opcional, a cargo del usuario)

Desde `backend/`, con API local en ejecución:

```powershell
pnpm.cmd report:check pdf
pnpm.cmd report:check xlsx
# Si el catálogo supera 1000 productos, acotar a una categoría:
pnpm.cmd report:check pdf 1
```

Cada comando abre Microsoft mediante PKCE y solicita seleccionar Administrador Demo. Un Mecánico debe recibir 403. No se imprime el token ni se requiere secreto de cliente. La descarga crea un archivo con UUID nuevo bajo `backend/.local-data/reportes/`, excluido de Git/Docker, sin sobrescribir anteriores. El usuario administra la retención de esas copias locales, que contienen información de compra. La generación automática de pruebas no reemplaza esta sesión Microsoft real.

### Dependencias y comprobación de archivos

Producción usa PDFKit, ExcelJS, fontkit y Noto Sans (licencia OFL incluida por el paquete); no necesita Codex, Python, Microsoft Office ni herramientas de render para generar archivos en Docker. Las herramientas de PDF/hojas de cálculo se usan solamente para QA local. Referencias: [fuentes y texto PDFKit](https://pdfkit.org/docs/text.html), [ExcelJS](https://github.com/exceljs/exceljs), [licencia y distribución Noto Sans](https://fontsource.org/fonts/noto-sans/use).

`pnpm audit --prod` detectó inicialmente un aviso moderado en uuid 8 indirecto de ExcelJS. Se fijó únicamente `exceljs>uuid` a 11.1.1 en pnpm-workspace.yaml y el lockfile; ExcelJS usa v4 CommonJS. La versión corrige el [aviso GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Se repitieron generación y pruebas con la resolución corregida; una auditoría limpia no equivale a ausencia de vulnerabilidades desconocidas.

Muestras reproducibles ficticias: `pnpm.cmd exec tsx scripts/report-qa.ts`, sin `.env`, SQL ni Microsoft, bajo `.local-data/report-qa/`. Se revisaron ambas páginas PDF renderizadas, ajuste de nombres/categorías largos, numeración y los 18 SKU mediante extracción independiente. XLSX se reabrió, inspeccionó y renderizó con Artifact Tool, sin errores de fórmulas. Su vista previa mostró un defecto del renderizador para el importe límite: el XML conserva el valor correcto. Se verificó además en Microsoft Excel instalado, abriendo **solo la muestra ficticia en lectura**, macros/enlaces deshabilitados, sin guardar cambios: G9 muestra `S/ 9,999,999,999,999.99`. Se inspeccionó su exportación nativa a PDF y se cerró la instancia de prueba. Office no es dependencia del backend ni se inspeccionaron libros del usuario.

## Verificación de 5.3a

Tipos, 82 pruebas unitarias/HTTP y compilación aprobados en 5.3a. Suite SQL focalizada de catálogo/reportes: 19 aprobadas (cuatro nuevas de reportes), con base efímera eliminada y sin datos permanentes creados. No se repitió la regresión completa del resto de módulos en 5.3a. La validación adicional de 5.3b se registra en la bitácora.
