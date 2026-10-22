# Base de datos

La base vigente es **SQL Server 2019** en local y **Azure SQL Database** como destino, con el esquema `jm`. Se crea con migraciones versionadas en `azure-sql/migrations/` y se accede desde el backend con `node-mssql`.

## Migraciones

| Migración | Contenido |
| --- | --- |
| `001_inventory` | Esquema `jm`; `usuario`, `categoria`, `producto`, `stock`, `movimiento`; historial inmutable |
| `002_audit` | `auditoria` inmutable |
| `003_alerts_outbox` | `alerta` y `notificacion_outbox`; una sola alerta abierta por producto |
| `004_outbox_worker` | Reservas, intentos y estados del worker de notificaciones |
| `005_catalog` | Columnas `version` (ROWVERSION) y alertas originadas por el catálogo |
| `006_suppliers` | `proveedor` |
| `007_purchase_invoices` | `factura_compra` y `factura_compra_linea`; documentos finalizados inmutables |
| `008_invoice_attachments` | `factura_adjunto` |

Una migración aplicada no se edita: cada cambio va en una migración nueva. Las versiones aplicadas se registran en `dbo.jm_schema_migrations`.

## Cómo crear la base local

1. En SSMS (o `sqlcmd`), crea la base vacía: `CREATE DATABASE [jorge_motors_dev];`
2. En `backend/`, copia `.env.example` a `.env` (`SQL_DRIVER=windows`, `SQL_SERVER=localhost`, `SQL_DATABASE=jorge_motors_dev`).
3. Ejecuta `pnpm.cmd db:migrate`. No ejecutes los `.sql` a mano: la migración 001 rechaza un esquema `jm` existente.

Detalle de la conexión a Azure SQL con identidad administrada: `docs/parte-08-azure-sql.md`.

## Reglas principales

- El stock nunca queda negativo y cada movimiento cuadra (resultante = anterior ± cantidad).
- Movimientos y auditoría no admiten UPDATE ni DELETE (triggers); los errores se corrigen con un movimiento compensatorio.
- Una sola alerta abierta por producto (índice único filtrado).
- Repetir una solicitud con la misma clave de idempotencia no duplica el movimiento ni la recepción.
- Las ediciones usan ROWVERSION: una versión antigua se rechaza (412).
- Las facturas recibidas o anuladas y los adjuntos confirmados son inmutables.

## Archivos históricos (Avance 2)

`schema.sql`, `schema.prisma` y `pruebas/*.sql` corresponden al diseño inicial en SQLite con Prisma (7 tablas). Se conservan como antecedente y **no** deben usarse para crear la base actual.
