# Documentación

## informe/
- `Informe_Final_Jorge_Motors.docx`: informe actualizado con el sistema implementado (Fase 3).
- `Exposicion_Final_Jorge_Motors.pptx` / `.pdf`: diapositivas de la exposición, con notas del orador.
- `Arquitectura_Objetivo_Jorge_Motors_Equipo.md`: arquitectura objetivo y decisiones para el equipo.

## diagramas/ (draw.io)
Generados a partir del código de `backend/src/` y de las migraciones de `database/azure-sql/`.

| Archivo | Figura |
| --- | --- |
| `fig01_arquitectura_capas` | Arquitectura en capas y ubicación de cada patrón |
| `fig02_c4_contexto` | C4 – Nivel 1: contexto (incluye Microsoft Entra ID y el servicio de correo pendiente) |
| `fig03_c4_contenedores` | C4 – Nivel 2: SPA, API, base de datos, almacén de adjuntos y worker de notificaciones |
| `fig04_c4_componentes` | C4 – Nivel 3: cadena de middlewares, módulos y persistencia de la API |
| `fig05_c4_clases` | C4 – Nivel 4: clases de los patrones GoF y del dominio |
| `fig06_despliegue_azure` | Vista de despliegue objetivo en Azure, con el estado de cada servicio |
| `fig09_navegacion_roles` | Mapa de navegación por rol (Administrador y Mecánico) |

Los `.drawio` se abren en https://app.diagrams.net (Archivo → Abrir desde → Dispositivo). Exporta el PNG con el mismo nombre al modificarlos.

## modelos/
Modelos conceptual (Chen), lógico (pata de gallo) y físico del esquema `jm` (12 tablas, migraciones 001–008), elaborados en draw.io.

## capturas/
Pantallas de la interfaz React implementada, por rol (01–08 Administrador, 09–11 Mecánico). Se tomaron con la API simulada del entorno de pruebas (`frontend/e2e`) y datos de demostración.

## prototipos/
Prototipos de Figma del Avance 2. Se conservan como diseño inicial; la interfaz implementada adaptó sus funciones (ver `parte-06-frontend.md`) y sus pantallas reales están en `capturas/`.

## Bitácora y guías
`avance-implementacion.md` y `parte-0X-*.md` documentan cada parte implementada, sus patrones, pruebas y pendientes.
