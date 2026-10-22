-- Proveedores son contactos de compra, no identidades de acceso.
CREATE TABLE jm.proveedor (
    id INT IDENTITY PRIMARY KEY,
    codigo VARCHAR(40) NOT NULL,
    razon_social NVARCHAR(150) NOT NULL,
    correo NVARCHAR(254) NULL,
    activo BIT NOT NULL DEFAULT 1,
    version ROWVERSION NOT NULL,
    CONSTRAINT uq_proveedor_codigo UNIQUE(codigo),
    CONSTRAINT ck_proveedor_codigo CHECK (LEN(codigo)>0),
    CONSTRAINT ck_proveedor_nombre CHECK (LEN(LTRIM(RTRIM(razon_social)))>0)
);
