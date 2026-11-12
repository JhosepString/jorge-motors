ALTER TABLE jm.dispositivo_registrado ADD
    revocado_en DATETIME2(3) NULL,
    revocado_por INT NULL REFERENCES jm.usuario(id),
    motivo_revocacion NVARCHAR(300) NULL;
