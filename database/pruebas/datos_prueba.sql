-- Datos de prueba (ejecutar después de schema.sql)
-- Usuario administrador: admin@jorgemotors.pe / Admin123*
-- Mecánicos: *@jorgemotors.pe / Mecanico123*
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

-- Usuarios
INSERT INTO usuario (nombres, apellidos, email, password_hash, rol) VALUES ('Jorge Luis', 'Hernández Padilla', 'admin@jorgemotors.pe', '$2b$10$7r4xQ/Gwgkgs9pd.8TT8fOSmaKj6sALvu7lQkmX1aMwxwv8mjQZOy', 'ADMINISTRADOR');
INSERT INTO usuario (nombres, apellidos, email, password_hash, rol) VALUES ('Carlos', 'Quispe Ramos', 'carlos.quispe@jorgemotors.pe', '$2b$10$AozfVTKe3/Bwp3nnyN6s8OYE.sCJgey.qd2rULvL0lFjDI7l54Bqe', 'MECANICO');
INSERT INTO usuario (nombres, apellidos, email, password_hash, rol) VALUES ('Miguel', 'Torres Huamán', 'miguel.torres@jorgemotors.pe', '$2b$10$AozfVTKe3/Bwp3nnyN6s8OYE.sCJgey.qd2rULvL0lFjDI7l54Bqe', 'MECANICO');

-- Categorías
INSERT INTO categoria (nombre, descripcion) VALUES ('Repuestos', 'Piezas de motor, frenos, suspensión y transmisión');
INSERT INTO categoria (nombre, descripcion) VALUES ('Lubricantes', 'Aceites de motor, caja y refrigerantes');
INSERT INTO categoria (nombre, descripcion) VALUES ('Filtros', 'Filtros de aceite, aire, combustible y cabina');
INSERT INTO categoria (nombre, descripcion) VALUES ('Baterías', 'Baterías de arranque para autos y camionetas');
INSERT INTO categoria (nombre, descripcion) VALUES ('Herramientas', 'Herramientas manuales y de diagnóstico del taller');
INSERT INTO categoria (nombre, descripcion) VALUES ('Accesorios', 'Accesorios eléctricos y de carrocería');
INSERT INTO categoria (nombre, descripcion) VALUES ('Materiales de mantenimiento', 'Grasas, limpiadores, cintas y consumibles');

-- Proveedores
INSERT INTO proveedor (ruc, razon_social, contacto, telefono, email, direccion, ciudad, canal_preferido) VALUES ('20601234561', 'Distribuidora Automotriz del Sur S.A.C.', 'Rosa Medina', '956123401', 'ventas@dasur.pe', 'Av. Benavides 450', 'Chincha Alta', 'CORREO');
INSERT INTO proveedor (ruc, razon_social, contacto, telefono, email, direccion, ciudad, canal_preferido) VALUES ('20512345672', 'Lubricantes Ica E.I.R.L.', 'Pedro Saravia', '956123402', 'pedidos@lubica.pe', 'Calle Lima 120', 'Ica', 'WHATSAPP');
INSERT INTO proveedor (ruc, razon_social, contacto, telefono, email, direccion, ciudad, canal_preferido) VALUES ('20498765433', 'Baterías y Eléctricos Pisco S.R.L.', 'Ana Cárdenas', '956123403', NULL, 'Jr. Comercio 88', 'Pisco', 'SMS');

