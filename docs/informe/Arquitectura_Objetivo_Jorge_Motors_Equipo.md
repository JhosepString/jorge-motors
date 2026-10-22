# Informe de arquitectura objetivo — Jorge Motors

**Dirigido a:** equipo del proyecto de Arquitectura de Software, Universidad Nacional de Cañete.  
**Fecha:** 21 de octubre de 2026.  
**Versión:** 1.0. Base de coordinación del desarrollo y de la exposición.  
**Entorno:** demostración académica en Azure for Students; recursos regionales en Central US.

## 1. Resumen de la decisión

Jorge Motors será una aplicación web para gestionar el inventario de un taller automotriz. Se implementará un **backend monolítico modular con arquitectura en capas**, consumido por una interfaz React mediante una API REST. La información transaccional se almacenará en Azure SQL Database y los documentos de compra en Blob Storage privado.

El backend se empaquetará en Docker y se ejecutará en Azure Container Apps. GitHub almacenará el código y GitHub Actions ejecutará verificaciones, construirá imágenes y ofrecerá un despliegue iniciado manualmente por el responsable. Las notificaciones se procesarán de forma recuperable mediante una tarea independiente que reutiliza los módulos del backend.

La arquitectura busca consistencia del inventario, trazabilidad, seguridad por roles y facilidad de mantenimiento. Los servicios de Azure se elegirán por las necesidades del sistema: no se creará un recurso cloud por cada patrón de diseño.

El usuario administrará Azure y aplicará los despliegues manualmente. Este informe documenta decisiones y trabajo futuro; no acredita que todos los servicios o patrones estén implementados.

## 2. Objetivos y alcance

### Objetivo general

Automatizar las entradas y salidas de repuestos de Jorge Motors mediante una plataforma web segura, con stock consistente, historial auditable y alertas de reabastecimiento.

### Funciones del alcance

- Autenticación y autorización de empleados.
- Gestión de categorías, productos y proveedores.
- Consulta de existencias y ubicación de los repuestos.
- Registro de entradas y salidas, con una referencia externa de trabajo cuando corresponda.
- Historial inmutable de movimientos y correcciones mediante movimientos compensatorios.
- Registro de facturas de compra y sus detalles, con documentos adjuntos privados.
- Alertas de stock mínimo y avisos por correo al proveedor.
- Reportes de inventario valorizado y kardex; exportación PDF y Excel.

### Exclusiones del demo

No se implementarán contabilidad general, facturación electrónica tributaria, ventas completas, pagos, diagnóstico de vehículos, portal de proveedores ni gestión integral de órdenes de trabajo. Una referencia de orden en un movimiento no implica implementar ese módulo.

La factura de compra se registra como sustento de una recepción de inventario. No equivale a emitir comprobantes fiscales a clientes. La presentación anterior debe actualizarse para reflejar esta ampliación de alcance.

## 3. Usuarios, identidades y permisos

| Actor | Permisos previstos |
| --- | --- |
| Administrador | Gestionar catálogo y proveedores; registrar recepciones y movimientos autorizados; consultar precios, alertas y reportes; administrar habilitación y asignaciones de la aplicación según el procedimiento definido. |
| Mecánico | Consultar existencias; registrar salidas; consultar sus movimientos. No administrar usuarios, modificar precios ni ajustar inventario arbitrariamente. |
| Proveedor | Actor externo registrado como entidad de negocio. Recibe correo y entrega documentos por los canales actuales del taller. No inicia sesión en la plataforma. |

Entra ID gestiona las identidades de los empleados. Se usará un tenant de trabajadores y registros de aplicación de un solo tenant. La SPA obtendrá un **access token destinado a la API** mediante MSAL y Authorization Code con PKCE; la API verificará firma, emisor, audiencia, vigencia y permisos. Un ID token no sustituye el access token de la API.

La tabla de usuarios conservará el perfil operativo y la relación con los movimientos. Su clave externa de identidad será la combinación de tenant y object ID de Entra, no el correo. No se guardarán contraseñas locales. El estado inactivo del perfil debe impedir operaciones incluso cuando exista un token todavía vigente.

