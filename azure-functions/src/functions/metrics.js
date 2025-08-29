const { app } = require('@azure/functions');
const { DefaultAzureCredential } = require('@azure/identity');
const { CostManagementClient } = require('@azure/arm-costmanagement');
const { ResourceGraphClient } = require('@azure/arm-resourcegraph');
const { StorageManagementClient } = require('@azure/arm-storage');
const { ContainerServiceClient } = require('@azure/arm-containerservice');
const { MonitorClient } = require('@azure/arm-monitor');
const { CognitiveServicesManagementClient } = require('@azure/arm-cognitiveservices');
const { SubscriptionClient } = require('@azure/arm-subscriptions');
const { TableClient } = require('@azure/data-tables');

// Configuration
const subscriptionId = '3cfb259a-f02a-484e-9ce3-d83c21fd0ddb';
const resourceGroupName = 'SAXTech-AI';
const credential = new DefaultAzureCredential();

// Table Storage configuration for caching
const tableStorageConnectionString = process.env.AzureWebJobsStorage || '';
const cacheTableName = 'metricscache';
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour cache for cost data

// Initialize Table Client for caching
let tableClient;
try {
    if (tableStorageConnectionString) {
        tableClient = TableClient.fromConnectionString(tableStorageConnectionString, cacheTableName);
        // Create table if it doesn't exist
        tableClient.createTable().catch(() => {}); // Ignore error if table exists
    }
} catch (error) {
    console.error('Failed to initialize Table Storage:', error);
}

// Helper function to get cached data
async function getCachedData(key) {
    if (!tableClient) return null;
    
    try {
        const entity = await tableClient.getEntity('cache', key);
        const age = Date.now() - new Date(entity.timestamp).getTime();
        
        if (age < CACHE_DURATION_MS) {
            return JSON.parse(entity.data);
        }
    } catch (error) {
        // Cache miss or error
        return null;
    }
    return null;
}

// Helper function to set cached data
async function setCachedData(key, data) {
    if (!tableClient) return;
    
    try {
        const entity = {
            partitionKey: 'cache',
            rowKey: key,
            data: JSON.stringify(data),
            timestamp: new Date().toISOString()
        };
        await tableClient.upsertEntity(entity);
    } catch (error) {
        console.error('Failed to cache data:', error);
    }
}

// Fetch cost data with caching
async function fetchCostData() {
    const cacheKey = 'costData';
    
    // Check cache first
    const cachedCost = await getCachedData(cacheKey);
    if (cachedCost) {
        console.log('Returning cached cost data');
        return cachedCost;
    }
    
    try {
        const costClient = new CostManagementClient(credential);
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        
        const query = {
            type: 'ActualCost',
            timeframe: 'Custom',
            timePeriod: {
                from: startOfMonth.toISOString().split('T')[0],
                to: endDate.toISOString().split('T')[0]
            },
            dataset: {
                granularity: 'Daily',
                aggregation: {
                    totalCost: {
                        name: 'PreTaxCost',
                        function: 'Sum'
                    }
                },
                grouping: [
                    {
                        type: 'Dimension',
                        name: 'ServiceName'
                    }
                ]
            }
        };
        
        const scope = `/subscriptions/${subscriptionId}`;
        const result = await costClient.query.usage(scope, query);
        
        let monthToDate = 0;
        let yesterday = 0;
        const historical = [];
        const costBreakdown = {};
        
        if (result.rows && result.rows.length > 0) {
            result.rows.forEach(row => {
                const cost = row[0] || 0;
                const date = row[1];
                const service = row[2] || 'Unknown';
                
                monthToDate += cost;
                
                // Add to historical data
                historical.push({
                    date: parseInt(date.replace(/-/g, '')),
                    cost: cost,
                    service: service
                });
                
                // Aggregate by service
                if (!costBreakdown[service]) {
                    costBreakdown[service] = 0;
                }
                costBreakdown[service] += cost;
            });
            
            // Get yesterday's cost
            const yesterdayDate = new Date();
            yesterdayDate.setDate(yesterdayDate.getDate() - 1);
            const yesterdayStr = yesterdayDate.toISOString().split('T')[0].replace(/-/g, '');
            const yesterdayData = historical.find(h => h.date === parseInt(yesterdayStr));
            yesterday = yesterdayData ? yesterdayData.cost : 0;
        }
        
        const costData = {
            monthToDate,
            yesterday,
            currency: 'USD',
            historical,
            costBreakdown
        };
        
        // Cache the data
        await setCachedData(cacheKey, costData);
        
        return costData;
    } catch (error) {
        console.error('Error fetching cost data:', error);
        throw new Error(`Failed to fetch cost data: ${error.message}`);
    }
}

