# Modelos de la base de datos

| Archivo | Modelo | Herramienta |
| --- | --- | --- |
| `modelo_conceptual` | Conceptual (notación de Chen): 12 entidades y 15 relaciones | draw.io |
| `modelo_logico` | Lógico relacional (PK, FK, UQ y cardinalidades en pata de gallo) | draw.io |
| `modelo_fisico` | Físico en SQL Server / Azure SQL: tipos, CHECK, índices y triggers | draw.io |

Los tres se elaboraron a partir de las migraciones `database/azure-sql/migrations/001` a `008` (esquema `jm`). Si se agrega una migración, actualiza el `.drawio` y exporta el PNG con el mismo nombre.

Los modelos del Avance 2 (Lucidchart y DBeaver sobre SQLite) correspondían al diseño inicial de 7 tablas y fueron reemplazados.
