-- Ejecutar en jorge_motors_dev como administrador Entra después de las migraciones.
-- La identidad administrada solo necesita DML; las migraciones usan otra identidad.
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'jorge-motors-api-dev')
  CREATE USER [jorge-motors-api-dev] FROM EXTERNAL PROVIDER;
GO
GRANT SELECT, INSERT, UPDATE ON SCHEMA::jm TO [jorge-motors-api-dev];
GRANT DELETE ON OBJECT::jm.factura_compra_linea TO [jorge-motors-api-dev];
