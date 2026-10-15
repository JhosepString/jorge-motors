-- Pruebas de integridad (ejecutar después de schema.sql y datos_prueba.sql)
-- P1 debe ejecutarse; P2 a P8 deben ser rechazadas por la base de datos.
PRAGMA foreign_keys = ON;

-- P1. Salida atómica (lo que hará InventarioFacade.registrarSalida) — DEBE FUNCIONAR
--     Producto 1 (REP-0001) tiene 5 unidades; se retiran 2.
BEGIN;
UPDATE stock SET cantidad_actual = cantidad_actual - 2,
                 ultima_actualizacion = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE producto_id = 1 AND cantidad_actual >= 2;          -- descuento condicional
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo)
VALUES (1, 2, 'SALIDA', 2, 5, 3, 'Cambio de pastillas — prueba P1');
COMMIT;

-- P2. Stock negativo — DEBE FALLAR (CHECK cantidad_actual >= 0)
UPDATE stock SET cantidad_actual = cantidad_actual - 999 WHERE producto_id = 1;

-- P3. Movimiento con aritmética incorrecta — DEBE FALLAR
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante)
VALUES (1, 2, 'SALIDA', 2, 3, 3);

-- P4. Editar o borrar un movimiento — DEBEN FALLAR (inmutabilidad, RNF-06)
UPDATE movimiento SET cantidad = 1 WHERE id = 1;
DELETE FROM movimiento WHERE id = 1;

-- P5. Segunda alerta abierta para el mismo producto — DEBE FALLAR (sin avisos duplicados)
INSERT INTO alerta_stock (producto_id, proveedor_id, stock_detectado, stock_minimo)
SELECT producto_id, proveedor_id, 0, 1 FROM alerta_stock WHERE estado = 'PENDIENTE' LIMIT 1;

-- P6. Saltar de PENDIENTE a ATENDIDA — DEBE FALLAR (patrón State)
UPDATE alerta_stock SET estado = 'ATENDIDA', fecha_atendida = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE estado = 'PENDIENTE';

-- P7. Rol inexistente — DEBE FALLAR (RBAC)
INSERT INTO usuario (nombres, apellidos, email, password_hash, rol)
VALUES ('X', 'Y', 'x@y.pe', 'hash', 'CLIENTE');

-- P8. Producto con categoría inexistente — DEBE FALLAR (FK)
INSERT INTO producto (sku, nombre, categoria_id) VALUES ('ZZZ-0001', 'Prueba', 99);