-- Productos
INSERT INTO producto (sku, nombre, marca, unidad_medida, precio_compra, precio_venta, stock_minimo, categoria_id, proveedor_id) VALUES ('REP-0001', 'Pastillas de freno delanteras', 'Bosch', 'JUEGO', 85.00, 120.00, 4, 1, 1);
INSERT INTO producto (sku, nombre, marca, unidad_medida, precio_compra, precio_venta, stock_minimo, categoria_id, proveedor_id) VALUES ('REP-0002', 'Bujía de iridio', 'NGK', 'UNIDAD', 28.00, 40.00, 8, 1, 1);
INSERT INTO producto (sku, nombre, marca, unidad_medida, precio_compra, precio_venta, stock_minimo, categoria_id, proveedor_id) VALUES ('REP-0003', 'Faja de distribución', 'Gates', 'UNIDAD', 95.00, 140.00, 2, 1, 1);
INSERT INTO producto (sku, nombre, marca, unidad_medida, precio_compra, precio_venta, stock_minimo, categoria_id, proveedor_id) VALUES ('REP-0004', 'Amortiguador delantero', 'Monroe', 'UNIDAD', 160.00, 230.00, 2, 1, 1);
INSERT INTO producto (sku, nombre, marca, unidad_medida, precio_compra, precio_venta, stock_minimo, categoria_id, proveedor_id) VALUES ('LUB-0001', 'Aceite de motor 20W-50', 'Castrol', 'GALON', 75.00, 105.00, 6, 2, 2);
INSERT INTO producto (sku, nombre, marca, unidad_medida, precio_compra, precio_venta, stock_minimo, categoria_id, proveedor_id) VALUES ('LUB-0002', 'Aceite sintético 5W-30', 'Mobil', 'LITRO', 32.00, 45.00, 10, 2, 2);
INSERT INTO producto (sku, nombre, marca, unidad_medida, precio_compra, precio_venta, stock_minimo, categoria_id, proveedor_id) VALUES ('LUB-0003', 'Refrigerante verde', 'Prestone', 'GALON', 38.00, 55.00, 3, 2, 2);
INSERT INTO producto (sku, nombre, marca, unidad_medida, precio_compra, precio_venta, stock_minimo, categoria_id, proveedor_id) VALUES ('FIL-0001', 'Filtro de aceite', 'Wix', 'UNIDAD', 18.00, 28.00, 5, 3, 1);
INSERT INTO producto (sku, nombre, marca, unidad_medida, precio_compra, precio_venta, stock_minimo, categoria_id, proveedor_id) VALUES ('FIL-0002', 'Filtro de aire', 'Fram', 'UNIDAD', 30.00, 45.00, 4, 3, 1);
INSERT INTO producto (sku, nombre, marca, unidad_medida, precio_compra, precio_venta, stock_minimo, categoria_id, proveedor_id) VALUES ('FIL-0003', 'Filtro de combustible', 'Bosch', 'UNIDAD', 35.00, 50.00, 3, 3, 1);
INSERT INTO producto (sku, nombre, marca, unidad_medida, precio_compra, precio_venta, stock_minimo, categoria_id, proveedor_id) VALUES ('BAT-0001', 'Batería 13 placas 12V', 'Etna', 'UNIDAD', 280.00, 360.00, 2, 4, 3);
INSERT INTO producto (sku, nombre, marca, unidad_medida, precio_compra, precio_venta, stock_minimo, categoria_id, proveedor_id) VALUES ('BAT-0002', 'Batería 15 placas 12V', 'Capsa', 'UNIDAD', 330.00, 420.00, 2, 4, 3);
INSERT INTO producto (sku, nombre, marca, unidad_medida, precio_compra, precio_venta, stock_minimo, categoria_id, proveedor_id) VALUES ('HER-0001', 'Juego de llaves mixtas 8-22 mm', 'Stanley', 'JUEGO', 150.00, 0.00, 1, 5, NULL);
INSERT INTO producto (sku, nombre, marca, unidad_medida, precio_compra, precio_venta, stock_minimo, categoria_id, proveedor_id) VALUES ('ACC-0001', 'Foco H4 halógeno', 'Philips', 'UNIDAD', 22.00, 35.00, 6, 6, 3);
INSERT INTO producto (sku, nombre, marca, unidad_medida, precio_compra, precio_venta, stock_minimo, categoria_id, proveedor_id) VALUES ('MAT-0001', 'Grasa multipropósito', 'Shell', 'KIT', 25.00, 38.00, 3, 7, 2);