Los roles de la aplicación serán `Administrador` y `Mecanico`. Estos no conceden administración del tenant o de la suscripción de Azure. La API impondrá permisos; ocultar botones en la interfaz es únicamente una ayuda visual.

Se distinguirán tres identidades: empleados que usan el sistema, identidad de GitHub Actions que despliega, e identidades administradas de los procesos que acceden a Azure. Cada una tendrá permisos propios.

## 4. Arquitectura lógica y dependencias

| Nivel | Responsabilidad | Ejemplos |
| --- | --- | --- |
| Presentación web | Formularios, navegación, validación de experiencia de usuario y visualización | React, pantallas de inventario, registro de salida. |
| Entrada HTTP | Traducir solicitudes y respuestas; validar DTO y acceso | Rutas y controladores Express, middlewares. |
| Aplicación | Coordinar los casos de uso y sus transacciones | `InventarioFacade`, recepción de factura, generación de reporte. |
| Dominio | Definir reglas e invariantes del negocio | Cantidad válida, stock suficiente, transiciones de alerta. |
| Infraestructura y persistencia | Implementar contratos de repositorios e integraciones | Azure SQL, Blob Storage, servicio de correo. |

La interfaz solo se comunica con la API; no accede directamente a SQL ni contiene credenciales de servicios. Los servicios de aplicación consumen contratos de persistencia. Las implementaciones concretas se conectan desde la composición de la aplicación. Así, el dominio no necesita conocer Express ni Azure.

### Módulos del backend

| Módulo | Propósito |
| --- | --- |
| Usuarios y acceso | Relacionar identidad y perfil; verificar habilitación y permisos. |
| Productos y categorías | Mantener catálogo y clasificación. |
| Proveedores | Mantener contactos y correo de reposición. |
| Inventario | Coordinar entradas, salidas y reglas de existencias. |
| Movimientos | Conservar y consultar el historial auditable. |
| Facturas de compra | Registrar documentos y detalles de recepción. |
| Alertas | Evaluar mínimos y administrar su ciclo de vida. |
| Notificaciones | Registrar tareas de correo, intentos y resultados. |
| Reportes | Consultar inventario y kardex; exportar formatos. |

El backend y el Job comparten código y versionado. Ejecutar dos procesos no convierte automáticamente la solución en microservicios. Para este tamaño de sistema, la modularidad se demostrará con responsabilidades y dependencias claras dentro del repositorio.

## 5. Despliegue objetivo en Azure

| Componente | Servicio | Configuración de partida / criterio |
| --- | --- | --- |
| Grupo del demo | Resource Group | `rg-jorge-motors-dev`, Central US; separar costos de otros proyectos. |
| Frontend | Static Web Apps | Archivos React compilados; plan Free como punto de partida del demo. |
| API Docker | Container Apps | Perfil Consumption, recursos acotados y escalado limitado durante el demo. |
| Procesamiento de correo | Container Apps Job | Ejecución manual inicialmente; programación solo al acordar latencia y costo. |
| Registro privado de imágenes | Container Registry | SKU pequeño, retención de imágenes controlada; no contiene datos del inventario. |
| Base de datos | Azure SQL Database | Tamaño y cómputo ajustados al demo; evaluar elegibilidad de oferta gratuita en el portal. |
| Facturas adjuntas | Storage Account / Blob | Standard LRS, contenedor `facturas` privado, HTTPS y acceso autorizado. |
| Identidad | Microsoft Entra ID | Empleados, roles de aplicación e identidades de servicios. |
| Envío de correo | Communication Services Email | Habilitar al integrar el envío real y comprobar dominio/remitente. |
| Telemetría | Application Insights / Log Analytics | Registros estructurados, retención e ingestión limitadas. |
| Secretos residuales | Key Vault, cuando exista una necesidad real | Usar identidades administradas donde haya soporte; no crear secretos innecesarios. |

Los servicios regionales se ubicarán en Central US cuando el servicio y la suscripción lo permitan. Entra ID y GitHub no se describen como recursos alojados dentro de ese grupo o región. Static Web Apps distribuye contenido y tiene consideraciones propias de ubicación; la región seleccionada no significa que todo el contenido se sirva exclusivamente desde Central US.

