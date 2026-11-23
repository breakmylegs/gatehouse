// Benign (E-022).
param location string = resourceGroup().location

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-shop'
  location: location
  properties: {
    tenantId: subscription().tenantId
    publicNetworkAccess: 'Disabled'
  }
}

resource kvLogs 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'kv-logs'
  scope: kv
  properties: {
    workspaceId: '/subscriptions/0/resourceGroups/rg/providers/Microsoft.OperationalInsights/workspaces/logs'
  }
}

resource web 'Microsoft.Web/sites@2023-01-01' = {
  name: 'shop-web'
  location: location
  properties: {
    siteConfig: {
      minTlsVersion: '1.2'
    }
  }
}
