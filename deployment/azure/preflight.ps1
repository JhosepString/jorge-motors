param(
  [string]$ResourceGroup = 'rg-jorge-motors-dev',
  [string]$SqlServer = 'jorge-motors-sql-demo-josen',
  [string]$Database = 'jorge_motors_dev',
  [string]$StorageAccount = 'jorgemotorstyts7qt6swfsw',
  [string]$DesktopClientId = '06b6e377-10f3-4742-a2b0-39289eb9d027',
  [string]$ApiClientId = '0ed26762-92c1-46d6-8623-ce827609c1c2'
)

$ErrorActionPreference = 'Stop'
function Read-AzureJson([string[]]$Arguments) {
  $result = & az @Arguments --only-show-errors --output json
  if ($LASTEXITCODE -ne 0) { throw "Azure CLI falló al consultar: $($Arguments -join ' ')" }
  return ($result | ConvertFrom-Json)
}

$subscription = Read-AzureJson @('account','show')
$group = Read-AzureJson @('group','show','--name',$ResourceGroup)
$databaseState = Read-AzureJson @('sql','db','show','--resource-group',$ResourceGroup,
  '--server',$SqlServer,'--name',$Database)
$storage = Read-AzureJson @('storage','account','show','--resource-group',$ResourceGroup,
  '--name',$StorageAccount)
$desktop = Read-AzureJson @('ad','app','show','--id',$DesktopClientId)
$api = Read-AzureJson @('ad','app','show','--id',$ApiClientId)
$grants = Read-AzureJson @('ad','app','permission','list-grants','--id',$DesktopClientId)
$resources = @(Read-AzureJson @('resource','list','--resource-group',$ResourceGroup))
$containerApps = Read-AzureJson @('provider','show','--namespace','Microsoft.App')
$registry = Read-AzureJson @('provider','show','--namespace','Microsoft.ContainerRegistry')

$scope = @($api.api.oauth2PermissionScopes | Where-Object { $_.value -eq 'Inventario.Access' -and $_.isEnabled })
$hasGrant = @($grants | Where-Object { $_.scope -split ' ' -contains 'Inventario.Access' }).Count -gt 0
$hasRedirect = @($desktop.publicClient.redirectUris | Where-Object { $_ -eq 'http://localhost' }).Count -gt 0
$hasApi = @($resources | Where-Object { $_.type -eq 'Microsoft.App/containerApps' -or
  $_.type -eq 'Microsoft.Web/sites' }).Count -gt 0
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$desktopConfigExists = Test-Path -LiteralPath (Join-Path $projectRoot 'desktop\auth-config.json')
$dockerfileExists = Test-Path -LiteralPath (Join-Path $projectRoot 'backend\Dockerfile')

$report = [ordered]@{
  subscription = $subscription.name
  tenantId = $subscription.tenantId
  resourceGroup = $group.name
  region = $group.location
  database = [ordered]@{ name = $databaseState.name; status = $databaseState.status;
    sku = $databaseState.sku.name }
  storage = [ordered]@{ name = $storage.name; region = $storage.location;
    publicBlobAccessAllowed = $storage.allowBlobPublicAccess;
    sharedKeyAccessAllowed = $storage.allowSharedKeyAccess }
  desktopClient = [ordered]@{ appId = $desktop.appId; localhostRedirect = $hasRedirect;
    inventoryScopeConsent = $hasGrant }
  apiClient = [ordered]@{ appId = $api.appId; inventoryScopeEnabled = $scope.Count -eq 1 }
  providers = [ordered]@{ containerApps = $containerApps.registrationState;
    containerRegistry = $registry.registrationState }
  apiAlreadyPublished = $hasApi
  localRelease = [ordered]@{ dockerfileExists = $dockerfileExists;
    desktopAuthConfigExists = $desktopConfigExists }
  nextActions = @(
    'Confirmar coste y estrategia de hospedaje antes de crear recursos.'
    'Publicar API en la misma región que la base.'
    'Configurar identidad administrada y permisos mínimos de SQL/Blob.'
    'Aplicar migraciones cloud con copia de respaldo y cuenta administradora.'
    'Configurar firma del permiso offline y comprobar autenticación real.'
    'Construir el instalador con la URL HTTPS definitiva.'
  )
}
$report | ConvertTo-Json -Depth 8
