-- Datos ficticios opcionales para la demostración MANUAL en SQL Server local.
-- No reemplaza productos ni restablece existencias. Ejecutar tras db:migrate.
IF DB_NAME() <> N'jorge_motors_dev' OR CONVERT(int, SERVERPROPERTY('EngineEdition')) IN (5, 8)
    THROW 51010, 'Este ejemplo solo se permite en la base local jorge_motors_dev.', 1;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF NOT EXISTS (SELECT 1 FROM jm.categoria WHERE nombre = N'Demo académico')
    INSERT INTO jm.categoria(nombre) VALUES (N'Demo académico');
IF NOT EXISTS (SELECT 1 FROM jm.producto WHERE sku = 'DEMO-FIL-001')
BEGIN
    INSERT INTO jm.producto(sku, nombre, categoria_id, stock_minimo, precio_compra)
      VALUES ('DEMO-FIL-001', N'Filtro ficticio para demostración',
        (SELECT id FROM jm.categoria WHERE nombre = N'Demo académico'), 2, 20.00);
    INSERT INTO jm.stock(producto_id, cantidad_actual, ubicacion)
      VALUES (CONVERT(int, SCOPE_IDENTITY()), 0, N'DEMO-01');
END;
COMMIT;
SELECT CONVERT(int, p.id) AS producto_id, p.sku, s.cantidad_actual
FROM jm.producto p JOIN jm.stock s ON s.producto_id = p.id WHERE p.sku = 'DEMO-FIL-001';