La autenticación de la SPA se implementará con MSAL directamente en React. No se presupone contratar autenticación personalizada integrada de Static Web Apps Standard.

La API y el Job usarán identidades administradas con permisos específicos para los recursos compatibles. El permiso de SQL se configura también en la base de datos: un rol de administración de Azure no sustituye los permisos de consulta y escritura sobre tablas.

La red del demo comenzará con HTTPS y controles de acceso adecuados a cada servicio. SQL no permitirá acceso desde todas las direcciones: se habilitarán únicamente los accesos necesarios para desarrollo y ejecución. No se incorporarán NAT Gateway, Kubernetes, máquinas virtuales o Private Endpoints como prerrequisitos del demo. Un despliegue comercial requerirá revisar exposición de red, disponibilidad, recuperación y costos.

### Comportamiento de escalado

Escalar la API a cero es una opción de ahorro para períodos sin uso, a cambio de arranque en frío. El Job se ejecuta independientemente de las solicitudes HTTP, por lo que no depende de un temporizador residente en una API detenida.

Programar un Job que consulte SQL constantemente puede impedir períodos de inactividad de la base e incrementar consumo. Durante el demo se ejecutará manualmente; antes de programarlo se definirá el plazo máximo de aviso y se medirá el costo conjunto. Serverless no garantiza por sí solo un costo bajo.

## 6. Funcionamiento de las operaciones principales

### 6.1 Inicio de sesión

1. El empleado inicia sesión en Entra ID desde la interfaz.
2. La interfaz obtiene el access token y llama a la API.
3. La API valida el token y la habilitación del usuario.
4. Cada caso de uso verifica el permiso correspondiente.

### 6.2 Salida de inventario

1. El mecánico selecciona producto, cantidad y referencia.
2. La API valida identidad, permisos y DTO.
3. `InventarioFacade.registrarSalida()` inicia una transacción.
4. Se realiza un descuento condicionado a que exista stock suficiente.
5. Se guarda el movimiento con cantidad, usuario, fecha y saldos consistentes.
6. Si corresponde, se registra la alerta y su tarea durable de notificación dentro de la misma transacción.
7. Se confirma la transacción y se responde al usuario. Ante un fallo, se revierte todo.

Se exigirá una clave de idempotencia para registrar movimientos: repetir una solicitud por doble clic o reintento no debe duplicar la salida. Si dos usuarios compiten por el último stock, solo se confirmarán las operaciones que puedan satisfacerse, sin saldo negativo.

### 6.3 Recepción de compra

1. El administrador registra proveedor, número de factura, fecha y líneas del documento.
2. El archivo se almacena en Blob privado con metadatos de seguimiento.
3. Confirmar la recepción crea los movimientos de entrada y actualiza existencias en una transacción SQL.
4. Se controla la duplicidad del documento por proveedor y número, y la repetición de la confirmación.
5. La alerta se atiende conforme al resultado del reabastecimiento y a la regla acordada.

La subida a Blob y la transacción SQL no son una sola transacción distribuida. Se manejarán estados de documento y limpieza de archivos huérfanos para los fallos intermedios. El tamaño y tipo de archivo se validarán en la API.

### 6.4 Alertas y correo

El movimiento confirmado deja un registro Outbox pendiente. El Job reclama tareas, envía avisos y registra intentos. Una interrupción permite recuperar el trabajo; no se dependerá únicamente de eventos en memoria.

La alerta de negocio tendrá estados `PENDIENTE`, `ENVIADA` y `ATENDIDA`, con transiciones explícitas. La tarea de correo tendrá su propio estado de procesamiento, intentos y próximo reintento. Envío aceptado por el servicio no significa entrega leída ni reposición del stock.

Los consumidores deben ser idempotentes. Si el servicio de correo acepta un envío y el proceso falla antes de guardar el resultado, un reintento podría duplicar el correo; se mitigará con identificadores, deduplicación y capacidades del proveedor. No se prometerá entrega exactamente una vez.

