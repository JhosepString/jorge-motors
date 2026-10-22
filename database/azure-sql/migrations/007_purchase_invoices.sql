-- Registro interno de compras en PEN. No es emisión ni validación tributaria.
CREATE TABLE jm.factura_compra (
    id INT IDENTITY PRIMARY KEY,
    proveedor_id INT NOT NULL REFERENCES jm.proveedor(id),
    proveedor_codigo VARCHAR(40) NOT NULL,
    proveedor_nombre NVARCHAR(150) NOT NULL,
    numero VARCHAR(40) NOT NULL,
    fecha DATE NOT NULL,
    moneda CHAR(3) NOT NULL DEFAULT 'PEN' CHECK (moneda='PEN'),
    total DECIMAL(18,2) NOT NULL CHECK (total>=0),
    estado VARCHAR(10) NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN ('BORRADOR','RECIBIDA','ANULADA')),
    usuario_creacion_id INT NOT NULL REFERENCES jm.usuario(id),
    usuario_recepcion_id INT NULL REFERENCES jm.usuario(id),
    recibida_en DATETIME2(3) NULL,
    clave_recepcion UNIQUEIDENTIFIER NULL,
    version_confirmacion CHAR(16) NULL,
    version ROWVERSION NOT NULL,
    CONSTRAINT uq_factura_proveedor_numero UNIQUE(proveedor_id,numero),
    CONSTRAINT ck_factura_recepcion CHECK (
      (estado='RECIBIDA' AND usuario_recepcion_id IS NOT NULL AND recibida_en IS NOT NULL
        AND clave_recepcion IS NOT NULL AND version_confirmacion IS NOT NULL)
      OR (estado<>'RECIBIDA' AND usuario_recepcion_id IS NULL AND recibida_en IS NULL
        AND clave_recepcion IS NULL AND version_confirmacion IS NULL))
);
CREATE UNIQUE INDEX uq_factura_recepcion_clave ON jm.factura_compra(usuario_recepcion_id,clave_recepcion)
  WHERE clave_recepcion IS NOT NULL;
CREATE TABLE jm.factura_compra_linea (
    factura_id INT NOT NULL REFERENCES jm.factura_compra(id),
    producto_id INT NOT NULL REFERENCES jm.producto(id),
    sku VARCHAR(40) NOT NULL,
    nombre NVARCHAR(150) NOT NULL,
    cantidad INT NOT NULL CHECK (cantidad>0),
    precio_unitario DECIMAL(18,2) NOT NULL CHECK (precio_unitario>=0),
    importe DECIMAL(18,2) NOT NULL CHECK (importe>=0),
    clave_movimiento UNIQUEIDENTIFIER NOT NULL UNIQUE,
    movimiento_id INT NULL REFERENCES jm.movimiento(id),
    PRIMARY KEY(factura_id,producto_id),
    CONSTRAINT ck_factura_linea_importe CHECK (
      CONVERT(decimal(38,2),importe)=CONVERT(decimal(38,2),precio_unitario)*cantidad)
);
CREATE UNIQUE INDEX uq_factura_linea_movimiento ON jm.factura_compra_linea(movimiento_id)
  WHERE movimiento_id IS NOT NULL;
GO
CREATE TRIGGER jm.tr_factura_historia ON jm.factura_compra AFTER INSERT, UPDATE, DELETE AS
BEGIN
    IF EXISTS (SELECT 1 FROM inserted i LEFT JOIN deleted d ON d.id=i.id WHERE d.id IS NULL AND i.estado<>'BORRADOR')
      THROW 51020,'Toda factura se registra primero como borrador.',1;
    IF EXISTS (SELECT 1 FROM deleted WHERE estado<>'BORRADOR')
      OR EXISTS (SELECT 1 FROM deleted d LEFT JOIN inserted i ON i.id=d.id WHERE i.id IS NULL)
      THROW 51020,'No se elimina una factura ni se modifica un documento finalizado.',1;
    IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON i.id=d.id WHERE
      i.proveedor_id<>d.proveedor_id OR i.numero<>d.numero OR i.usuario_creacion_id<>d.usuario_creacion_id
      OR i.proveedor_codigo<>d.proveedor_codigo OR i.proveedor_nombre<>d.proveedor_nombre OR i.moneda<>d.moneda)
      THROW 51020,'La identidad e instantáneas del proveedor son inmutables.',1;
    IF EXISTS (SELECT 1 FROM inserted i WHERE i.estado='RECIBIDA' AND
      (NOT EXISTS (SELECT 1 FROM jm.factura_compra_linea l WHERE l.factura_id=i.id)
       OR EXISTS (SELECT 1 FROM jm.factura_compra_linea l WHERE l.factura_id=i.id AND l.movimiento_id IS NULL)
       OR EXISTS (SELECT 1 FROM jm.factura_compra_linea l JOIN jm.movimiento m ON m.id=l.movimiento_id
         WHERE l.factura_id=i.id AND m.usuario_id<>i.usuario_recepcion_id)
       OR i.total<>(SELECT SUM(l.importe) FROM jm.factura_compra_linea l WHERE l.factura_id=i.id)))
      THROW 51020,'No se confirma una factura incompleta.',1;
END;
GO
CREATE TRIGGER jm.tr_factura_linea_historia ON jm.factura_compra_linea AFTER INSERT, UPDATE, DELETE AS
BEGIN
    IF EXISTS (SELECT 1 FROM jm.factura_compra f JOIN
      (SELECT factura_id FROM inserted UNION SELECT factura_id FROM deleted) l ON l.factura_id=f.id
      WHERE f.estado<>'BORRADOR')
      THROW 51020,'Los detalles de documentos finalizados son inmutables.',1;
    IF EXISTS (SELECT 1 FROM inserted l JOIN jm.movimiento m ON m.id=l.movimiento_id
      WHERE m.tipo<>'ENTRADA' OR m.producto_id<>l.producto_id OR m.cantidad<>l.cantidad
        OR m.clave_idempotencia<>l.clave_movimiento)
      THROW 51020,'El movimiento no corresponde al detalle.',1;
END;
GO
