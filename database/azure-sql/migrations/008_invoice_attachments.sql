-- Registro durable ANTES de escribir el objeto externo; sin transacción distribuida.
CREATE TABLE jm.factura_adjunto (
    id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    factura_id INT NOT NULL REFERENCES jm.factura_compra(id),
    nombre NVARCHAR(110) NOT NULL,
    content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('application/pdf','image/png','image/jpeg')),
    bytes INT NOT NULL CHECK (bytes BETWEEN 1 AND 5242880),
    sha256 CHAR(64) NOT NULL,
    estado VARCHAR(10) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','LISTO','ELIMINADO')),
    usuario_id INT NOT NULL REFERENCES jm.usuario(id),
    clave UNIQUEIDENTIFIER NOT NULL,
    creado_en DATETIME2(3) NOT NULL DEFAULT CONVERT(datetime2(3),SYSUTCDATETIME()),
    CONSTRAINT uq_adjunto_clave UNIQUE(usuario_id,clave)
);
CREATE INDEX ix_adjunto_factura ON jm.factura_adjunto(factura_id,estado);
CREATE INDEX ix_adjunto_pendiente ON jm.factura_adjunto(estado,creado_en);
GO
CREATE TRIGGER jm.tr_adjunto_historia ON jm.factura_adjunto AFTER UPDATE, DELETE AS
BEGIN
    IF EXISTS (SELECT 1 FROM deleted d LEFT JOIN inserted i ON i.id=d.id WHERE i.id IS NULL)
      OR EXISTS (SELECT 1 FROM deleted WHERE estado<>'PENDIENTE')
      THROW 51021,'No se borra la trazabilidad ni se modifica un adjunto finalizado.',1;
    IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON i.id=d.id WHERE
      i.factura_id<>d.factura_id OR i.nombre<>d.nombre OR i.content_type<>d.content_type OR i.bytes<>d.bytes
      OR i.sha256<>d.sha256 OR i.usuario_id<>d.usuario_id OR i.clave<>d.clave OR i.creado_en<>d.creado_en)
      THROW 51021,'Los metadatos del adjunto son inmutables.',1;
END;
GO