// Fetch resource counts using Resource Graph
async function fetchResourceCounts() {
    try {
        const graphClient = new ResourceGraphClient(credential);
        
        // Query for all resources in the subscription
        const query = {
            subscriptions: [subscriptionId],
            query: `
                Resources
                | where subscriptionId == '${subscriptionId}'
                | summarize count() by type
                | project type, count_
            `
        };
        
        const result = await graphClient.resources(query);
        
        let staticSites = 0;
        let functionApps = 0;
        let storageAccounts = 0;
        const resourceDetails = {
            staticSites: [],
            functionApps: [],
            storageAccounts: []
        };
        
        // Get detailed resource information
        const detailQuery = {
            subscriptions: [subscriptionId],
            query: `
                Resources
                | where subscriptionId == '${subscriptionId}'
                | where type in ('microsoft.web/staticsites', 'microsoft.web/sites', 'microsoft.storage/storageaccounts')
                | project name, type, location, resourceGroup, id, kind, properties
            `
        };
        
        const detailResult = await graphClient.resources(detailQuery);
        
        if (detailResult.data && detailResult.data.length > 0) {
            detailResult.data.forEach(resource => {
                if (resource.type === 'microsoft.web/staticsites') {
                    staticSites++;
                    resourceDetails.staticSites.push({
                        name: resource.name,
                        location: resource.location,
                        resourceGroup: resource.resourceGroup,
                        id: resource.id
                    });
                } else if (resource.type === 'microsoft.web/sites') {
                    // Check if it's a function app
                    if (resource.kind && resource.kind.includes('functionapp')) {
                        functionApps++;
                        resourceDetails.functionApps.push({
                            name: resource.name,
                            location: resource.location,
                            resourceGroup: resource.resourceGroup,
                            id: resource.id,
                            kind: resource.kind
                        });
                    }
                } else if (resource.type === 'microsoft.storage/storageaccounts') {
                    storageAccounts++;
                    resourceDetails.storageAccounts.push({
                        name: resource.name,
                        location: resource.location,
                        resourceGroup: resource.resourceGroup,
                        id: resource.id
                    });
                }
            });
        }
        
        return {
            counts: {
                staticSites,
                functionApps,
                storageAccounts,
                totalResources: staticSites + functionApps + storageAccounts
            },
            details: resourceDetails
        };
    } catch (error) {
        console.error('Error fetching resource counts:', error);
        throw new Error(`Failed to fetch resource counts: ${error.message}`);
    }
}

// Fetch storage account details
async function fetchStorageAccounts() {
    try {
        const storageClient = new StorageManagementClient(credential, subscriptionId);
        const accounts = [];
        
        for await (const account of storageClient.storageAccounts.list()) {
            // Get usage for each account
            try {
                const usage = await storageClient.usages.listByLocation(account.location);
                let usedBytes = 0;
                
                for await (const usageItem of usage) {
                    if (usageItem.name && usageItem.name.value === 'StorageAccounts') {
                        usedBytes = usageItem.currentValue || 0;
                        break;
                    }
                }
                
                accounts.push({
                    name: account.name,
                    location: account.location,
                    sku: account.sku ? account.sku.name : 'Unknown',
                    kind: account.kind,
                    resourceGroup: account.id.split('/')[4],
                    usedBytes: usedBytes
                });
            } catch (usageError) {
                // If we can't get usage, still include the account
                accounts.push({
                    name: account.name,
                    location: account.location,
                    sku: account.sku ? account.sku.name : 'Unknown',
                    kind: account.kind,
                    resourceGroup: account.id.split('/')[4],
                    usedBytes: 0
                });
            }
        }
        
        return accounts;
    } catch (error) {
        console.error('Error fetching storage accounts:', error);
        throw new Error(`Failed to fetch storage accounts: ${error.message}`);
    }
}

