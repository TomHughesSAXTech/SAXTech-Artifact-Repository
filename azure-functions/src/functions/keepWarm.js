const { app } = require('@azure/functions');

// Timer trigger to keep the function app warm
// Runs every 5 minutes to prevent cold starts
app.timer('keepWarm', {
    schedule: '0 */5 * * * *', // Every 5 minutes
    handler: async (myTimer, context) => {
        context.log('Keep-warm timer executed at:', new Date().toISOString());
        
        // Optional: Make a lightweight call to the metrics endpoint
        try {
            const https = require('https');
            https.get('https://saxtech-metrics-api.azurewebsites.net/api/health', (res) => {
                context.log(`Health check status: ${res.statusCode}`);
            }).on('error', (err) => {
                context.log('Health check error:', err.message);
            });
        } catch (error) {
            context.log('Keep-warm error:', error);
        }
        
        return { status: 'warm', timestamp: new Date().toISOString() };
    }
});

// Also add a simple health check endpoint
app.http('health', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        return {
            status: 200,
            body: JSON.stringify({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime()
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        };
    }
});
