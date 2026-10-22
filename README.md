# Sistema de Gestión de Inventario "Jorge Motors"

Plataforma web para gestionar el inventario de la mecánica automotriz **Jorge Motors** (Pueblo Nuevo, Chincha, Ica). Busca reemplazar el control en hojas de Excel por stock consistente, historial de movimientos y alertas de reposición. El registro de alertas/Outbox funciona localmente; el envío real al proveedor y su integración cloud siguen pendientes.

Proyecto del curso **Arquitectura de Software** — Universidad Nacional de Cañete.
Docente: Mg. Luis Enrique Ramírez Pacheco.

## Integrantes

- Castillo Canales, Korayma Anaís
- Hernández Hernández, José Antonio
- Neyra Quiroz, José Guillermo
- Rojas Castillo, Sebastián Jaren

## Arquitectura

La arquitectura objetivo acordada para el desarrollo en Azure, los patrones y la organización de las entregas se describen en el [informe para el equipo](docs/informe/Arquitectura_Objetivo_Jorge_Motors_Equipo.md). Las tecnologías del Avance 2 que figuran más abajo se conservan como antecedente histórico.

Implementación actual: backend de inventario, Entra, auditoría, alertas/Outbox, catálogo, proveedores, facturas/adjuntos y reportes PDF/Excel; frontend React con navegación por rol y flujos conectados al contrato REST. SQL Server local mediante `node-mssql`; Azure SQL sigue como destino. La [bitácora](docs/avance-implementacion.md) distingue implementación local, pruebas ficticias, identidad real y despliegues pendientes.

Para usar la interfaz: [guía de la Parte 6](docs/parte-06-frontend.md). El registro SPA de Entra y la demostración de ambos roles en el navegador requieren configuración manual del responsable. [Docker y CI](docs/parte-07-docker-ci.md) están preparados, no se consideran ejecutados ni desplegados. El adaptador Entra para Azure SQL también está preparado; su [configuración y comprobación cloud](docs/parte-08-azure-sql.md) siguen pendientes. El entorno Azure no se modifica automáticamente.

La [Parte 3: identidad y auditoría](docs/parte-03-identidad-auditoria.md) añade endpoints protegidos y auditoría transaccional. Su código se verifica localmente; completar los registros de Entra y comprobar el tenant real requiere la configuración manual del usuario.

- **Estilo:** monolito modular con arquitectura en capas (presentación → negocio → datos).
- **Modelado:** modelo C4 en cuatro niveles (contexto, contenedores, componentes y código).
- **Patrones GoF:** Singleton, Facade, Observer, Strategy, State y Chain of Responsibility.
- **Decisiones y mecanismos implementados:** capas, cliente-servidor / API REST, Repository, Unit of Work, idempotencia y Outbox. Hay eventos internos con Observer; no se presenta el sistema como una plataforma distribuida de eventos ni se declara Pipe and Filter por repetir la cadena HTTP.

## Tecnologías

| Capa | Tecnología |
| --- | --- |
| Frontend | React, Vite, TypeScript |
| Backend | Node.js, Express, TypeScript |
| Persistencia | node-mssql, Repository y transacciones T-SQL |
| Base de datos | SQL Server Developer local / Azure SQL objetivo |
| Seguridad | Microsoft Entra ID, MSAL/PKCE, JWT verificado, roles, Zod y CORS |

Prisma, SQLite/PostgreSQL y bcrypt corresponden al Avance 2 histórico, no a la implementación vigente. Los diagramas, modelos y scripts antiguos se conservan como antecedente y no deben ejecutarse para crear la base del demo actual. Usar las migraciones y guías de `database/azure-sql/` y del backend.

| Herramientas de diseño | Uso |
| --- | --- |
| draw.io | Arquitectura en capas, modelo C4 y mapa de navegación |
| Lucidchart | Modelos conceptual y lógico de la base de datos |
| DBeaver | Ejecución del script SQL y modelo físico |
| Figma | Prototipos de la interfaz |

## Estructura conservada del Avance 2

La implementación vigente está en `backend/src/`, `frontend/src/`, `database/azure-sql/` y las guías por partes de `docs/`. El siguiente árbol conserva la organización del diseño inicial, no una indicación de usar Prisma/SQLite actualmente.

```
jorge-motors/
├── database/
│   ├── schema.sql                  # diseño físico de la base de datos (SQLite)
│   ├── schema.prisma               # esquema de Prisma para el backend
│   ├── pruebas/
│   │   ├── datos_prueba.sql        # datos de ejemplo (15 productos, 4 alertas, kardex)
│   │   └── pruebas_integridad.sql  # pruebas P1 a P8
│   └── README.md
├── docs/
│   ├── informe/                    # informe y exposición del Avance 2
│   ├── diagramas/                  # capas, C4 (niveles 1–4) y navegación (.drawio + .png)
│   ├── modelos/                    # modelos de la base de datos
│   └── prototipos/                 # pantallas de la interfaz (PC, 1440 px)
├── backend/                        # API REST (Fase 3)
└── frontend/                       # SPA React (Fase 3)
```

## Estado del avance

El cuadro siguiente corresponde a la planificación original del Avance 2. La implementación actual se sigue por entregas verificables en [la bitácora](docs/avance-implementacion.md). La Parte 1 incorpora la base HTTP del backend. Azure SQL y Entra ID son las decisiones objetivo del demo; las referencias a SQLite/PostgreSQL y bcrypt de este documento describen el diseño anterior y se actualizarán al integrar esas partes.

| Fase | Periodo | Estado |
| --- | --- | --- |
| 1. Análisis y planificación | 20/08 – 17/09 | Completada |
| 2. Diseño: requerimientos, arquitectura, patrones, C4, base de datos y prototipos | 17/09 – 15/10 | Completada (Avance 2) |
| 3. Desarrollo e integración del backend y el frontend | 15/10 – 11/11 | Pendiente |
| 4. Pruebas funcionales | 12/11 – 25/11 | Pendiente |

## Cómo crear la base de datos del Avance 2 (histórico)

**No usar estos pasos SQLite para la implementación actual Azure/SQL Server.** Para el demo vigente seguir [la Parte 2](docs/parte-02-inventario.md) y las migraciones del backend. Se conserva el siguiente procedimiento únicamente como antecedente del curso.

1. Abre **DBeaver** y crea una conexión **SQLite** apuntando a un archivo nuevo, por ejemplo `jorge_motors.db`.
2. En *Driver properties* activa `foreign_keys = true`.
3. Abre `database/schema.sql` en un editor SQL de esa conexión y ejecútalo con **Alt+X**.
4. (Opcional) Ejecuta `database/pruebas/datos_prueba.sql` para cargar datos de ejemplo y luego `pruebas_integridad.sql`.

Resultado esperado: 7 tablas, 8 índices, 5 triggers y 2 vistas. El archivo `.db` no se sube al repositorio: cada integrante lo genera con el script.

## Forma de trabajo

- Cada integrante trabaja en su propia rama (`feature/<tema>`).
- Los cambios se integran a `main` mediante Pull Request revisado por otro integrante.