// Fetch Kubernetes (AKS) metrics
async function fetchKubernetesMetrics() {
    try {
        const aksClient = new ContainerServiceClient(credential, subscriptionId);
        const clusters = [];
        let totalNodes = 0;
        let totalCpu = 0;
        let totalMemory = 0;
        
        for await (const cluster of aksClient.managedClusters.list()) {
            const agentPools = [];
            for await (const pool of aksClient.agentPools.list(cluster.resourceGroup, cluster.name)) {
                agentPools.push({
                    name: pool.name,
                    count: pool.count || 0,
                    vmSize: pool.vmSize
                });
                totalNodes += pool.count || 0;
            }
            
            clusters.push({
                name: cluster.name,
                location: cluster.location,
                resourceGroup: cluster.resourceGroup,
                kubernetesVersion: cluster.kubernetesVersion,
                nodeCount: cluster.agentPoolProfiles ? cluster.agentPoolProfiles.reduce((sum, p) => sum + (p.count || 0), 0) : 0,
                agentPools: agentPools,
                status: cluster.provisioningState
            });
        }
        
        // Get metrics if clusters exist
        if (clusters.length > 0) {
            const monitorClient = new MonitorClient(credential, subscriptionId);
            
            for (const cluster of clusters) {
                try {
                    const resourceId = `/subscriptions/${subscriptionId}/resourceGroups/${cluster.resourceGroup}/providers/Microsoft.ContainerService/managedClusters/${cluster.name}`;
                    const endTime = new Date();
                    const startTime = new Date(endTime.getTime() - 5 * 60 * 1000); // Last 5 minutes
                    
                    // Get CPU usage
                    const cpuMetrics = await monitorClient.metrics.list(
                        resourceId,
                        {
                            timespan: `${startTime.toISOString()}/${endTime.toISOString()}`,
                            metricnames: 'node_cpu_usage_percentage',
                            aggregation: 'Average'
                        }
                    );
                    
                    if (cpuMetrics.value && cpuMetrics.value[0] && cpuMetrics.value[0].timeseries) {
                        const latestCpu = cpuMetrics.value[0].timeseries[0]?.data?.slice(-1)[0]?.average;
                        if (latestCpu) totalCpu += latestCpu;
                    }
                    
                    // Get Memory usage
                    const memoryMetrics = await monitorClient.metrics.list(
                        resourceId,
                        {
                            timespan: `${startTime.toISOString()}/${endTime.toISOString()}`,
                            metricnames: 'node_memory_working_set_percentage',
                            aggregation: 'Average'
                        }
                    );
                    
                    if (memoryMetrics.value && memoryMetrics.value[0] && memoryMetrics.value[0].timeseries) {
                        const latestMemory = memoryMetrics.value[0].timeseries[0]?.data?.slice(-1)[0]?.average;
                        if (latestMemory) totalMemory += latestMemory;
                    }
                } catch (metricsError) {
                    console.log(`Could not fetch metrics for cluster ${cluster.name}:`, metricsError.message);
                }
            }
        }
        
        return {
            clusterCount: clusters.length,
            clusters: clusters,
            totalNodes: totalNodes,
            avgCpuUsage: clusters.length > 0 ? (totalCpu / clusters.length).toFixed(2) : 0,
            avgMemoryUsage: clusters.length > 0 ? (totalMemory / clusters.length).toFixed(2) : 0
        };
    } catch (error) {
        console.error('Error fetching Kubernetes metrics:', error);
        throw new Error(`Failed to fetch Kubernetes metrics: ${error.message}`);
    }
}

