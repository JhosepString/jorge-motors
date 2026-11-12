-- Reservas de stock para equipos que pueden operar sin conexión.
CREATE TABLE jm.cupo_dispositivo (
    device_id UNIQUEIDENTIFIER NOT NULL,
    producto_id INT NOT NULL REFERENCES jm.producto(id),
    restante INT NOT NULL CHECK (restante >= 0),
    actualizado_en DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_cupo_dispositivo PRIMARY KEY (producto_id, device_id)
);
CREATE TABLE jm.sync_receipt (
    operation_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    device_id UNIQUEIDENTIFIER NOT NULL,
    usuario_id INT NOT NULL REFERENCES jm.usuario(id),
    request_hash CHAR(64) NOT NULL,
    movimiento_id INT NOT NULL UNIQUE REFERENCES jm.movimiento(id),
    creado_en DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE TABLE jm.cupo_asignacion (
    allocation_id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
    device_id UNIQUEIDENTIFIER NOT NULL,
    producto_id INT NOT NULL REFERENCES jm.producto(id),
    cantidad INT NOT NULL CHECK (cantidad > 0),
    restante_resultante INT NOT NULL CHECK (restante_resultante >= 0),
    creado_en DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
GO
-- La regla también protege escrituras de stock fuera de las rutas HTTP normales.
CREATE TRIGGER jm.tr_stock_reserva ON jm.stock AFTER INSERT, UPDATE AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (
        SELECT 1 FROM inserted s
        OUTER APPLY (SELECT SUM(CONVERT(BIGINT, q.restante)) AS total
                     FROM jm.cupo_dispositivo q WHERE q.producto_id=s.producto_id) r
        WHERE CONVERT(BIGINT, s.cantidad_actual) < COALESCE(r.total, 0)
    ) THROW 51030, 'El stock no puede ser menor que los cupos reservados.', 1;
END;
GO
CREATE TRIGGER jm.tr_cupo_reserva ON jm.cupo_dispositivo AFTER INSERT, UPDATE AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (
        SELECT 1 FROM (SELECT DISTINCT producto_id FROM inserted) changed
        JOIN jm.stock s ON s.producto_id=changed.producto_id
        OUTER APPLY (SELECT SUM(CONVERT(BIGINT, q.restante)) AS total
                     FROM jm.cupo_dispositivo q WHERE q.producto_id=changed.producto_id) r
        WHERE COALESCE(r.total, 0) > CONVERT(BIGINT, s.cantidad_actual)
    ) THROW 51031, 'La suma de cupos no puede superar el stock.', 1;
END;
GO
