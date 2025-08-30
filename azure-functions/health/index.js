module.exports = async function (context, req) {
    context.log('Health check endpoint called');
    
    context.res = {
        status: 200,
        body: {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            service: 'saxtech-metrics-api',
            version: '1.0.0'
        },
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache'
        }
    };
};
