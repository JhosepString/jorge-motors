-- Parte 2: esquema inicial compatible con SQL Server 2019 y Azure SQL.
-- Ejecutar en una base exclusiva del proyecto, nunca en master.
-- No borra objetos. La herramienta de migraciones controla su aplicación.
IF DB_NAME() IN (N'master', N'model', N'msdb', N'tempdb')
    THROW 51000, 'Seleccione una base exclusiva del proyecto.', 1;
IF SCHEMA_ID(N'jm') IS NOT NULL
    THROW 51001, 'El esquema jm ya existe. Use el registro de migraciones.', 1;
EXEC(N'CREATE SCHEMA jm');
GO
CREATE TABLE jm.usuario (
    id INT IDENTITY PRIMARY KEY,
    entra_tenant_id UNIQUEIDENTIFIER NOT NULL,
    entra_object_id UNIQUEIDENTIFIER NOT NULL,
    nombres NVARCHAR(150) NOT NULL,
    rol VARCHAR(20) NOT NULL CHECK (rol IN ('ADMINISTRADOR', 'MECANICO')),
    activo BIT NOT NULL DEFAULT 1,
    CONSTRAINT uq_usuario_entra UNIQUE(entra_tenant_id, entra_object_id)
);
CREATE TABLE jm.categoria (
    id INT IDENTITY PRIMARY KEY,
    nombre NVARCHAR(100) NOT NULL UNIQUE
);
CREATE TABLE jm.producto (
    id INT IDENTITY PRIMARY KEY,
    sku VARCHAR(40) NOT NULL UNIQUE,
    nombre NVARCHAR(150) NOT NULL,
    categoria_id INT NOT NULL REFERENCES jm.categoria(id),
    stock_minimo INT NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
    precio_compra DECIMAL(18,2) NOT NULL DEFAULT 0 CHECK (precio_compra >= 0),
    activo BIT NOT NULL DEFAULT 1
);
CREATE TABLE jm.stock (
    producto_id INT NOT NULL PRIMARY KEY REFERENCES jm.producto(id),
    cantidad_actual INT NOT NULL DEFAULT 0 CHECK (cantidad_actual >= 0),
    ubicacion NVARCHAR(120) NULL,
    ultima_actualizacion DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE jm.movimiento (
    id INT IDENTITY PRIMARY KEY,
    producto_id INT NOT NULL REFERENCES jm.producto(id),
    usuario_id INT NOT NULL REFERENCES jm.usuario(id),
    tipo VARCHAR(7) NOT NULL CHECK (tipo IN ('ENTRADA', 'SALIDA')),
    cantidad INT NOT NULL CHECK (cantidad > 0),
    stock_anterior INT NOT NULL CHECK (stock_anterior >= 0),
    stock_resultante INT NOT NULL CHECK (stock_resultante >= 0),
    motivo NVARCHAR(300) NOT NULL,
    referencia NVARCHAR(120) NULL,
    clave_idempotencia UNIQUEIDENTIFIER NOT NULL,
    request_hash CHAR(64) NOT NULL,
    fecha DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT uq_movimiento_idempotencia UNIQUE(usuario_id, clave_idempotencia),
    CONSTRAINT ck_movimiento_saldo CHECK (
      (tipo = 'ENTRADA' AND CONVERT(BIGINT, stock_resultante) = CONVERT(BIGINT, stock_anterior) + cantidad)
      OR (tipo = 'SALIDA' AND CONVERT(BIGINT, stock_resultante) = CONVERT(BIGINT, stock_anterior) - cantidad)
    )
);
CREATE INDEX ix_movimiento_producto_fecha ON jm.movimiento(producto_id, fecha);
GO
CREATE TRIGGER jm.tr_movimiento_inmutable ON jm.movimiento
INSTEAD OF UPDATE, DELETE AS
BEGIN
    THROW 51002, 'Los movimientos son inmutables; registre uno compensatorio.', 1;
END;
GO
