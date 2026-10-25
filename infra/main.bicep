targetScope = 'subscription'

@description('AZD environment name used for resource naming.')
param environmentName string

@description('Azure region for the deployment.')
param location string

@description('Object ID that should receive deployment permissions. Leave empty to skip the assignment.')
param principalId string = ''

@description('APIM publisher email address.')
param apimPublisherEmail string = 'admin@example.com'

@description('APIM publisher display name.')
param apimPublisherName string = 'MangaFind'

@description('Azure Foundry model endpoint used by the server-side judge.')
param azureFoundryEndpoint string = ''

@description('National Library provider mode. Keep mock until the Seoji API key is verified.')
@allowed([
  'mock'
  'live'
])
param nlApiMode string = 'mock'

@description('Optional Key Vault secret name for the National Library Seoji API key.')
param nlApiKeySecretName string = ''

@description('In-memory National Library result cache lifetime in milliseconds.')
@minValue(0)
@maxValue(3600000)
param nlApiCacheTtlMs int = 60000

var resourceGroupName = 'rg-${environmentName}'

resource resourceGroup 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: resourceGroupName
  location: location
}

module resources './resources.bicep' = {
  scope: resourceGroup
  params: {
    environmentName: environmentName
    location: location
    principalId: principalId
    apimPublisherEmail: apimPublisherEmail
    apimPublisherName: apimPublisherName
    azureFoundryEndpoint: azureFoundryEndpoint
    nlApiMode: nlApiMode
    nlApiKeySecretName: nlApiKeySecretName
    nlApiCacheTtlMs: nlApiCacheTtlMs
  }
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.AZURE_CONTAINER_REGISTRY_ENDPOINT
output AZURE_CONTAINER_APPS_ENVIRONMENT_ID string = resources.outputs.AZURE_CONTAINER_APPS_ENVIRONMENT_ID
output AZURE_CONTAINER_APP_NAME string = resources.outputs.AZURE_CONTAINER_APP_NAME
output AZURE_CONTAINER_APP_RESOURCE_ID string = resources.outputs.AZURE_CONTAINER_APP_RESOURCE_ID
output AZURE_CONTAINER_APP_FQDN string = resources.outputs.AZURE_CONTAINER_APP_FQDN
output AZURE_KEY_VAULT_URI string = resources.outputs.AZURE_KEY_VAULT_URI
output AZURE_APPLICATION_INSIGHTS_CONNECTION_STRING string = resources.outputs.AZURE_APPLICATION_INSIGHTS_CONNECTION_STRING
output AZURE_API_MANAGEMENT_NAME string = resources.outputs.AZURE_API_MANAGEMENT_NAME
