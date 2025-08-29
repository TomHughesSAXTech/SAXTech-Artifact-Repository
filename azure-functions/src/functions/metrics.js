const { app } = require('@azure/functions');
const { DefaultAzureCredential } = require('@azure/identity');
const { CostManagementClient } = require('@azure/arm-costmanagement');
const { ResourceGraphClient } = require('@azure/arm-resourcegraph');
const { StorageManagementClient, BlobServiceClient } = require('@azure/arm-storage');
const { ContainerServiceClient } = require('@azure/arm-containerservice');
const { MonitorClient } = require('@azure/arm-monitor');
const { CognitiveServicesManagementClient } = require('@azure/arm-cognitiveservices');
const { ResourceManagementClient } = require('@azure/arm-resources');
const { RecoveryServicesBackupClient } = require('@azure/arm-recoveryservicesbackup');
const { RecoveryServicesClient } = require('@azure/arm-recoveryservices');
const { TableClient } = require('@azure/data-tables');
const { BlobServiceClient: StorageBlobClient } = require('@azure/storage-blob');

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

// Fetch detailed cost data with daily granularity
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
                granularity: 'Daily',  // Ensure daily granularity
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
                    },
                    {
                        type: 'Dimension',
                        name: 'ResourceId'
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
        const resourceCosts = {};
        
        if (result.rows && result.rows.length > 0) {
            result.rows.forEach(row => {
                const cost = row[0] || 0;
                const dateStr = String(row[1]);
                const service = row[2] || 'Unknown';
                const resourceId = row[3] || '';
                
                monthToDate += cost;
                
                // Parse date properly (should be YYYY-MM-DD format)
                let dateInt;
                if (dateStr.includes('-')) {
                    dateInt = parseInt(dateStr.replace(/-/g, ''));
                } else {
                    dateInt = parseInt(dateStr);
                }
                
                // Add to historical data (aggregate by date)
                const existingHistorical = historical.find(h => h.date === dateInt && h.service === service);
                if (existingHistorical) {
                    existingHistorical.cost += cost;
                } else {
                    historical.push({
                        date: dateInt,
                        cost: cost,
                        service: service
                    });
                }
                
                // Aggregate by service
                if (!costBreakdown[service]) {
                    costBreakdown[service] = 0;
                }
                costBreakdown[service] += cost;
                
                // Track resource-level costs
                if (resourceId) {
                    const resourceName = resourceId.split('/').pop();
                    if (!resourceCosts[resourceName]) {
                        resourceCosts[resourceName] = {
                            totalCost: 0,
                            service: service,
                            resourceId: resourceId
                        };
                    }
                    resourceCosts[resourceName].totalCost += cost;
                }
            });
            
            // Sort historical by date
            historical.sort((a, b) => a.date - b.date);
            
            // Get yesterday's cost
            const yesterdayDate = new Date();
            yesterdayDate.setDate(yesterdayDate.getDate() - 1);
            const yesterdayStr = yesterdayDate.toISOString().split('T')[0].replace(/-/g, '');
            const yesterdayData = historical.filter(h => h.date === parseInt(yesterdayStr));
            yesterday = yesterdayData.reduce((sum, item) => sum + item.cost, 0);
        }
        
        const costData = {
            monthToDate,
            yesterday,
            currency: 'USD',
            historical,
            costBreakdown,
            resourceCosts
        };
        
        // Cache the data
        await setCachedData(cacheKey, costData);
        
        return costData;
    } catch (error) {
        console.error('Error fetching cost data:', error);
        throw new Error(`Failed to fetch cost data: ${error.message}`);
    }
}

