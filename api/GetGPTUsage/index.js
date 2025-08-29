const fetch = require('node-fetch');

module.exports = async function (context, req) {
    context.log('GetGPTUsage function triggered');
    
    // Add CORS headers
    const corsHeaders = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-ms-client-principal'
    };

    // Handle OPTIONS request for CORS
    if (req.method === 'OPTIONS') {
        context.res = {
            status: 200,
            headers: corsHeaders
        };
        return;
    }

    try {
        // Check for authentication header from Static Web App
        const authHeader = req.headers['x-ms-client-principal'];
        let userInfo = null;
        
        if (authHeader) {
            try {
                const encoded = Buffer.from(authHeader, 'base64');
                const decoded = encoded.toString('ascii');
                userInfo = JSON.parse(decoded);
                context.log('User authenticated:', userInfo.userDetails);
            } catch (e) {
                context.log('Failed to parse auth header:', e);
            }
        }
        // Get OpenAI API key from environment variables
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const openaiOrgId = process.env.OPENAI_ORG_ID;
        
        if (!openaiApiKey) {
            context.res = {
                status: 400,
                body: {
                    error: "OpenAI API key not configured",
                    authenticated: !!userInfo,
                    user: userInfo?.userDetails || 'anonymous'
                },
                headers: corsHeaders
            };
            return;
        }

        // Get date range for usage query
        const today = new Date();
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const endDate = today.toISOString().split('T')[0];
        const startDate = thirtyDaysAgo.toISOString().split('T')[0];

        // Fetch usage data from OpenAI API
        const headers = {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json'
        };

        if (openaiOrgId) {
            headers['OpenAI-Organization'] = openaiOrgId;
        }

        // Note: OpenAI's usage API endpoint might require organization-level access
        // This is a placeholder implementation - adjust based on actual OpenAI API
        const response = await fetch(`https://api.openai.com/v1/usage?date=${startDate}`, {
            method: 'GET',
            headers: headers
        });

        let usageData = {
            daily: [],
            byProject: {},
            totalTokens: 0,
            totalCost: 0
        };

        if (response.ok) {
            const data = await response.json();
            
            // Process OpenAI usage data
            // Note: Actual structure depends on OpenAI API response format
            if (data.data) {
                // Calculate daily usage
                const dailyUsage = {};
                data.data.forEach(item => {
                    const date = item.aggregation_timestamp;
                    if (!dailyUsage[date]) {
                        dailyUsage[date] = {
                            tokens: 0,
                            cost: 0
                        };
                    }
                    dailyUsage[date].tokens += item.n_context_tokens_total || 0;
                    dailyUsage[date].tokens += item.n_generated_tokens_total || 0;
                    // Estimate cost (adjust rates based on actual model pricing)
                    dailyUsage[date].cost += (item.n_context_tokens_total || 0) * 0.00001;
                    dailyUsage[date].cost += (item.n_generated_tokens_total || 0) * 0.00003;
                });

                // Convert to array format
                usageData.daily = Object.entries(dailyUsage).map(([date, data]) => ({
                    date,
                    tokens: data.tokens,
                    cost: Math.round(data.cost * 100) / 100
                })).sort((a, b) => new Date(a.date) - new Date(b.date));

                // Calculate totals
                usageData.totalTokens = usageData.daily.reduce((sum, day) => sum + day.tokens, 0);
                usageData.totalCost = usageData.daily.reduce((sum, day) => sum + day.cost, 0);
            }
        } else {
            context.log.warn('Failed to fetch OpenAI usage data:', response.statusText);
            
            // Return sample data structure even if API call fails
            // This helps the frontend work even without real data
            const sampleDates = [];
            for (let i = 29; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                sampleDates.push({
                    date: date.toISOString().split('T')[0],
                    tokens: 0,
                    cost: 0
                });
            }
            usageData.daily = sampleDates;
        }
        
        // Add authentication info to response
        usageData.authenticated = !!userInfo;
        usageData.user = userInfo?.userDetails || 'anonymous';
        usageData.timestamp = new Date().toISOString();

        context.res = {
            status: 200,
            headers: corsHeaders,
            body: usageData
        };
    } catch (error) {
        context.log.error('Error fetching GPT usage:', error);
        
        context.res = {
            status: 500,
            body: {
                error: "Failed to fetch GPT usage data",
                details: error.message,
                daily: [],
                byProject: {},
                totalTokens: 0,
                totalCost: 0,
                authenticated: false,
                user: 'anonymous'
            },
            headers: corsHeaders
        };
    }
};
