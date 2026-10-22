-- Parte 4.1: alertas por ciclo y tareas pendientes durables. No envía correos.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;

CREATE TABLE jm.alerta (
    id INT IDENTITY PRIMARY KEY,
    producto_id INT NOT NULL REFERENCES jm.producto(id),
    movimiento_origen_id INT NOT NULL UNIQUE REFERENCES jm.movimiento(id),
    estado VARCHAR(10) NOT NULL DEFAULT 'PENDIENTE'
      CHECK (estado IN ('PENDIENTE', 'ENVIADA', 'ATENDIDA')),
    stock_detectado INT NOT NULL CHECK (stock_detectado >= 0),
    stock_minimo INT NOT NULL CHECK (stock_minimo >= 0),
    creada_en DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    atendida_en DATETIME2(3) NULL,
    CONSTRAINT ck_alerta_umbral CHECK (stock_detectado <= stock_minimo),
    CONSTRAINT ck_alerta_cierre CHECK (
      (estado = 'ATENDIDA' AND atendida_en IS NOT NULL)
      OR (estado <> 'ATENDIDA' AND atendida_en IS NULL)
    )
);
-- Defensa adicional a los bloqueos por producto: máximo un ciclo abierto.
CREATE UNIQUE INDEX uq_alerta_producto_abierta ON jm.alerta(producto_id)
    WHERE estado <> 'ATENDIDA';

CREATE TABLE jm.notificacion_outbox (
    id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
    alerta_id INT NOT NULL UNIQUE REFERENCES jm.alerta(id),
    tipo VARCHAR(30) NOT NULL CHECK (tipo = 'ALERTA_STOCK_BAJO'),
    version_payload INT NOT NULL DEFAULT 1 CHECK (version_payload = 1),
    payload NVARCHAR(2000) NOT NULL CHECK (ISJSON(payload) = 1),
    estado VARCHAR(12) NOT NULL DEFAULT 'PENDIENTE'
      CHECK (estado IN ('PENDIENTE', 'CANCELADA')),
    creada_en DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    actualizada_en DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX ix_outbox_pendiente ON jm.notificacion_outbox(estado, creada_en);