Observer se usará para la colaboración interna entre objetos o módulos. La recuperación de tareas depende del registro durable y del Job. Una alerta que deba persistir no puede depender de un callback que se ejecute únicamente después del commit.

### 6.5 Reportes

Se consultarán inventario y kardex con permisos y filtros. Strategy seleccionará el generador PDF o Excel mediante un contrato común. Si Pipe and Filter forma parte de los patrones exigidos por el curso, se evidenciará con etapas reales de extracción, filtrado, transformación y exportación; no se contará la misma cadena HTTP como dos implementaciones distintas sin justificarlo.

## 7. Patrones y evidencia para la exposición

| Patrón | Problema que resuelve | Implementación objetivo | Evidencia que debe presentar el equipo |
| --- | --- | --- | --- |
| Singleton | Evitar crear clientes/pools repetidamente | Una instancia controlada del cliente/pool por proceso, inicializada de forma segura | Código de creación/reutilización y prueba de instanciación. No afirmar una conexión única global. |
| Facade | Simplificar operaciones que coordinan varios pasos | `InventarioFacade` para entrada/salida | Caso de uso y prueba de transacción/rollback. La integridad procede también de la transacción y sus restricciones. |
| Observer | Notificar cambios a colaboradores sin acoplar al emisor a cada receptor | Publicador y suscriptores de eventos internos | Suscripción, publicación y prueba del comportamiento. |
| Strategy | Cambiar algoritmo de exportación sin condicionales distribuidos | Generadores PDF y Excel bajo un contrato | Mismo caso de uso con dos estrategias verificadas. |
| State | Limitar comportamiento y transiciones según estado | Estados de alerta y operaciones permitidas | Clases/objetos de estado y pruebas de transiciones válidas e inválidas. |
| Chain of Responsibility | Aplicar reglas HTTP ordenadas e interrumpir peticiones | Middlewares de contexto, acceso, validación y errores | Cadena en `app.ts` y prueba de rechazo antes del controlador. |
| Repository | Separar casos de uso del acceso concreto a datos | Interfaces por necesidad e implementaciones SQL | Servicios que dependen del contrato y pruebas de integración del adaptador. |
| Outbox | Evitar perder tareas al confirmar movimientos | Movimiento y tarea pendiente en la misma transacción | Reinicio simulado y recuperación de tareas sin duplicar el movimiento. |

El estilo general es capas + monolito modular; la comunicación externa es cliente-servidor mediante REST. Los eventos internos aportan desacoplamiento puntual, sin presentar el sistema completo como una plataforma distribuida de eventos.

Un esquema ORM no demuestra Repository. Un campo de estado o un trigger no demuestra State GoF. Un formulario de confirmación no demuestra Facade. Los diagramas deben acompañar evidencia del código y pruebas.

## 8. Datos y adaptación del avance anterior

Se conservan los conceptos de usuario, categoría, proveedor, producto, stock, movimiento y alerta. Se añadirán factura de compra, detalle de factura y registros de notificación/Outbox según el diseño de la Parte 2 y siguientes.

Las cantidades y unidades se definirán antes de migrar: repuestos indivisibles pueden usar enteros; lubricantes fraccionables requieren una política explícita. Los importes usarán tipos decimales de precisión fija y una política de moneda y redondeo, evitando `Float` para dinero.

Reglas mínimas: stock no negativo, cantidades válidas, movimiento coherente, historial protegido, identificación del autor y una política que evite alertas abiertas duplicadas. La corrección de un movimiento se hará con otro movimiento documentado.

La base objetivo es Azure SQL Database, no PostgreSQL. El SQL SQLite existente se conserva como antecedente y deberá adaptarse; no se ejecutará directamente contra Azure SQL. La aplicación usará migraciones versionadas y pruebas sobre un motor compatible con el destino.

**Decisión técnica pendiente para la Parte 2:** confirmar el cliente SQL/ORM y su autenticación. Prisma no es una dependencia instalada de la API actual. Antes de elegirlo se comprobarán transacciones, acceso a Azure SQL, renovación de credenciales/tokens y soporte de identidad administrada. Si otro driver se ajusta mejor, el cambio quedará documentado y encapsulado tras Repository. Esto no cambia la arquitectura ni autoriza provisionar recursos cloud.

