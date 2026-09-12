targetScope = 'resourceGroup'

@description('AZD environment name used for resource naming.')
param environmentName string

@description('Azure region for the deployment.')
param location string

@description('Object ID that should receive deployment permissions. Leave empty to skip the assignment.')
param principalId string = ''

@description('APIM publisher email address.')
param apimPublisherEmail string

@description('APIM publisher display name.')
param apimPublisherName string

var containerRegistryName = toLower(replace('cr${environmentName}', '-', ''))
var managedEnvironmentName = 'cae-${environmentName}'
var containerAppName = 'ca-${environmentName}'
var identityName = 'id-${environmentName}'
var keyVaultName = toLower(replace('kv-${environmentName}', '-', ''))
var workspaceName = 'law-${environmentName}'
var insightsName = 'appi-${environmentName}'
var apiManagementName = 'apim-${environmentName}'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  properties: {
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
  sku: {
    name: 'PerGB2018'
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: insightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: containerRegistryName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: managedEnvironmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    sku: {
      family: 'A'
      name: 'standard'
    }
  }
}

resource keyVaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, 'mangafind-managed-identity-secrets-user')
  scope: keyVault
  properties: {
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
  }
}

resource managedIdentityAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(containerRegistry.id, 'mangafind-managed-identity-acr-pull')
  scope: containerRegistry
  properties: {
    principalId: managedIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  tags: {
    'azd-service-name': 'web'
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: managedEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: containerRegistry.properties.loginServer
          identity: managedIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'NODE_ENV'
              value: 'production'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 2
      }
    }
  }
}

resource apiManagement 'Microsoft.ApiManagement/service@2024-05-01' = {
  name: apiManagementName
  location: location
  sku: {
    name: 'BasicV2'
    capacity: 1
  }
  properties: {
    publisherEmail: apimPublisherEmail
    publisherName: apimPublisherName
  }
}

resource identifyApi 'Microsoft.ApiManagement/service/apis@2022-08-01' = {
  name: 'mangafind-api'
  parent: apiManagement
  properties: {
    displayName: 'MangaFind API'
    path: 'api'
    protocols: [
      'https'
    ]
    serviceUrl: 'https://${containerApp.properties.configuration.ingress.fqdn}'
    subscriptionRequired: false
    format: 'openapi+json'
    value: loadTextContent('api-definition.json')
  }
}

resource identifyApiPolicy 'Microsoft.ApiManagement/service/apis/policies@2022-08-01' = {
  name: 'policy'
  parent: identifyApi
  properties: {
    format: 'rawxml'
    value: loadTextContent('api-policy.xml')
  }
}

resource principalAcrPush 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (principalId != '') {
  name: guid(containerRegistry.id, principalId, 'AcrPush')
  scope: containerRegistry
  properties: {
    principalId: principalId
    principalType: 'User'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '8311e382-0749-4cb8-b61a-304f252e45ec')
  }
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerRegistry.properties.loginServer
output AZURE_CONTAINER_APPS_ENVIRONMENT_ID string = managedEnvironment.id
output AZURE_CONTAINER_APP_NAME string = containerApp.name
output AZURE_CONTAINER_APP_RESOURCE_ID string = containerApp.id
output AZURE_CONTAINER_APP_FQDN string = containerApp.properties.configuration.ingress.fqdn
output AZURE_KEY_VAULT_URI string = keyVault.properties.vaultUri
output AZURE_APPLICATION_INSIGHTS_CONNECTION_STRING string = applicationInsights.properties.ConnectionString
output AZURE_API_MANAGEMENT_NAME string = apiManagement.name
