-- Auditoría inmutable de negocio y eventos de acceso de la aplicación.
CREATE TABLE jm.auditoria (
    id BIGINT IDENTITY PRIMARY KEY,
    evento_id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() UNIQUE,
    fecha DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    request_id UNIQUEIDENTIFIER NOT NULL,
    accion VARCHAR(40) NOT NULL,
    resultado VARCHAR(10) NOT NULL CHECK (resultado IN ('EXITO', 'RECHAZADO', 'ERROR')),
    usuario_id INT NULL REFERENCES jm.usuario(id),
    entra_tenant_id UNIQUEIDENTIFIER NULL,
    entra_object_id UNIQUEIDENTIFIER NULL,
    entidad_id VARCHAR(40) NULL,
    codigo VARCHAR(60) NOT NULL,
    http_status INT NOT NULL CHECK (http_status BETWEEN 100 AND 599),
    valores_anteriores NVARCHAR(200) NULL CHECK (valores_anteriores IS NULL OR ISJSON(valores_anteriores) = 1),
    valores_nuevos NVARCHAR(200) NULL CHECK (valores_nuevos IS NULL OR ISJSON(valores_nuevos) = 1)
);
CREATE INDEX ix_auditoria_request ON jm.auditoria(request_id);
CREATE INDEX ix_auditoria_usuario_fecha ON jm.auditoria(usuario_id, fecha);
GO
CREATE TRIGGER jm.tr_auditoria_inmutable ON jm.auditoria
INSTEAD OF UPDATE, DELETE AS
BEGIN
    THROW 51004, 'La auditoria no admite UPDATE ni DELETE ordinarios.', 1;
END;
GO
