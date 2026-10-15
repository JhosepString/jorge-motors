# Sistema de Gestión de Inventario "Jorge Motors"

Plataforma web para gestionar el inventario de la mecánica automotriz **Jorge Motors** (Pueblo Nuevo, Chincha, Ica). Reemplaza el control en hojas de Excel por un sistema que actualiza el stock en cada entrada o salida, guarda el historial de movimientos y avisa automáticamente al proveedor cuando un repuesto queda por debajo de su stock mínimo.

Proyecto del curso **Arquitectura de Software** — Universidad Nacional de Cañete.
Docente: Mg. Luis Enrique Ramírez Pacheco.

## Integrantes

- Castillo Canales, Korayma Anaís
- Hernández Hernández, José Antonio
- Neyra Quiroz, José Guillermo
- Rojas Castillo, Sebastián Jaren

## Arquitectura

- **Estilo:** monolito modular con arquitectura en capas (presentación → negocio → datos).
- **Modelado:** modelo C4 en cuatro niveles (contexto, contenedores, componentes y código).
- **Patrones GoF:** Singleton, Facade, Observer, Strategy, State y Chain of Responsibility.
- **Patrones arquitectónicos:** capas, cliente-servidor / API REST, Repository, Event-Driven y Pipe and Filter.

## Tecnologías

| Capa | Tecnología |
| --- | --- |
| Frontend | React, Vite, TypeScript |
| Backend | Node.js, Express, TypeScript |
| Persistencia | Prisma ORM |
| Base de datos | SQLite (desarrollo) / PostgreSQL (producción) |
| Seguridad | JWT, bcryptjs, Zod, CORS |

| Herramientas de diseño | Uso |
| --- | --- |
| draw.io | Arquitectura en capas, modelo C4 y mapa de navegación |
| Lucidchart | Modelos conceptual y lógico de la base de datos |
| DBeaver | Ejecución del script SQL y modelo físico |
| Figma | Prototipos de la interfaz |

## Estructura del repositorio

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

| Fase | Periodo | Estado |
| --- | --- | --- |
| 1. Análisis y planificación | 20/08 – 17/09 | Completada |
| 2. Diseño: requerimientos, arquitectura, patrones, C4, base de datos y prototipos | 17/09 – 15/10 | Completada (Avance 2) |
| 3. Desarrollo e integración del backend y el frontend | 15/10 – 11/11 | Pendiente |
| 4. Pruebas funcionales | 12/11 – 25/11 | Pendiente |

## Cómo crear la base de datos

1. Abre **DBeaver** y crea una conexión **SQLite** apuntando a un archivo nuevo, por ejemplo `jorge_motors.db`.
2. En *Driver properties* activa `foreign_keys = true`.
3. Abre `database/schema.sql` en un editor SQL de esa conexión y ejecútalo con **Alt+X**.
4. (Opcional) Ejecuta `database/pruebas/datos_prueba.sql` para cargar datos de ejemplo y luego `pruebas_integridad.sql`.

Resultado esperado: 7 tablas, 8 índices, 5 triggers y 2 vistas. El archivo `.db` no se sube al repositorio: cada integrante lo genera con el script.

## Forma de trabajo

- Cada integrante trabaja en su propia rama (`feature/<tema>`).
- Los cambios se integran a `main` mediante Pull Request revisado por otro integrante.
