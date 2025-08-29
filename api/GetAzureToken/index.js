const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");

module.exports = async function (context, req) {
    context.log('Getting Azure management token');

    try {
        // Use Managed Identity to authenticate
        const credential = new DefaultAzureCredential();
        
        // Get the access token for Azure Management API
        const tokenResponse = await credential.getToken("https://management.azure.com/.default");
        
        // Get subscription ID from environment variable or Key Vault
        const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
        
        context.res = {
            status: 200,
            body: {
                accessToken: tokenResponse.token,
                subscriptionId: subscriptionId,
                expiresOn: tokenResponse.expiresOnTimestamp
            }
        };
    } catch (error) {
        context.log.error('Failed to get Azure token:', error);
        context.res = {
            status: 500,
            body: {
                error: 'Failed to authenticate with Azure'
            }
        };
    }
};
