-- Cada mecánico reparte un máximo de 20 unidades por producto entre sus equipos.
CREATE TABLE jm.cupo_usuario_dispositivo (
    usuario_id INT NOT NULL REFERENCES jm.usuario(id),
    device_id UNIQUEIDENTIFIER NOT NULL,
    producto_id INT NOT NULL REFERENCES jm.producto(id),
    restante INT NOT NULL CHECK (restante >= 0),
    actualizado_en DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT pk_cupo_usuario_dispositivo PRIMARY KEY (producto_id, usuario_id, device_id),
    CONSTRAINT fk_cupo_usuario_equipo FOREIGN KEY (producto_id, device_id)
      REFERENCES jm.cupo_dispositivo(producto_id, device_id)
);
ALTER TABLE jm.cupo_asignacion ADD usuario_id INT NULL REFERENCES jm.usuario(id);
GO
CREATE TRIGGER jm.tr_cupo_usuario_reserva ON jm.cupo_usuario_dispositivo AFTER INSERT, UPDATE AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (
        SELECT 1 FROM (SELECT DISTINCT producto_id,usuario_id FROM inserted) changed
        OUTER APPLY (SELECT SUM(CONVERT(BIGINT,u.restante)) AS total
                     FROM jm.cupo_usuario_dispositivo u
                     WHERE u.producto_id=changed.producto_id AND u.usuario_id=changed.usuario_id) r
        WHERE COALESCE(r.total,0)>20
    ) THROW 51032, 'El mecánico supera 20 unidades reservadas por producto entre equipos.', 1;
    IF EXISTS (
        SELECT 1 FROM (SELECT DISTINCT producto_id,device_id FROM inserted) changed
        JOIN jm.cupo_dispositivo q ON q.producto_id=changed.producto_id AND q.device_id=changed.device_id
        OUTER APPLY (SELECT SUM(CONVERT(BIGINT,u.restante)) AS total
                     FROM jm.cupo_usuario_dispositivo u
                     WHERE u.producto_id=changed.producto_id AND u.device_id=changed.device_id) r
        WHERE COALESCE(r.total,0)>q.restante
    ) THROW 51033, 'Los cupos de mecánicos superan la reserva del equipo.', 1;
END;
GO
CREATE TRIGGER jm.tr_cupo_equipo_usuarios ON jm.cupo_dispositivo AFTER UPDATE AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (
        SELECT 1 FROM inserted q
        OUTER APPLY (SELECT SUM(CONVERT(BIGINT,u.restante)) AS total
                     FROM jm.cupo_usuario_dispositivo u
                     WHERE u.producto_id=q.producto_id AND u.device_id=q.device_id) r
        WHERE COALESCE(r.total,0)>q.restante
    ) THROW 51034, 'La reserva del equipo no puede bajar del cupo de sus mecánicos.', 1;
END;
