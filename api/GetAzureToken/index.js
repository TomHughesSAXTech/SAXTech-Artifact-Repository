module.exports = async function (context, req) {
    context.log('GetAzureToken function triggered');
    
    // For Static Web Apps with linked backend, auth is passed through
    // We'll use the user's token from the Static Web App auth
    const header = req.headers['x-ms-client-principal'];
    const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID || "3cfb259a-f02a-484e-9ce3-d83c21fd0ddb";
    
    if (header) {
        // User is authenticated via Static Web App
        const encoded = Buffer.from(header, 'base64');
        const decoded = encoded.toString('ascii');
        const principal = JSON.parse(decoded);
        
        context.res = {
            status: 200,
            body: {
                authenticated: true,
                userDetails: principal.userDetails,
                subscriptionId: subscriptionId,
                // Note: We can't get Azure management token this way,
                // need to use managed identity or service principal
                message: "Use GetAzureMetrics for actual data"
            },
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        };
    } else {
        context.res = {
            status: 200,
            body: {
                authenticated: false,
                subscriptionId: subscriptionId,
                message: "Not authenticated"
            },
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        };
    }
};