## 9. Requisitos de calidad y criterios de aceptación

| Atributo | Criterio para validar el demo |
| --- | --- |
| Seguridad | Los casos de uso protegidos rechazan tokens inválidos y operaciones sin permiso; no se guardan contraseñas locales ni secretos en Git. |
| Integridad | En pruebas de concurrencia e idempotencia no hay stock negativo, doble descuento ni movimiento parcial. |
| Auditoría | Cada movimiento conserva autor, fecha y saldos; se comprueba la política de inmutabilidad. |
| Fiabilidad | Un fallo posterior al commit no pierde la tarea de aviso; los reintentos no duplican movimientos. |
| Mantenibilidad | Los casos de uso y el dominio se prueban sin levantar la interfaz; los adaptadores tienen pruebas propias. |
| Rendimiento | Meta inicial de consultas: p95 de hasta 2 s con servicio activo; tamaño de datos y concurrencia se fijarán antes de medir. Arranques en frío se medirán por separado. |
| Observabilidad | Solicitudes y errores se correlacionan mediante request ID; logs sin tokens, documentos completos o cadenas de conexión. |
| Recuperación | Documentar y realizar una restauración de prueba antes del cierre. RPO/RTO se acordarán según la configuración seleccionada. |
| Usabilidad | El mecánico completa el flujo de salida en tres pasos; estados, validaciones y errores se muestran con texto comprensible. |

Estas son metas y criterios de prueba, no resultados obtenidos. `/health` verifica respuesta del proceso; no demuestra disponibilidad ni acceso correcto a SQL. Se añadirá una comprobación de preparación cuando existan dependencias, evitando sondeos que activen SQL innecesariamente durante el demo.

## 10. Repositorio y entrega de software

Se mantendrá un repositorio con `frontend/`, `backend/`, `database/`, `infra/` y `docs/`. Se conservará el lockfile de dependencias y cada integrante trabajará en ramas `feature/...`, con revisión mediante Pull Request.

Flujo de entrega:

1. El Pull Request ejecuta chequeo de tipos, pruebas y compilación.
2. Tras integrar un cambio, se construye una imagen Docker reproducible, sin secretos, y se etiqueta con el SHA del commit.
3. Se publica la imagen en Container Registry. El frontend se compila como archivos estáticos, no requiere Docker.
4. El responsable inicia manualmente el despliegue mediante `workflow_dispatch`; se identifica una versión concreta.
5. Las migraciones se ejecutan como paso controlado, una vez por despliegue cuando sean necesarias, con permisos separados de la ejecución normal.
6. Se publica una revisión de Container Apps y se verifican salud y flujos esenciales.
7. Si falla, se vuelve a una revisión anterior compatible. Revertir una imagen no revierte automáticamente los datos o el esquema.

GitHub Actions usará OIDC para autenticarse frente a Azure. La API y el Job descargarán imágenes con identidad administrada y permisos de lectura del registro. Se evitará reutilizar credenciales de administrador como identidad de ejecución.

El usuario creará y modificará Azure manualmente para aprender su administración. Bicep documentará la configuración reproducible. La creación de infraestructura y el despliegue de aplicación se tratarán como operaciones separadas. No se configurará despliegue automático cloud sin que el usuario cambie expresamente esa preferencia.

## 11. Organización del equipo y entregas

El equipo asignará responsables por frente y un revisor distinto para cada cambio. Se propone distribuir los frentes de backend/datos, frontend, identidad/despliegue y pruebas/documentación; la asignación nominal depende del acuerdo del equipo. Todos deben comprender el flujo de inventario y al menos la evidencia de un patrón.

