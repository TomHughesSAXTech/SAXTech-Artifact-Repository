module.exports = async function (context, myTimer) {
    const timeStamp = new Date().toISOString();
    
    context.log('Keep-warm timer function executed at:', timeStamp);
    
    // Make a lightweight call to keep the function app warm
    try {
        const https = require('https');
        
        // Call our own health endpoint to keep everything warm
        const warmupRequest = () => {
            return new Promise((resolve, reject) => {
                https.get('https://saxtech-metrics-api.azurewebsites.net/api/metrics', (res) => {
                    context.log(`Warm-up call status: ${res.statusCode}`);
                    res.on('data', () => {}); // Consume response
                    res.on('end', () => resolve(res.statusCode));
                }).on('error', (err) => {
                    context.log('Warm-up error:', err.message);
                    reject(err);
                });
            });
        };
        
        await warmupRequest();
        context.log('Function app warmed successfully');
        
    } catch (error) {
        context.log('Error during warm-up:', error);
    }
    
    context.log('Next timer occurrence:', myTimer.scheduleStatus.next);
};