-- Stock
INSERT INTO stock (producto_id, cantidad_actual, ubicacion) VALUES (1, 5, 'A-01');
INSERT INTO stock (producto_id, cantidad_actual, ubicacion) VALUES (2, 16, 'A-02');
INSERT INTO stock (producto_id, cantidad_actual, ubicacion) VALUES (3, 4, 'A-03');
INSERT INTO stock (producto_id, cantidad_actual, ubicacion) VALUES (4, 1, 'A-04');
INSERT INTO stock (producto_id, cantidad_actual, ubicacion) VALUES (5, 5, 'B-01');
INSERT INTO stock (producto_id, cantidad_actual, ubicacion) VALUES (6, 16, 'B-02');
INSERT INTO stock (producto_id, cantidad_actual, ubicacion) VALUES (7, 5, 'B-03');
INSERT INTO stock (producto_id, cantidad_actual, ubicacion) VALUES (8, 9, 'C-01');
INSERT INTO stock (producto_id, cantidad_actual, ubicacion) VALUES (9, 6, 'C-02');
INSERT INTO stock (producto_id, cantidad_actual, ubicacion) VALUES (10, 2, 'C-03');
INSERT INTO stock (producto_id, cantidad_actual, ubicacion) VALUES (11, 3, 'D-01');
INSERT INTO stock (producto_id, cantidad_actual, ubicacion) VALUES (12, 1, 'D-02');
INSERT INTO stock (producto_id, cantidad_actual, ubicacion) VALUES (13, 2, 'E-01');
INSERT INTO stock (producto_id, cantidad_actual, ubicacion) VALUES (14, 8, 'F-01');
INSERT INTO stock (producto_id, cantidad_actual, ubicacion) VALUES (15, 4, 'G-01');