// Enhanced resource fetching with creation dates and endpoints
async function fetchResourceCounts() {
    try {
        const graphClient = new ResourceGraphClient(credential);
        
        // Get detailed resource information with timestamps
        const detailQuery = {
            subscriptions: [subscriptionId],
            query: `
                Resources
                | where subscriptionId == '${subscriptionId}'
                | where type in ('microsoft.web/staticsites', 'microsoft.web/sites', 'microsoft.storage/storageaccounts')
                | extend createdTime = properties.createdTime
                | project name, type, location, resourceGroup, id, kind, properties, tags, createdTime
            `
        };
        
        const detailResult = await graphClient.resources(detailQuery);
        
        let staticSites = 0;
        let functionApps = 0;
        let storageAccounts = 0;
        const resourceDetails = {
            staticSites: [],
            functionApps: [],
            storageAccounts: []
        };
        
        if (detailResult.data && detailResult.data.length > 0) {
            // Get cost data to map costs to resources
            const costData = await fetchCostData();
            
            detailResult.data.forEach(resource => {
                const resourceCost = costData.resourceCosts[resource.name] || { totalCost: 0 };
                
                if (resource.type === 'microsoft.web/staticsites') {
                    staticSites++;
                    resourceDetails.staticSites.push({
                        name: resource.name,
                        location: resource.location,
                        resourceGroup: resource.resourceGroup,
                        id: resource.id,
                        createdTime: resource.createdTime || resource.properties?.createdTime,
                        endpoint: `https://${resource.properties?.defaultHostname || resource.name + '.azurestaticapps.net'}`,
                        customDomains: resource.properties?.customDomains || [],
                        repositoryUrl: resource.properties?.repositoryUrl,
                        branch: resource.properties?.branch,
                        cost: resourceCost.totalCost,
                        tags: resource.tags || {}
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
                            kind: resource.kind,
                            createdTime: resource.createdTime || resource.properties?.createdTime,
                            endpoint: `https://${resource.name}.azurewebsites.net`,
                            state: resource.properties?.state,
                            hostNames: resource.properties?.hostNames || [],
                            cost: resourceCost.totalCost,
                            tags: resource.tags || {}
                        });
                    }
                } else if (resource.type === 'microsoft.storage/storageaccounts') {
                    storageAccounts++;
                    resourceDetails.storageAccounts.push({
                        name: resource.name,
                        location: resource.location,
                        resourceGroup: resource.resourceGroup,
                        id: resource.id,
                        createdTime: resource.createdTime || resource.properties?.creationTime,
                        primaryEndpoints: resource.properties?.primaryEndpoints,
                        cost: resourceCost.totalCost,
                        tags: resource.tags || {}
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

// Enhanced storage account details with container information
async function fetchStorageAccounts() {
    try {
        const storageClient = new StorageManagementClient(credential, subscriptionId);
        const accounts = [];
        
        for await (const account of storageClient.storageAccounts.list()) {
            const accountDetails = {
                name: account.name,
                location: account.location,
                sku: account.sku ? account.sku.name : 'Unknown',
                kind: account.kind,
                resourceGroup: account.id.split('/')[4],
                createdTime: account.creationTime,
                primaryEndpoints: account.primaryEndpoints,
                containers: [],
                totalSizeGB: 0,
                blobCount: 0
            };
            
            try {
                // Get storage account keys
                const keys = await storageClient.storageAccounts.listKeys(
                    accountDetails.resourceGroup, 
                    account.name
                );
                
                if (keys.keys && keys.keys.length > 0 && account.primaryEndpoints?.blob) {
                    // Create blob service client to get container details
                    const blobServiceClient = StorageBlobClient.fromConnectionString(
                        `DefaultEndpointsProtocol=https;AccountName=${account.name};AccountKey=${keys.keys[0].value};EndpointSuffix=core.windows.net`
                    );
                    
                    // List containers and their properties
                    for await (const container of blobServiceClient.listContainers()) {
                        const containerClient = blobServiceClient.getContainerClient(container.name);
                        const containerProps = await containerClient.getProperties();
                        
                        let containerSize = 0;
                        let blobCount = 0;
                        
                        // Get blob statistics for container
                        try {
                            for await (const blob of containerClient.listBlobsFlat()) {
                                containerSize += blob.properties.contentLength || 0;
                                blobCount++;
                            }
                        } catch (err) {
                            console.log(`Could not list blobs in container ${container.name}:`, err.message);
                        }
                        
                        accountDetails.containers.push({
                            name: container.name,
                            publicAccess: container.properties?.publicAccess || 'private',
                            lastModified: container.properties?.lastModified,
                            sizeBytes: containerSize,
                            blobCount: blobCount
                        });
                        
                        accountDetails.totalSizeGB += containerSize / (1024 * 1024 * 1024);
                        accountDetails.blobCount += blobCount;
                    }
                }
            } catch (error) {
                console.log(`Could not get detailed info for storage account ${account.name}:`, error.message);
            }
            
            accounts.push(accountDetails);
        }
        
        return accounts;
    } catch (error) {
        console.error('Error fetching storage accounts:', error);
        throw new Error(`Failed to fetch storage accounts: ${error.message}`);
    }
}

// Enhanced Kubernetes metrics with cluster details
async function fetchKubernetesMetrics() {
    try {
        const aksClient = new ContainerServiceClient(credential, subscriptionId);
        const clusters = [];
        let totalNodes = 0;
        let totalCpu = 0;
        let totalMemory = 0;
        
        for await (const cluster of aksClient.managedClusters.list()) {
            // Extract resource group from the cluster ID
            const resourceGroupName = cluster.id ? cluster.id.split('/')[4] : null;
            if (!resourceGroupName) {
                console.log(`Could not extract resource group for cluster ${cluster.name}`);
                continue;
            }
            
            const agentPools = [];
            for await (const pool of aksClient.agentPools.list(resourceGroupName, cluster.name)) {
                agentPools.push({
                    name: pool.name,
                    count: pool.count || 0,
                    vmSize: pool.vmSize,
                    mode: pool.mode,
                    osType: pool.osType,
                    orchestratorVersion: pool.orchestratorVersion
                });
                totalNodes += pool.count || 0;
            }
            
            const clusterDetails = {
                name: cluster.name,
                location: cluster.location,
                resourceGroup: resourceGroupName,
                kubernetesVersion: cluster.kubernetesVersion,
                nodeCount: cluster.agentPoolProfiles ? cluster.agentPoolProfiles.reduce((sum, p) => sum + (p.count || 0), 0) : 0,
                agentPools: agentPools,
                status: cluster.provisioningState,
                fqdn: cluster.fqdn,
                networkProfile: cluster.networkProfile,
                addonProfiles: cluster.addonProfiles,
                powerState: cluster.powerState?.code
            };
            
            // Get metrics if available
            const monitorClient = new MonitorClient(credential, subscriptionId);
            try {
                const resourceId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.ContainerService/managedClusters/${cluster.name}`;
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
                    if (latestCpu) {
                        clusterDetails.cpuUsage = latestCpu;
                        totalCpu += latestCpu;
                    }
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
                    if (latestMemory) {
                        clusterDetails.memoryUsage = latestMemory;
                        totalMemory += latestMemory;
                    }
                }
            } catch (metricsError) {
                console.log(`Could not fetch metrics for cluster ${cluster.name}:`, metricsError.message);
            }
            
            clusters.push(clusterDetails);
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

// Enhanced backup status
async function fetchBackupStatus() {
    try {
        const vaultClient = new RecoveryServicesClient(credential, subscriptionId);
        const backupClient = new RecoveryServicesBackupClient(credential, subscriptionId);
        const backupVaults = [];
        
        // List all Recovery Services vaults
        for await (const vault of vaultClient.vaults.listBySubscriptionId()) {
            const vaultResourceGroup = vault.id.split('/')[4];
            const vaultDetails = {
                name: vault.name,
                location: vault.location,
                resourceGroup: vaultResourceGroup,
                protectedItems: [],
                jobs: [],
                alerts: []
            };
            
            try {
                // Get protected items
                for await (const item of backupClient.backupProtectedItems.list(vaultResourceGroup, vault.name)) {
                    vaultDetails.protectedItems.push({
                        name: item.name,
                        type: item.properties?.protectedItemType,
                        status: item.properties?.protectionStatus,
                        lastBackupTime: item.properties?.lastBackupTime,
                        policyName: item.properties?.policyName
                    });
                }
                
                // Get recent backup jobs
                const jobs = await backupClient.backupJobs.list(vaultResourceGroup, vault.name);
                for await (const job of jobs) {
                    if (job.properties?.startTime) {
                        const startTime = new Date(job.properties.startTime);
                        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                        if (startTime > dayAgo) {
                            vaultDetails.jobs.push({
                                name: job.name,
                                status: job.properties?.status,
                                operation: job.properties?.operation,
                                startTime: job.properties?.startTime,
                                endTime: job.properties?.endTime
                            });
                        }
                    }
                }
            } catch (error) {
                console.log(`Could not get backup details for vault ${vault.name}:`, error.message);
            }
            
            backupVaults.push(vaultDetails);
        }
        
        // Calculate summary
        const totalProtectedItems = backupVaults.reduce((sum, v) => sum + v.protectedItems.length, 0);
        const failedJobs = backupVaults.reduce((sum, v) => 
            sum + v.jobs.filter(j => j.status === 'Failed').length, 0);
        const successfulJobs = backupVaults.reduce((sum, v) => 
            sum + v.jobs.filter(j => j.status === 'Completed').length, 0);
        
        return {
            vaults: backupVaults,
            summary: {
                totalVaults: backupVaults.length,
                totalProtectedItems,
                failedJobs,
                successfulJobs,
                status: failedJobs > 0 ? 'Warning' : 'Healthy'
            }
        };
    } catch (error) {
        console.error('Error fetching backup status:', error);
        // Return basic status if backup APIs are not available
        return {
            vaults: [],
            summary: {
                totalVaults: 0,
                totalProtectedItems: 0,
                failedJobs: 0,
                successfulJobs: 0,
                status: 'Unknown'
            }
        };
    }
}

// Enhanced GPT usage with model breakdown
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
        const monitorClient = new MonitorClient(credential, subscriptionId);
        const openAIAccounts = [];
        const modelUsage = {};
        let totalTokens = 0;
        let totalCost = 0;
        
        // Find OpenAI accounts
        for await (const account of cognitiveClient.accounts.list()) {
            if (account.kind === 'OpenAI') {
                const accountResourceGroup = account.id.split('/')[4];
                openAIAccounts.push({
                    name: account.name,
                    location: account.location,
                    resourceGroup: accountResourceGroup,
                    endpoint: account.properties?.endpoint,
                    deployments: []
                });
                
                // Get deployments for this account
                try {
                    const deployments = await cognitiveClient.deployments.list(
                        accountResourceGroup,
                        account.name
                    );
                    
                    for await (const deployment of deployments) {
                        const deploymentInfo = {
                            name: deployment.name,
                            model: deployment.properties?.model?.name,
                            version: deployment.properties?.model?.version,
                            capacity: deployment.sku?.capacity
                        };
                        
                        openAIAccounts[openAIAccounts.length - 1].deployments.push(deploymentInfo);
                        
                        // Initialize model usage tracking
                        if (!modelUsage[deploymentInfo.model]) {
                            modelUsage[deploymentInfo.model] = {
                                tokens: 0,
                                requests: 0,
                                cost: 0
                            };
                        }
                    }
                } catch (error) {
                    console.log(`Could not get deployments for account ${account.name}:`, error.message);
                }
            }
        }
        
        // Get usage metrics for OpenAI accounts with model breakdown
        if (openAIAccounts.length > 0) {
            for (const account of openAIAccounts) {
                try {
                    const resourceId = `/subscriptions/${subscriptionId}/resourceGroups/${account.resourceGroup}/providers/Microsoft.CognitiveServices/accounts/${account.name}`;
                    const endTime = new Date();
                    const startTime = new Date(endTime.getTime() - 30 * 24 * 60 * 60 * 1000); // Last 30 days
                    
                    // Get token transactions
                    const metrics = await monitorClient.metrics.list(
                        resourceId,
                        {
                            timespan: `${startTime.toISOString()}/${endTime.toISOString()}`,
                            metricnames: 'TokenTransaction',
                            aggregation: 'Total',
                            interval: 'P1D'  // Daily aggregation
                        }
                    );
                    
                    if (metrics.value && metrics.value[0] && metrics.value[0].timeseries) {
                        for (const series of metrics.value[0].timeseries) {
                            // Try to extract model from metadata dimensions
                            const modelName = series.metadatavalues?.find(m => m.name?.value === 'ModelDeploymentName')?.value || 'Unknown';
                            
                            if (series.data) {
                                for (const dataPoint of series.data) {
                                    const tokens = dataPoint.total || 0;
                                    totalTokens += tokens;
                                    
                                    // Distribute tokens across deployments or use model from metadata
                                    if (modelName !== 'Unknown') {
                                        if (!modelUsage[modelName]) {
                                            modelUsage[modelName] = { tokens: 0, requests: 0, cost: 0 };
                                        }
                                        modelUsage[modelName].tokens += tokens;
                                    } else if (account.deployments.length > 0) {
                                        // Distribute evenly if we can't determine the model
                                        const tokensPerDeployment = tokens / account.deployments.length;
                                        account.deployments.forEach(deployment => {
                                            modelUsage[deployment.model].tokens += tokensPerDeployment;
                                        });
                                    }
                                }
                            }
                        }
                    }
                    
                    // Get request counts
                    const requestMetrics = await monitorClient.metrics.list(
                        resourceId,
                        {
                            timespan: `${startTime.toISOString()}/${endTime.toISOString()}`,
                            metricnames: 'ProcessedPromptTokens,GeneratedTokens',
                            aggregation: 'Total'
                        }
                    );
                    
                    // Process additional metrics if available
                    if (requestMetrics.value) {
                        for (const metric of requestMetrics.value) {
                            if (metric.timeseries) {
                                for (const series of metric.timeseries) {
                                    if (series.data) {
                                        for (const dataPoint of series.data) {
                                            totalTokens += dataPoint.total || 0;
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (metricsError) {
                    console.log(`Could not fetch metrics for OpenAI account ${account.name}:`, metricsError.message);
                }
            }
        }
        
        // Calculate costs based on model
        Object.keys(modelUsage).forEach(model => {
            // Approximate costs per 1K tokens
            let costPer1K = 0.002; // Default
            if (model?.includes('gpt-4')) {
                costPer1K = 0.03;
            } else if (model?.includes('gpt-3.5')) {
                costPer1K = 0.002;
            } else if (model?.includes('davinci')) {
                costPer1K = 0.02;
            }
            
            modelUsage[model].cost = (modelUsage[model].tokens / 1000) * costPer1K;
            totalCost += modelUsage[model].cost;
        });
        
        const gptUsage = {
            accounts: openAIAccounts,
            modelUsage: modelUsage,
            totalTokens: totalTokens,
            estimatedCost: totalCost,
            period: '30d'
        };
        
        // Cache the data
        await setCachedData(cacheKey, gptUsage);
        
        return gptUsage;
    } catch (error) {
        console.error('Error fetching GPT usage:', error);
        throw new Error(`Failed to fetch GPT usage: ${error.message}`);
    }
}

// Enhanced resource fetching using Resource Graph
async function fetchResourcesInResourceGroup(resourceGroupName) {
    try {
        const graphClient = new ResourceGraphClient(credential);
        
        // Query for all resources in the specific resource group
        // Using tolower() for case-insensitive comparison
        const query = {
            subscriptions: [subscriptionId],
            query: `
                Resources
                | where subscriptionId == '${subscriptionId}' 
                | where tolower(resourceGroup) == tolower('${resourceGroupName}')
                | project name, type, location, id, kind, properties, tags, resourceGroup
                | order by type asc, name asc
                | limit 1000
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
                    url = resource.properties?.defaultHostname ? 
                        `https://${resource.properties.defaultHostname}` : 
                        `https://${resource.name}.azurestaticapps.net`;
                } else if (resource.type === 'microsoft.storage/storageaccounts') {
                    url = resource.properties?.primaryEndpoints?.web || 
                          resource.properties?.primaryEndpoints?.blob;
                }
                
                resources.push({
                    name: resource.name,
                    type: resource.type,
                    shortType: resource.type.split('/').pop(),
                    location: resource.location,
                    id: resource.id,
                    kind: resource.kind,
                    url: url,
                    tags: resource.tags || {}
                });
            });
        }
        
        return resources;
    } catch (error) {
        console.error(`Error fetching resources for resource group ${resourceGroupName}:`, error);
        throw new Error(`Failed to fetch resources: ${error.message}`);
    }
}

// Fetch all resource groups
async function fetchResourceGroups() {
    try {
        const resourceClient = new ResourceManagementClient(credential, subscriptionId);
        const resourceGroups = [];
        
        for await (const rg of resourceClient.resourceGroups.list()) {
            resourceGroups.push({
                name: rg.name,
                location: rg.location,
                id: rg.id,
                tags: rg.tags || {}
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
    methods: ['GET', 'POST', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log('Enhanced metrics function triggered');
        
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                }
            };
        }
        
        const response = {
            subscriptionId: subscriptionId,
            resourceGroup: resourceGroupName,
            timestamp: new Date().toISOString(),
            errors: []
        };
        
        try {
            // Fetch all data in parallel where possible
            const [costData, resourceData, storageData, k8sData, gptData, backupData] = await Promise.allSettled([
                fetchCostData(),
                fetchResourceCounts(),
                fetchStorageAccounts(),
                fetchKubernetesMetrics(),
                fetchGPTUsage(),
                fetchBackupStatus()
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
            
            // Handle backup status
            if (backupData.status === 'fulfilled') {
                response.backupStatus = backupData.value;
            } else {
                response.backupStatus = null;
                response.errors.push({
                    type: 'backup',
                    message: backupData.reason?.message || 'Failed to fetch backup status'
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
            context.log.error('Error in enhanced metrics function:', error);
            
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
            const resources = await fetchResourcesInResourceGroup(resourceGroup);
            
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
                    count: resources.length,
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
