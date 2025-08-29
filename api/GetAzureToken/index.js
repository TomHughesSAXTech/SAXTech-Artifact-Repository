const { DefaultAzureCredential } = require("@azure/identity");

module.exports = async function (context, req) {
    context.log('Getting Azure management token');

    try {
        // Use Managed Identity to authenticate
        const credential = new DefaultAzureCredential();
        
        // Get the access token for Azure Management API
        const tokenResponse = await credential.getToken("https://management.azure.com/.default");
        
        // Get subscription ID from environment variable
        const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID || "3cfb259a-f02a-484e-9ce3-d83c21fd0ddb";
        
        context.res = {
            status: 200,
            body: {
                accessToken: tokenResponse.token,
                subscriptionId: subscriptionId,
                expiresOn: tokenResponse.expiresOnTimestamp
            },
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        };
    } catch (error) {
        context.log.error('Failed to get Azure token:', error);
        context.res = {
            status: 500,
            body: {
                error: 'Failed to authenticate with Azure',
                details: error.message
            },
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        };
    }
};