-- Movimientos
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (1, 1, 'ENTRADA', 10, 0, 10, 'Inventario inicial (migración desde Excel)', 'KARDEX-2026', '2026-10-02T13:30:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (1, 3, 'SALIDA', 3, 10, 7, 'Uso en servicio de mantenimiento', 'OT-103', '2026-10-10T14:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (1, 2, 'SALIDA', 2, 7, 5, 'Uso en servicio de mantenimiento', 'OT-104', '2026-10-11T15:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (2, 1, 'ENTRADA', 24, 0, 24, 'Inventario inicial (migración desde Excel)', 'KARDEX-2026', '2026-10-03T13:30:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (2, 2, 'SALIDA', 4, 24, 20, 'Uso en servicio de mantenimiento', 'OT-106', '2026-10-10T14:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (2, 3, 'SALIDA', 4, 20, 16, 'Uso en servicio de mantenimiento', 'OT-107', '2026-10-11T15:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (3, 1, 'ENTRADA', 5, 0, 5, 'Inventario inicial (migración desde Excel)', 'KARDEX-2026', '2026-10-04T13:30:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (3, 3, 'SALIDA', 1, 5, 4, 'Uso en servicio de mantenimiento', 'OT-109', '2026-10-10T14:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (4, 1, 'ENTRADA', 4, 0, 4, 'Inventario inicial (migración desde Excel)', 'KARDEX-2026', '2026-10-05T13:30:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (4, 2, 'SALIDA', 2, 4, 2, 'Uso en servicio de mantenimiento', 'OT-112', '2026-10-10T14:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (4, 3, 'SALIDA', 1, 2, 1, 'Uso en servicio de mantenimiento', 'OT-113', '2026-10-11T15:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (5, 1, 'ENTRADA', 12, 0, 12, 'Inventario inicial (migración desde Excel)', 'KARDEX-2026', '2026-10-06T13:30:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (5, 3, 'SALIDA', 3, 12, 9, 'Uso en servicio de mantenimiento', 'OT-115', '2026-10-10T14:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (5, 2, 'SALIDA', 2, 9, 7, 'Uso en servicio de mantenimiento', 'OT-116', '2026-10-11T15:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (5, 3, 'SALIDA', 2, 7, 5, 'Uso en servicio de mantenimiento', 'OT-117', '2026-10-12T16:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (6, 1, 'ENTRADA', 20, 0, 20, 'Inventario inicial (migración desde Excel)', 'KARDEX-2026', '2026-10-07T13:30:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (6, 2, 'SALIDA', 4, 20, 16, 'Uso en servicio de mantenimiento', 'OT-118', '2026-10-10T14:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (7, 1, 'ENTRADA', 6, 0, 6, 'Inventario inicial (migración desde Excel)', 'KARDEX-2026', '2026-10-08T13:30:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (7, 3, 'SALIDA', 1, 6, 5, 'Uso en servicio de mantenimiento', 'OT-121', '2026-10-10T14:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (8, 1, 'ENTRADA', 15, 0, 15, 'Inventario inicial (migración desde Excel)', 'KARDEX-2026', '2026-10-09T13:30:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (8, 2, 'SALIDA', 3, 15, 12, 'Uso en servicio de mantenimiento', 'OT-124', '2026-10-10T14:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (8, 3, 'SALIDA', 3, 12, 9, 'Uso en servicio de mantenimiento', 'OT-125', '2026-10-11T15:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (9, 1, 'ENTRADA', 8, 0, 8, 'Inventario inicial (migración desde Excel)', 'KARDEX-2026', '2026-10-01T13:30:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (9, 3, 'SALIDA', 2, 8, 6, 'Uso en servicio de mantenimiento', 'OT-127', '2026-10-10T14:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (10, 1, 'ENTRADA', 4, 0, 4, 'Inventario inicial (migración desde Excel)', 'KARDEX-2026', '2026-10-02T13:30:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (10, 2, 'SALIDA', 2, 4, 2, 'Uso en servicio de mantenimiento', 'OT-130', '2026-10-10T14:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (11, 1, 'ENTRADA', 4, 0, 4, 'Inventario inicial (migración desde Excel)', 'KARDEX-2026', '2026-10-03T13:30:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (11, 3, 'SALIDA', 1, 4, 3, 'Uso en servicio de mantenimiento', 'OT-133', '2026-10-10T14:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (12, 1, 'ENTRADA', 3, 0, 3, 'Inventario inicial (migración desde Excel)', 'KARDEX-2026', '2026-10-04T13:30:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (12, 2, 'SALIDA', 2, 3, 1, 'Uso en servicio de mantenimiento', 'OT-136', '2026-10-10T14:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (13, 1, 'ENTRADA', 2, 0, 2, 'Inventario inicial (migración desde Excel)', 'KARDEX-2026', '2026-10-05T13:30:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (14, 1, 'ENTRADA', 12, 0, 12, 'Inventario inicial (migración desde Excel)', 'KARDEX-2026', '2026-10-06T13:30:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (14, 2, 'SALIDA', 4, 12, 8, 'Uso en servicio de mantenimiento', 'OT-142', '2026-10-10T14:15:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (15, 1, 'ENTRADA', 6, 0, 6, 'Inventario inicial (migración desde Excel)', 'KARDEX-2026', '2026-10-07T13:30:00.000Z');
INSERT INTO movimiento (producto_id, usuario_id, tipo, cantidad, stock_anterior, stock_resultante, motivo, referencia, fecha) VALUES (15, 3, 'SALIDA', 2, 6, 4, 'Uso en servicio de mantenimiento', 'OT-145', '2026-10-10T14:15:00.000Z');

-- Alertas
INSERT INTO alerta_stock (producto_id, proveedor_id, stock_detectado, stock_minimo, estado, canal, fecha_generada, fecha_enviada, fecha_atendida) VALUES (4, 1, 1, 2, 'PENDIENTE', NULL, '2026-10-11T14:16:00.000Z', NULL, NULL);
INSERT INTO alerta_stock (producto_id, proveedor_id, stock_detectado, stock_minimo, estado, canal, fecha_generada, fecha_enviada, fecha_atendida) VALUES (5, 2, 5, 6, 'ENVIADA', 'WHATSAPP', '2026-10-11T14:16:00.000Z', '2026-10-11T15:00:00.000Z', NULL);
INSERT INTO alerta_stock (producto_id, proveedor_id, stock_detectado, stock_minimo, estado, canal, fecha_generada, fecha_enviada, fecha_atendida) VALUES (10, 1, 2, 3, 'PENDIENTE', NULL, '2026-10-11T14:16:00.000Z', NULL, NULL);
INSERT INTO alerta_stock (producto_id, proveedor_id, stock_detectado, stock_minimo, estado, canal, fecha_generada, fecha_enviada, fecha_atendida) VALUES (12, 3, 1, 2, 'ENVIADA', 'SMS', '2026-10-11T14:16:00.000Z', '2026-10-11T15:00:00.000Z', NULL);

COMMIT;