// Fetch OpenAI/GPT usage
async function fetchGPTUsage() {
    const cacheKey = 'gptUsage';
    
    // Check cache first (GPT usage can be cached for 1 hour)
    const cachedUsage = await getCachedData(cacheKey);
    if (cachedUsage) {
        console.log('Returning cached GPT usage data');
        return cachedUsage;
    }
    
    try {
        const cognitiveClient = new CognitiveServicesManagementClient(credential, subscriptionId);
        const openAIAccounts = [];
        let totalTokens = 0;
        let totalCost = 0;
        
        // Find OpenAI accounts
        for await (const account of cognitiveClient.accounts.list()) {
            if (account.kind === 'OpenAI') {
                openAIAccounts.push({
                    name: account.name,
                    location: account.location,
                    resourceGroup: account.id.split('/')[4],
                    endpoint: account.properties?.endpoint
                });
            }
        }
        
        // Get usage metrics for OpenAI accounts
        if (openAIAccounts.length > 0) {
            const monitorClient = new MonitorClient(credential, subscriptionId);
            
            for (const account of openAIAccounts) {
                try {
                    const resourceId = `/subscriptions/${subscriptionId}/resourceGroups/${account.resourceGroup}/providers/Microsoft.CognitiveServices/accounts/${account.name}`;
                    const endTime = new Date();
                    const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000); // Last 24 hours
                    
                    const metrics = await monitorClient.metrics.list(
                        resourceId,
                        {
                            timespan: `${startTime.toISOString()}/${endTime.toISOString()}`,
                            metricnames: 'TokenTransaction',
                            aggregation: 'Total'
                        }
                    );
                    
                    if (metrics.value && metrics.value[0] && metrics.value[0].timeseries) {
                        for (const series of metrics.value[0].timeseries) {
                            if (series.data) {
                                for (const dataPoint of series.data) {
                                    totalTokens += dataPoint.total || 0;
                                }
                            }
                        }
                    }
                } catch (metricsError) {
                    console.log(`Could not fetch metrics for OpenAI account ${account.name}:`, metricsError.message);
                }
            }
        }
        
        const gptUsage = {
            accounts: openAIAccounts,
            totalTokens: totalTokens,
            estimatedCost: totalTokens * 0.00002, // Rough estimate
            period: '24h'
        };
        
        // Cache the data
        await setCachedData(cacheKey, gptUsage);
        
        return gptUsage;
    } catch (error) {
        console.error('Error fetching GPT usage:', error);
        throw new Error(`Failed to fetch GPT usage: ${error.message}`);
    }
}

// Fetch all resource groups
async function fetchResourceGroups() {
    try {
        const subscriptionClient = new SubscriptionClient(credential);
        const resourceGroups = [];
        
        for await (const rg of subscriptionClient.resourceGroups.list(subscriptionId)) {
            resourceGroups.push({
                name: rg.name,
                location: rg.location,
                id: rg.id
            });
        }
        
        return resourceGroups;
    } catch (error) {
        console.error('Error fetching resource groups:', error);
        throw new Error(`Failed to fetch resource groups: ${error.message}`);
    }
}

