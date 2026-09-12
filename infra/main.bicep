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
