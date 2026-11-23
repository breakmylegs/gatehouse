// Seeded misconfigurations (E-022).
param location string = resourceGroup().location

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-shop'
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
  }
}

resource web 'Microsoft.Web/sites@2023-01-01' = {
  name: 'shop-web'
  location: location
  properties: {
    siteConfig: {
      minTlsVersion: '1.0'
    }
  }
}
