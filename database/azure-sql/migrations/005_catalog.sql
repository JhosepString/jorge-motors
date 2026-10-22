-- Catálogo con concurrencia optimista y alertas sin movimientos ficticios.
ALTER TABLE jm.categoria ADD version ROWVERSION NOT NULL;
ALTER TABLE jm.producto ADD version ROWVERSION NOT NULL;
ALTER TABLE jm.stock ADD version ROWVERSION NOT NULL;
ALTER TABLE jm.auditoria ALTER COLUMN valores_anteriores NVARCHAR(2000) NULL;
ALTER TABLE jm.auditoria ALTER COLUMN valores_nuevos NVARCHAR(2000) NULL;
GO
DECLARE @constraint sysname, @statement nvarchar(500);
SELECT @constraint=kc.name FROM sys.key_constraints kc
JOIN sys.index_columns ic ON ic.object_id=kc.parent_object_id AND ic.index_id=kc.unique_index_id
JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
WHERE kc.parent_object_id=OBJECT_ID(N'jm.alerta') AND kc.type='UQ' AND c.name=N'movimiento_origen_id';
IF @constraint IS NULL THROW 51013, 'Falta unicidad del movimiento origen.', 1;
SET @statement=N'ALTER TABLE jm.alerta DROP CONSTRAINT '+QUOTENAME(@constraint);
EXEC sys.sp_executesql @statement;
ALTER TABLE jm.alerta ALTER COLUMN movimiento_origen_id INT NULL;
CREATE UNIQUE INDEX uq_alerta_movimiento_origen ON jm.alerta(movimiento_origen_id)
    WHERE movimiento_origen_id IS NOT NULL;
GO
-- V1 mantiene movimientos; V2 identifica cambios de catálogo sin inventar un movimiento.
DECLARE @constraint sysname, @statement nvarchar(500);
SELECT @constraint=cc.name FROM sys.check_constraints cc
JOIN sys.columns c ON c.object_id=cc.parent_object_id AND c.column_id=cc.parent_column_id
WHERE cc.parent_object_id=OBJECT_ID(N'jm.notificacion_outbox') AND c.name=N'version_payload';
IF @constraint IS NULL THROW 51014, 'Falta restricción de versión Outbox.', 1;
SET @statement=N'ALTER TABLE jm.notificacion_outbox DROP CONSTRAINT '+QUOTENAME(@constraint);
EXEC sys.sp_executesql @statement;
ALTER TABLE jm.notificacion_outbox ADD CONSTRAINT ck_outbox_version CHECK (version_payload IN (1,2));