// Main metrics function
app.http('metrics', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log('Metrics function triggered');
        
        const response = {
            subscriptionId: subscriptionId,
            resourceGroup: resourceGroupName,
            timestamp: new Date().toISOString(),
            errors: []
        };
        
        try {
            // Fetch all data in parallel where possible
            const [costData, resourceData, storageData, k8sData, gptData] = await Promise.allSettled([
                fetchCostData(),
                fetchResourceCounts(),
                fetchStorageAccounts(),
                fetchKubernetesMetrics(),
                fetchGPTUsage()
            ]);
            
            // Handle cost data
            if (costData.status === 'fulfilled') {
                response.costs = costData.value;
            } else {
                response.costs = null;
                response.errors.push({
                    type: 'cost',
                    message: costData.reason?.message || 'Failed to fetch cost data'
                });
            }
            
            // Handle resource counts
            if (resourceData.status === 'fulfilled') {
                response.resources = resourceData.value.counts;
                response.resourceDetails = resourceData.value.details;
            } else {
                response.resources = null;
                response.resourceDetails = null;
                response.errors.push({
                    type: 'resources',
                    message: resourceData.reason?.message || 'Failed to fetch resource counts'
                });
            }
            
            // Handle storage accounts
            if (storageData.status === 'fulfilled') {
                response.storage = {
                    accounts: storageData.value
                };
            } else {
                response.storage = null;
                response.errors.push({
                    type: 'storage',
                    message: storageData.reason?.message || 'Failed to fetch storage accounts'
                });
            }
            
            // Handle Kubernetes data
            if (k8sData.status === 'fulfilled') {
                response.kubernetes = k8sData.value;
            } else {
                response.kubernetes = null;
                response.errors.push({
                    type: 'kubernetes',
                    message: k8sData.reason?.message || 'Failed to fetch Kubernetes data'
                });
            }
            
            // Handle GPT usage
            if (gptData.status === 'fulfilled') {
                response.openAIUsage = gptData.value;
            } else {
                response.openAIUsage = null;
                response.errors.push({
                    type: 'openai',
                    message: gptData.reason?.message || 'Failed to fetch OpenAI usage'
                });
            }
            
            return {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                },
                body: JSON.stringify(response)
            };
        } catch (error) {
            context.log.error('Error in metrics function:', error);
            
            return {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    error: 'Internal server error',
                    message: error.message,
                    timestamp: new Date().toISOString()
                })
            };
        }
    }
});

// Resource groups endpoint
app.http('resourceGroups', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log('Resource groups function triggered');
        
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                }
            };
        }
        
        try {
            const resourceGroups = await fetchResourceGroups();
            
            return {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                },
                body: JSON.stringify({
                    subscriptionId: subscriptionId,
                    resourceGroups: resourceGroups,
                    timestamp: new Date().toISOString()
                })
            };
        } catch (error) {
            context.log.error('Error fetching resource groups:', error);
            
            return {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    error: 'Failed to fetch resource groups',
                    message: error.message,
                    timestamp: new Date().toISOString()
                })
            };
        }
    }
});

// Resources in resource group endpoint
app.http('resources', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log('Resources function triggered');
        
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                }
            };
        }
        
        const resourceGroup = request.query.get('resourceGroup');
        if (!resourceGroup) {
            return {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    error: 'resourceGroup parameter is required'
                })
            };
        }
        
        try {
            const graphClient = new ResourceGraphClient(credential);
            
            const query = {
                subscriptions: [subscriptionId],
                query: `
                    Resources
                    | where subscriptionId == '${subscriptionId}' and resourceGroup == '${resourceGroup}'
                    | project name, type, location, id, kind, properties
                `
            };
            
            const result = await graphClient.resources(query);
            const resources = [];
            
            if (result.data && result.data.length > 0) {
                result.data.forEach(resource => {
                    // Determine if it's a front-end capable resource
                    let url = null;
                    if (resource.type === 'microsoft.web/sites') {
                        url = `https://${resource.name}.azurewebsites.net`;
                    } else if (resource.type === 'microsoft.web/staticsites') {
                        // Static sites have custom domains
                        url = resource.properties?.defaultHostname ? 
                            `https://${resource.properties.defaultHostname}` : 
                            `https://${resource.name}.azurestaticapps.net`;
                    }
                    
                    resources.push({
                        name: resource.name,
                        type: resource.type.split('/').pop(),
                        location: resource.location,
                        id: resource.id,
                        kind: resource.kind,
                        url: url
                    });
                });
            }
            
            return {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                },
                body: JSON.stringify({
                    subscriptionId: subscriptionId,
                    resourceGroup: resourceGroup,
                    resources: resources,
                    timestamp: new Date().toISOString()
                })
            };
        } catch (error) {
            context.log.error('Error fetching resources:', error);
            
            return {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    error: 'Failed to fetch resources',
                    message: error.message,
                    timestamp: new Date().toISOString()
                })
            };
        }
    }
});

module.exports = { app };
