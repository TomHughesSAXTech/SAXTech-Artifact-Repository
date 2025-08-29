module.exports = async function (context, req) {
    context.log('Test function triggered');

    const responseData = {
        message: "Azure Functions are working!",
        timestamp: new Date().toISOString(),
        requestMethod: req.method,
        requestUrl: req.url,
        subscriptionId: process.env.AZURE_SUBSCRIPTION_ID || "Not configured",
        functionRuntime: process.env.FUNCTIONS_WORKER_RUNTIME || "Unknown",
        nodeVersion: process.version
    };

    context.res = {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: responseData
    };
};
