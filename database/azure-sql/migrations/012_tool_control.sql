-- Las herramientas son bienes retornables: una salida de consumo no es un préstamo.
ALTER TABLE jm.producto ADD tipo VARCHAR(12) NOT NULL
  CONSTRAINT df_producto_tipo DEFAULT 'REPUESTO'
  CONSTRAINT ck_producto_tipo CHECK (tipo IN ('REPUESTO','HERRAMIENTA','CONSUMIBLE'));
GO
UPDATE jm.producto SET tipo='HERRAMIENTA'
WHERE sku LIKE 'SIM-HMA-%' OR sku LIKE 'SIM-HMO-%' OR sku LIKE 'SIM-DIA-%'
   OR sku LIKE 'SIM-ELEVA-%' OR sku LIKE 'SIM-TAL-%';
UPDATE jm.producto SET tipo='CONSUMIBLE' WHERE sku LIKE 'SIM-CON-%';
GO
CREATE TRIGGER jm.tr_bloquear_salida_herramienta ON jm.movimiento
AFTER INSERT AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM inserted i JOIN jm.producto p ON p.id=i.producto_id
    WHERE i.tipo='SALIDA' AND p.tipo='HERRAMIENTA')
    THROW 51025, 'Las herramientas requieren préstamo y devolución, no salida de consumo.', 1;
END;
GO
