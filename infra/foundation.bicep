// Fase 1: recursos mínimos y económicos para el demo de Jorge Motors.
// Ámbito: el grupo rg-jorge-motors-dev ya creado manualmente en Central US.
targetScope = 'resourceGroup'

@description('Región del grupo de recursos. Debe mantenerse en Central US.')
param location string = resourceGroup().location

@minLength(3)
@maxLength(11)
@description('Prefijo en minúsculas para los nombres globales de Azure.')
param namePrefix string = 'jorgemotors'

@description('Etiquetas comunes de los recursos del demo.')
param tags object = {
  project: 'jorge-motors'
  environment: 'demo'
  managedBy: 'bicep'
}

// Los nombres de Storage deben ser únicos globalmente, tener 3-24 caracteres
// y usar solo minúsculas y números. uniqueString evita choques de nombre.
var storageAccountName = take('${namePrefix}${uniqueString(resourceGroup().id)}', 24)

resource storageAccount 'Microsoft.Storage/storageAccounts@2025-06-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
  }
}

// Las facturas son privadas: el backend las servirá con identidad administrada
// o enlaces SAS de corta duración, nunca como blobs públicos.
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-06-01' = {
  parent: storageAccount
  name: 'default'
}

resource invoicesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-06-01' = {
  parent: blobService
  name: 'facturas'
  properties: {
    publicAccess: 'None'
  }
}

output storageAccountName string = storageAccount.name
output storageBlobEndpoint string = storageAccount.properties.primaryEndpoints.blob
output invoicesContainerName string = invoicesContainer.name
