-- Datos ficticios opcionales para la demostración MANUAL en SQL Server local.
-- No reemplaza productos ni restablece existencias. Ejecutar tras db:migrate.
IF DB_NAME() <> N'jorge_motors_dev' OR CONVERT(int, SERVERPROPERTY('EngineEdition')) IN (5, 8)
    THROW 51010, 'Este ejemplo solo se permite en la base local jorge_motors_dev.', 1;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
-- NCHAR evita que sqlcmd con una página de códigos distinta altere las tildes.
DECLARE @categoriaDemo nvarchar(100) = N'Demo acad' + NCHAR(233) + N'mico';
DECLARE @productoDemo nvarchar(200) = N'Filtro ficticio para demostraci' + NCHAR(243) + N'n';
IF NOT EXISTS (SELECT 1 FROM jm.categoria WHERE nombre = @categoriaDemo)
    INSERT INTO jm.categoria(nombre) VALUES (@categoriaDemo);
IF NOT EXISTS (SELECT 1 FROM jm.producto WHERE sku = 'DEMO-FIL-001')
BEGIN
    INSERT INTO jm.producto(sku, nombre, categoria_id, stock_minimo, precio_compra)
      VALUES ('DEMO-FIL-001', @productoDemo,
        (SELECT id FROM jm.categoria WHERE nombre = @categoriaDemo), 2, 20.00);
    INSERT INTO jm.stock(producto_id, cantidad_actual, ubicacion)
      VALUES (CONVERT(int, SCOPE_IDENTITY()), 0, N'DEMO-01');
END;
COMMIT;
SELECT CONVERT(int, p.id) AS producto_id, p.sku, s.cantidad_actual
FROM jm.producto p JOIN jm.stock s ON s.producto_id = p.id WHERE p.sku = 'DEMO-FIL-001';
