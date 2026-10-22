# Infraestructura de Azure

Estos archivos **no despliegan nada por sí solos**. Tú ejecutas los comandos y revisas cada cambio en Azure Portal o en la terminal.

## Fase 1 — Base segura y económica

`foundation.bicep` crea solamente:

- una cuenta Azure Storage v2 `Standard_LRS` en Central US;
- el contenedor privado `facturas`;
- etiquetas para diferenciar el demo.

No crea máquinas virtuales, NAT Gateway, red virtual, base de datos ni un servicio web. La cuenta se usará después para los PDF de facturas de proveedores. Los blobs no son públicos, el acceso se hará desde la API.

## Antes de desplegar

1. Abre una terminal en esta carpeta.
2. Inicia sesión y confirma la suscripción correcta:

```powershell
az login
az account show --output table
az account set --subscription "Azure for Students"
```

3. Instala o actualiza la extensión **Bicep** de VS Code. Para comprobar el archivo sin crear recursos:

```powershell
az bicep build --file .\foundation.bicep
```

## Simular primero (what-if)

El comando siguiente solo muestra qué agregaría Azure; no modifica la nube.

```powershell
az deployment group what-if `
  --resource-group rg-jorge-motors-dev `
  --template-file .\foundation.bicep `
  --parameters .\foundation.parameters.json
```

Revisa que haya una cuenta de almacenamiento y el contenedor `facturas`. Si ves otro recurso inesperado, no continúes: revisamos el Bicep primero.

## Desplegar manualmente

Cuando estés conforme con `what-if`, ejecuta:

```powershell
az deployment group create `
  --name foundation-001 `
  --resource-group rg-jorge-motors-dev `
  --template-file .\foundation.bicep `
  --parameters .\foundation.parameters.json
```

Después, en Azure Portal, abre `rg-jorge-motors-dev` y valida:

- ubicación: **Central US**;
- SKU: **Standard_LRS**;
- contenedor `facturas` con acceso público deshabilitado;
- etiquetas `project=jorge-motors` y `environment=demo`.

## Importante

No guardes claves, cadenas de conexión ni archivos `.env` en Git. La siguiente fase agregará Azure SQL y una identidad administrada cuando ya exista la API que las utilice.