| Parte | Entrega verificable | Patrones / foco |
| --- | --- | --- |
| 1 | API local, configuración, health y errores | Chain of Responsibility inicial. |
| 2 | Dominio, repositorios, transacciones y pruebas de inventario | Repository, Facade; cliente/pool por proceso. |
| 3 | Entra ID y permisos de empleados | Extensión de la cadena HTTP, RBAC. |
| 4 | Alertas, estados y tareas recuperables | Observer, State y Outbox. |
| 5 | Administración, compras, adjuntos y reportes | Adaptadores y Strategy. |
| 6 | Interfaz según Figma conectada a la API | Cliente-servidor y flujos por rol. |
| 7 | Docker y workflows versionados | Integración y entrega con ejecución manual. |
| 8 | Despliegue aplicado por el usuario y validación final | Observabilidad, recuperación y C4 actualizado. |

Cada parte se cierra con código revisable, pruebas proporcionales, explicación del patrón, requisitos que respalda y limitaciones. La bitácora `docs/avance-implementacion.md` registra su estado. No se presentarán partes pendientes como funcionalidades terminadas.

### Estado al emitir este informe

La Parte 1 se verificó el 20 de octubre en el entorno de trabajo del asistente: TypeScript, compilación, ocho pruebas y arranque HTTP 200. Su instalación en la terminal del usuario seguía en preparación de Node.js/pnpm; todavía falta esa confirmación local. El backend no implementa inventario, autenticación ni persistencia y no está desplegado.

El grupo `rg-jorge-motors-dev` fue creado y confirmado previamente en Azure. Existe una plantilla Bicep de almacenamiento validada localmente; su validación no acredita su despliegue. No se realizó un nuevo inventario de recursos Azure para emitir este informe.

## 12. Documentación para la exposición

Se actualizarán C4 contexto, contenedores y componentes, más una vista de código centrada en los patrones. El modelo de entidades/relaciones complementa esa documentación, pero no sustituye un diagrama de clases de los colaboradores de un patrón.

La vista de despliegue mostrará dónde se ejecuta cada elemento y cómo se entrega desde GitHub. Un contenedor C4 es una aplicación o un almacén de datos; no implica una imagen Docker.

Se incluirán decisiones arquitectónicas breves (ADR): elección del monolito modular, Azure SQL y cliente de datos, identidad con Entra, almacenamiento privado, Outbox y estrategia de despliegue. Cada decisión describirá problema, alternativas, elección y consecuencias.

La demostración principal será una salida concurrente: se confirma únicamente el stock disponible, se registra el historial y queda una alerta recuperable. La presentación mostrará la relación entre requisito, diagrama, código, prueba y comportamiento observable.

## 13. Consumo y controles del demo

Los créditos estudiantiles son un medio de pago temporal, no una garantía de gratuidad. Antes de crear cada servicio se revisarán SKU, región, cuotas, precio del portal y saldo vigente. No se adoptan como presupuesto de esta arquitectura las estimaciones previas de App Service B1: ahora se contemplan Container Registry y un Job, con un perfil de consumo diferente.

El costo depende del tiempo activo de SQL y contenedores, almacenamiento, correo, imágenes y telemetría. Se registrará por grupo y etiquetas. Un presupuesto de Cost Management alerta, pero no detiene automáticamente el gasto; si su configuración está deshabilitada, se revisará la causa en lugar de asumir que no hay consumo.

Para el demo: limitar réplicas, datos, imágenes y logs; ejecutar el Job manualmente al principio; usar datos ficticios y mantener un solo entorno cloud. Al terminar se decidirá con el responsable qué conservar y qué retirar, con exportación previa de la información necesaria.

## 14. Fuentes y documentos de referencia

Fuentes técnicas oficiales consultadas el 21 de octubre de 2026:

- [Contenedores en C4](https://c4model.com/abstractions/container): alcance lógico de la vista de contenedores.
- [Despliegue de Container Apps con GitHub Actions](https://learn.microsoft.com/en-us/azure/container-apps/github-actions): imágenes y revisiones.
- [Identidades administradas en Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity): acceso de procesos a servicios compatibles.
- [Autenticación Entra para Azure SQL](https://learn.microsoft.com/en-us/azure/azure-sql/database/authentication-aad-overview?view=azuresql): identidad y permisos de acceso a datos.

Referencias internas: README del proyecto, bitácora de implementación, backend existente y documentación histórica del Avance 2. La disponibilidad concreta de servicios y condiciones de la suscripción se comprobarán cuando el usuario prepare cada recurso.
