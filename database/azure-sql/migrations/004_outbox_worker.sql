-- Incremental: no editar la migración 003 ya aplicada.
-- El CHECK original de estado recibió nombre automático; resolverlo por columna.
DECLARE @check sysname;
SELECT @check = cc.name FROM sys.check_constraints cc
JOIN sys.columns c ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id
WHERE cc.parent_object_id = OBJECT_ID(N'jm.notificacion_outbox') AND c.name = N'estado';
IF @check IS NULL THROW 51011, 'No se encontró la restricción de estado Outbox.', 1;
DECLARE @statement nvarchar(500) = N'ALTER TABLE jm.notificacion_outbox DROP CONSTRAINT ' + QUOTENAME(@check);
EXEC sys.sp_executesql @statement;
GO
ALTER TABLE jm.notificacion_outbox ADD
    intentos INT NOT NULL CONSTRAINT df_outbox_intentos DEFAULT 0,
    disponible_en DATETIME2(3) NOT NULL CONSTRAINT df_outbox_disponible DEFAULT SYSUTCDATETIME(),
    lease_token UNIQUEIDENTIFIER NULL,
    lease_hasta DATETIME2(3) NULL,
    aceptada_en DATETIME2(3) NULL,
    proveedor_id NVARCHAR(200) NULL,
    ultimo_error VARCHAR(40) NULL;
GO
ALTER TABLE jm.notificacion_outbox ADD
    CONSTRAINT ck_outbox_estado CHECK (estado IN ('PENDIENTE','PROCESANDO','ENVIADA','CANCELADA','AGOTADA')),
    CONSTRAINT ck_outbox_intentos CHECK (intentos BETWEEN 0 AND 5),
    CONSTRAINT ck_outbox_lease CHECK (
      (estado = 'PROCESANDO' AND lease_token IS NOT NULL AND lease_hasta IS NOT NULL)
      OR (estado <> 'PROCESANDO' AND lease_token IS NULL AND lease_hasta IS NULL)),
    CONSTRAINT ck_outbox_aceptacion CHECK (
      (estado = 'ENVIADA' AND aceptada_en IS NOT NULL AND proveedor_id IS NOT NULL)
      OR (estado <> 'ENVIADA' AND aceptada_en IS NULL AND proveedor_id IS NULL));
CREATE INDEX ix_outbox_dispatch ON jm.notificacion_outbox(estado, disponible_en, lease_hasta)
    INCLUDE(intentos, alerta_id);
