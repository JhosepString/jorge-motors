-- Base de datos: Sistema de inventario Jorge Motors (SQLite)

PRAGMA foreign_keys = ON;

-- Borrar objetos si ya existen
DROP VIEW IF EXISTS v_kardex;
DROP VIEW IF EXISTS v_inventario;
DROP TABLE IF EXISTS alerta_stock;
DROP TABLE IF EXISTS movimiento;
DROP TABLE IF EXISTS stock;
DROP TABLE IF EXISTS producto;
DROP TABLE IF EXISTS proveedor;
DROP TABLE IF EXISTS categoria;
DROP TABLE IF EXISTS usuario;

-- Tablas
CREATE TABLE usuario (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nombres         TEXT    NOT NULL,
    apellidos       TEXT    NOT NULL,
    email           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash   TEXT    NOT NULL,
    rol             TEXT    NOT NULL DEFAULT 'MECANICO'
                    CHECK (rol IN ('ADMINISTRADOR', 'MECANICO')),
    activo          BOOLEAN NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    creado_en       DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    actualizado_en  DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE categoria (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    descripcion  TEXT,
    activo       BOOLEAN NOT NULL DEFAULT 1 CHECK (activo IN (0, 1))
);

CREATE TABLE proveedor (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    ruc              TEXT    NOT NULL UNIQUE
                     CHECK (length(ruc) = 11 AND ruc NOT GLOB '*[^0-9]*'),
    razon_social     TEXT    NOT NULL,
    contacto         TEXT,
    telefono         TEXT,
    email            TEXT    COLLATE NOCASE,
    direccion        TEXT,
    ciudad           TEXT,
    canal_preferido  TEXT    NOT NULL DEFAULT 'CORREO'
                     CHECK (canal_preferido IN ('CORREO', 'SMS', 'WHATSAPP')),
    activo           BOOLEAN NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    creado_en        DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (
        (canal_preferido = 'CORREO' AND email IS NOT NULL) OR
        (canal_preferido IN ('SMS', 'WHATSAPP') AND telefono IS NOT NULL)
    )
);

CREATE TABLE producto (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    sku             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    nombre          TEXT    NOT NULL,
    descripcion     TEXT,
    marca           TEXT,
    unidad_medida   TEXT    NOT NULL DEFAULT 'UNIDAD'
                    CHECK (unidad_medida IN ('UNIDAD', 'LITRO', 'GALON', 'JUEGO', 'KIT', 'METRO', 'CAJA')),
    precio_compra   REAL    NOT NULL DEFAULT 0 CHECK (precio_compra >= 0),
    precio_venta    REAL    NOT NULL DEFAULT 0 CHECK (precio_venta  >= 0),
    stock_minimo    INTEGER NOT NULL DEFAULT 0 CHECK (stock_minimo  >= 0),
    categoria_id    INTEGER NOT NULL
                    REFERENCES categoria (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    proveedor_id    INTEGER
                    REFERENCES proveedor (id) ON UPDATE CASCADE ON DELETE SET NULL,
    activo          BOOLEAN NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    creado_en       DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    actualizado_en  DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_producto_categoria ON producto (categoria_id);
CREATE INDEX idx_producto_proveedor ON producto (proveedor_id);
CREATE INDEX idx_producto_nombre    ON producto (nombre COLLATE NOCASE);

CREATE TABLE stock (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id           INTEGER NOT NULL UNIQUE
                          REFERENCES producto (id) ON UPDATE CASCADE ON DELETE CASCADE,
    cantidad_actual       INTEGER NOT NULL DEFAULT 0
                          CHECK (cantidad_actual >= 0),
    ubicacion             TEXT,
    ultima_actualizacion  DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE movimiento (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id       INTEGER NOT NULL
                      REFERENCES producto (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    usuario_id        INTEGER NOT NULL
                      REFERENCES usuario  (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    tipo              TEXT    NOT NULL CHECK (tipo IN ('ENTRADA', 'SALIDA')),
    cantidad          INTEGER NOT NULL CHECK (cantidad > 0),
    stock_anterior    INTEGER NOT NULL CHECK (stock_anterior   >= 0),
    stock_resultante  INTEGER NOT NULL CHECK (stock_resultante >= 0),
    motivo            TEXT,
    referencia        TEXT,
    fecha             DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (
        (tipo = 'ENTRADA' AND stock_resultante = stock_anterior + cantidad) OR
        (tipo = 'SALIDA'  AND stock_resultante = stock_anterior - cantidad)
    )
);

CREATE INDEX idx_movimiento_producto_fecha ON movimiento (producto_id, fecha);
CREATE INDEX idx_movimiento_usuario        ON movimiento (usuario_id);
CREATE INDEX idx_movimiento_fecha          ON movimiento (fecha);

-- Los movimientos no se pueden modificar ni eliminar
CREATE TRIGGER trg_movimiento_no_update
BEFORE UPDATE ON movimiento
BEGIN
    SELECT RAISE(ABORT, 'Los movimientos son inmutables: registre un movimiento correctivo');
END;

CREATE TRIGGER trg_movimiento_no_delete
BEFORE DELETE ON movimiento
BEGIN
    SELECT RAISE(ABORT, 'Los movimientos no se pueden eliminar');
END;

CREATE TABLE alerta_stock (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    producto_id      INTEGER NOT NULL
                     REFERENCES producto  (id) ON UPDATE CASCADE ON DELETE CASCADE,
    proveedor_id     INTEGER
                     REFERENCES proveedor (id) ON UPDATE CASCADE ON DELETE SET NULL,
    stock_detectado  INTEGER NOT NULL CHECK (stock_detectado >= 0),
    stock_minimo     INTEGER NOT NULL CHECK (stock_minimo    >= 0),
    estado           TEXT    NOT NULL DEFAULT 'PENDIENTE'
                     CHECK (estado IN ('PENDIENTE', 'ENVIADA', 'ATENDIDA')),
    canal            TEXT    CHECK (canal IN ('CORREO', 'SMS', 'WHATSAPP')),
    fecha_generada   DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    fecha_enviada    DATETIME,
    fecha_atendida   DATETIME,
    CHECK (estado <> 'ENVIADA'  OR (fecha_enviada  IS NOT NULL AND canal IS NOT NULL)),
    CHECK (estado <> 'ATENDIDA' OR  fecha_atendida IS NOT NULL)
);

-- Solo una alerta abierta por producto
CREATE UNIQUE INDEX uq_alerta_abierta_por_producto
    ON alerta_stock (producto_id)
    WHERE estado IN ('PENDIENTE', 'ENVIADA');

CREATE INDEX idx_alerta_estado ON alerta_stock (estado);

-- Estados permitidos: PENDIENTE -> ENVIADA -> ATENDIDA
CREATE TRIGGER trg_alerta_transicion
BEFORE UPDATE OF estado ON alerta_stock
WHEN NOT (
       OLD.estado = NEW.estado
    OR (OLD.estado = 'PENDIENTE' AND NEW.estado = 'ENVIADA')
    OR (OLD.estado = 'ENVIADA'   AND NEW.estado = 'ATENDIDA')
)
BEGIN
    SELECT RAISE(ABORT, 'Transición de estado de alerta no permitida');
END;

-- Actualizar fecha de modificación
CREATE TRIGGER trg_usuario_actualizado AFTER UPDATE ON usuario
WHEN NEW.actualizado_en = OLD.actualizado_en
BEGIN
    UPDATE usuario SET actualizado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER trg_producto_actualizado AFTER UPDATE ON producto
WHEN NEW.actualizado_en = OLD.actualizado_en
BEGIN
    UPDATE producto SET actualizado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- Vistas para reportes
CREATE VIEW v_inventario AS
SELECT  p.id               AS producto_id,
        p.sku,
        p.nombre,
        c.nombre           AS categoria,
        pr.razon_social    AS proveedor,
        s.cantidad_actual,
        p.stock_minimo,
        s.ubicacion,
        p.precio_compra,
        ROUND(s.cantidad_actual * p.precio_compra, 2) AS valor_inventario,
        CASE
            WHEN s.cantidad_actual = 0              THEN 'AGOTADO'
            WHEN s.cantidad_actual <  p.stock_minimo THEN 'CRITICO'
            ELSE 'NORMAL'
        END                AS estado_stock
FROM    producto  p
JOIN    categoria c  ON c.id = p.categoria_id
JOIN    stock     s  ON s.producto_id = p.id
LEFT JOIN proveedor pr ON pr.id = p.proveedor_id
WHERE   p.activo = 1;

CREATE VIEW v_kardex AS
SELECT  m.id, m.fecha, p.sku, p.nombre AS producto, m.tipo, m.cantidad,
        m.stock_anterior, m.stock_resultante, m.motivo, m.referencia,
        u.nombres || ' ' || u.apellidos AS registrado_por, u.rol
FROM    movimiento m
JOIN    producto   p ON p.id = m.producto_id
JOIN    usuario    u ON u.id = m.usuario_id;

-- Verificar objetos creados
SELECT type AS tipo, name AS nombre, tbl_name AS tabla
FROM sqlite_master
WHERE name NOT LIKE 'sqlite_%'
ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'trigger' THEN 3 ELSE 4 END, name;
