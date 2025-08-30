const { app } = require('@azure/functions');
const { DefaultAzureCredential } = require('@azure/identity');
const { CostManagementClient } = require('@azure/arm-costmanagement');
const { ResourceGraphClient } = require('@azure/arm-resourcegraph');
const { StorageManagementClient } = require('@azure/arm-storage');
const { ContainerServiceClient } = require('@azure/arm-containerservice');
const { MonitorClient } = require('@azure/arm-monitor');
const { CognitiveServicesManagementClient } = require('@azure/arm-cognitiveservices');
const { ResourceManagementClient } = require('@azure/arm-resources');
const { RecoveryServicesBackupClient } = require('@azure/arm-recoveryservicesbackup');
const { RecoveryServicesClient } = require('@azure/arm-recoveryservices');
const { WebSiteManagementClient } = require('@azure/arm-appservice');
const { TableClient } = require('@azure/data-tables');
const { BlobServiceClient: StorageBlobClient } = require('@azure/storage-blob');
const axios = require('axios');

// Configuration
const subscriptionId = '3cfb259a-f02a-484e-9ce3-d83c21fd0ddb';
const resourceGroupName = 'saxtech-ai'; // Fixed: using lowercase
const credential = new DefaultAzureCredential();

// Table Storage configuration for caching
const tableStorageConnectionString = process.env.AzureWebJobsStorage || '';
const cacheTableName = 'metricscache';
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour cache

// Initialize Table Client
let tableClient;
try {
    if (tableStorageConnectionString) {
        tableClient = TableClient.fromConnectionString(tableStorageConnectionString, cacheTableName);
        tableClient.createTable().catch(() => {});
    }
} catch (error) {
    console.error('Failed to initialize Table Storage:', error);
}

// Cache helpers
async function getCachedData(key) {
    if (!tableClient) return null;
    try {
        const entity = await tableClient.getEntity('cache', key);
        const age = Date.now() - new Date(entity.timestamp).getTime();
        if (age < CACHE_DURATION_MS) {
            return JSON.parse(entity.data);
        }
    } catch (error) {
        return null;
    }
    return null;
}

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

// FIXED: Proper daily cost aggregation
async function fetchCostData(bypassCache = false) {
    const cacheKey = 'costData';
    
    if (!bypassCache) {
        const cachedCost = await getCachedData(cacheKey);
        if (cachedCost && cachedCost.monthToDate > 0) {
            console.log('Returning cached cost data');
            return cachedCost;
        }
    }
    
    try {
        const costClient = new CostManagementClient(credential);
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        
        // Query for daily aggregated costs
        const query = {
            type: 'ActualCost',
            timeframe: 'Custom',
            timePeriod: {
                from: thirtyDaysAgo.toISOString().split('T')[0],
                to: tomorrow.toISOString().split('T')[0]
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
        
        // Aggregate costs by day
        const dailyCosts = {};
        const costBreakdown = {};
        let monthToDate = 0;
        
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        if (result.rows && result.rows.length > 0) {
            result.rows.forEach(row => {
                // Azure returns [cost, date, currency] OR [cost, date, service] depending on grouping
                const cost = parseFloat(row[0]) || 0;
                const dateInt = row[1]; // This is already an integer like 20250829
                let service = 'Total';
                
                // Check if third element is currency or service name
                if (row[2] && row[2] !== 'USD' && row[2] !== 'EUR') {
                    service = row[2];
                }
                
                // Parse date from integer format (20250829) to Date object
                const dateStr = String(dateInt);
                const year = parseInt(dateStr.substring(0, 4));
                const month = parseInt(dateStr.substring(4, 6)) - 1; // JS months are 0-indexed
                const day = parseInt(dateStr.substring(6, 8));
                const date = new Date(year, month, day);
                const dateKey = date.toISOString().split('T')[0];
                
                // Aggregate daily totals
                if (!dailyCosts[dateKey]) {
                    dailyCosts[dateKey] = {
                        date: dateInt,
                        dateStr: dateKey,
                        cost: 0,
                        services: {}
                    };
                }
                
                dailyCosts[dateKey].cost += cost;
                dailyCosts[dateKey].services[service] = (dailyCosts[dateKey].services[service] || 0) + cost;
                
                // Track month-to-date
                if (date >= startOfMonth) {
                    monthToDate += cost;
                }
                
                // Service breakdown
                if (!costBreakdown[service]) {
                    costBreakdown[service] = 0;
                }
                costBreakdown[service] += cost;
            });
        }
        
        // Convert to historical array and sort
        const historical = Object.values(dailyCosts)
            .map(day => ({
                date: day.date,
                dateStr: day.dateStr,
                cost: day.cost,
                services: day.services
            }))
            .sort((a, b) => a.date - b.date);
        
        // Get yesterday's total cost
        const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const yesterdayKey = yesterdayDate.toISOString().split('T')[0];
        const yesterday = dailyCosts[yesterdayKey]?.cost || 0;
        
        // Return actual data even if zero - NO FAKE DATA
        console.log(`Cost data: MTD=${monthToDate}, Yesterday=${yesterday}, Historical=${historical.length} records`);
        
        const costData = {
            monthToDate,
            yesterday,
            currency: 'USD',
            historical,
            costBreakdown,
            dailyCosts
        };
        
        await setCachedData(cacheKey, costData);
        return costData;
    } catch (error) {
        console.error('Error fetching cost data:', error);
        throw new Error(`Failed to fetch cost data: ${error.message}`);
    }
}

// FIXED: Using Resource Management API instead of Resource Graph
async function fetchResourceCounts() {
    try {
        const resourceClient = new ResourceManagementClient(credential, subscriptionId);
        const webClient = new WebSiteManagementClient(credential, subscriptionId);
        const storageClient = new StorageManagementClient(credential, subscriptionId);
        
        let staticSites = 0;
        let functionApps = 0;
        let storageAccounts = 0;
        let totalResources = 0;
        const resourceDetails = {
            staticSites: [],
            functionApps: [],
            storageAccounts: []
        };
        
        // Fetch all resources using Resource Management API
        console.log('Fetching resources using Resource Management API...');
        
        // Method 1: Try using WebSiteManagementClient for web resources
        try {
            // Get Static Web Apps with custom domains
            for await (const staticSite of webClient.staticSites.list()) {
                staticSites++;
                
                // Get custom domains
                let customDomains = [];
                try {
                    const rgName = staticSite.id?.split('/')[4];
                    if (rgName) {
                        const domains = webClient.staticSites.listStaticSiteCustomDomains(rgName, staticSite.name);
                        for await (const domain of domains) {
                            customDomains.push(domain.domainName || domain);
                        }
                    }
                } catch (err) {
                    console.log(`Could not get custom domains for ${staticSite.name}`);
                }
                
                resourceDetails.staticSites.push({
                    name: staticSite.name,
                    location: staticSite.location,
                    resourceGroup: staticSite.id?.split('/')[4] || 'unknown',
                    id: staticSite.id,
                    endpoint: staticSite.defaultHostname ? 
                        `https://${staticSite.defaultHostname}` : 
                        `https://${staticSite.name}.azurestaticapps.net`,
                    customDomains: customDomains,
                    sku: staticSite.sku?.name || 'Free',
                    tier: staticSite.sku?.tier || 'Free',
                    monthlyCost: staticSite.sku?.name === 'Standard' ? 9 : 0,
                    properties: staticSite,
                    tags: staticSite.tags || {},
                    createdTime: staticSite.systemData?.createdAt
                });
            }
            console.log(`Found ${staticSites} static web apps`);
            
            // Get all Web Apps (includes Function Apps) with function details
            for await (const site of webClient.webApps.list()) {
                totalResources++;
                const kind = (site.kind || '').toLowerCase();
                if (kind.includes('functionapp')) {
                    functionApps++;
                    
                    // Get function list
                    let functionsList = [];
                    try {
                        const rgName = site.id?.split('/')[4];
                        if (rgName) {
                            const functions = webClient.webApps.listFunctions(rgName, site.name);
                            for await (const func of functions) {
                                functionsList.push({
                                    name: func.name?.split('/').pop() || func.name,
                                    language: func.config?.bindings?.[0]?.type || 'Unknown',
                                    isDisabled: func.config?.disabled || false
                                });
                            }
                        }
                    } catch (err) {
                        console.log(`Could not get functions for ${site.name}`);
                    }
                    
                    const isLinux = kind.includes('linux');
                    const osType = isLinux ? 'Linux' : 'Windows';
                    
                    resourceDetails.functionApps.push({
                        name: site.name,
                        location: site.location,
                        resourceGroup: site.id?.split('/')[4] || 'unknown',
                        id: site.id,
                        kind: site.kind,
                        osType: osType,
                        runtime: site.siteConfig?.linuxFxVersion || site.siteConfig?.nodeVersion || 'Unknown',
                        endpoint: site.defaultHostName ? 
                            `https://${site.defaultHostName}` : 
                            `https://${site.name}.azurewebsites.net`,
                        state: site.state,
                        sku: site.sku || 'Consumption',
                        functionCount: functionsList.length,
                        functions: functionsList,
                        properties: site,
                        tags: site.tags || {},
                        createdTime: site.systemData?.createdAt
                    });
                }
            }
            console.log(`Found ${functionApps} function apps`);
        } catch (webError) {
            console.log('Error fetching web resources:', webError.message);
        }
        
        // Method 2: Fallback to generic resource listing
        if (staticSites === 0 && functionApps === 0) {
            console.log('Trying fallback method with generic resource listing...');
            for await (const resource of resourceClient.resources.list()) {
                totalResources++;
                const type = (resource.type || '').toLowerCase();
                const kind = (resource.kind || '').toLowerCase();
                
                if (type === 'microsoft.web/staticsites' && !resourceDetails.staticSites.find(s => s.id === resource.id)) {
                    staticSites++;
                    resourceDetails.staticSites.push({
                        name: resource.name,
                        location: resource.location,
                        resourceGroup: resource.id?.split('/')[4] || 'unknown',
                        id: resource.id,
                        endpoint: `https://${resource.name}.azurestaticapps.net`,
                        properties: resource.properties || {},
                        tags: resource.tags || {}
                    });
                } else if (type === 'microsoft.web/sites' && kind.includes('functionapp') && 
                          !resourceDetails.functionApps.find(f => f.id === resource.id)) {
                    functionApps++;
                    resourceDetails.functionApps.push({
                        name: resource.name,
                        location: resource.location,
                        resourceGroup: resource.id?.split('/')[4] || 'unknown',
                        id: resource.id,
                        kind: resource.kind,
                        endpoint: `https://${resource.name}.azurewebsites.net`,
                        properties: resource.properties || {},
                        tags: resource.tags || {}
                    });
                } else if (type === 'microsoft.storage/storageaccounts') {
                    storageAccounts++;
                    resourceDetails.storageAccounts.push({
                        name: resource.name,
                        location: resource.location,
                        resourceGroup: resource.id?.split('/')[4] || 'unknown',
                        id: resource.id,
                        properties: resource.properties || {},
                        tags: resource.tags || {}
                    });
                }
            }
        }
        
        // Get Storage Accounts using dedicated client (most reliable)
        if (storageAccounts === 0) {
            for await (const account of storageClient.storageAccounts.list()) {
                if (!resourceDetails.storageAccounts.find(s => s.id === account.id)) {
                    storageAccounts++;
                    resourceDetails.storageAccounts.push({
                        name: account.name,
                        location: account.location,
                        resourceGroup: account.id?.split('/')[4] || 'unknown',
                        id: account.id,
                        sku: account.sku?.name,
                        kind: account.kind,
                        properties: account,
                        tags: account.tags || {}
                    });
                }
            }
            console.log(`Found ${storageAccounts} storage accounts`);
        }
        
        console.log(`Total counts - Static Sites: ${staticSites}, Function Apps: ${functionApps}, Storage: ${storageAccounts}`);
        
        return {
            counts: {
                staticSites,
                functionApps,
                storageAccounts,
                totalResources
            },
            details: resourceDetails
        };
    } catch (error) {
        console.error('Error fetching resource counts:', error);
        return {
            counts: {
                staticSites: 0,
                functionApps: 0,
                storageAccounts: 0,
                totalResources: 0
            },
            details: {
                staticSites: [],
                functionApps: [],
                storageAccounts: []
            }
        };
    }
}

// FIXED: Storage account sizing with proper blob enumeration
async function fetchStorageAccounts() {
    try {
        const storageClient = new StorageManagementClient(credential, subscriptionId);
        const monitorClient = new MonitorClient(credential, subscriptionId);
        const accounts = [];
        
        for await (const account of storageClient.storageAccounts.list()) {
            const accountDetails = {
                name: account.name,
                location: account.location,
                sku: account.sku?.name || 'Unknown',
                kind: account.kind,
                resourceGroup: account.id.split('/')[4],
                createdTime: account.creationTime,
                primaryEndpoints: account.primaryEndpoints,
                containers: [],
                totalSizeGB: 0,
                blobCount: 0,
                usedCapacityBytes: 0
            };
            
            try {
                // Get metrics for storage account capacity
                const resourceId = account.id;
                const endTime = new Date();
                const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
                
                const metricsResult = await monitorClient.metrics.list(
                    resourceId,
                    {
                        timespan: `${startTime.toISOString()}/${endTime.toISOString()}`,
                        metricnames: 'UsedCapacity',
                        aggregation: 'Average'
                    }
                );
                
                if (metricsResult.value && metricsResult.value[0]?.timeseries?.[0]?.data?.length > 0) {
                    const latestData = metricsResult.value[0].timeseries[0].data.slice(-1)[0];
                    accountDetails.usedCapacityBytes = latestData.average || 0;
                    accountDetails.totalSizeGB = accountDetails.usedCapacityBytes / (1024 * 1024 * 1024);
                }
                
                // Try to get container details
                const keys = await storageClient.storageAccounts.listKeys(
                    accountDetails.resourceGroup,
                    account.name
                );
                
                if (keys.keys && keys.keys.length > 0 && account.primaryEndpoints?.blob) {
                    const blobServiceClient = StorageBlobClient.fromConnectionString(
                        `DefaultEndpointsProtocol=https;AccountName=${account.name};AccountKey=${keys.keys[0].value};EndpointSuffix=core.windows.net`
                    );
                    
                    // List containers with size estimates
                    for await (const container of blobServiceClient.listContainers()) {
                        const containerClient = blobServiceClient.getContainerClient(container.name);
                        let containerSize = 0;
                        let blobCount = 0;
                        
                        // Sample first 100 blobs for size estimate
                        const iterator = containerClient.listBlobsFlat().byPage({ maxPageSize: 100 });
                        const response = await iterator.next();
                        
                        if (!response.done && response.value?.segment?.blobItems) {
                            for (const blob of response.value.segment.blobItems) {
                                containerSize += blob.properties.contentLength || 0;
                                blobCount++;
                            }
                            
                            // Estimate total if there are more blobs
                            if (response.value.continuationToken) {
                                // Rough estimate based on sample
                                blobCount = Math.round(blobCount * 10); // Estimate
                                containerSize = containerSize * 10; // Estimate
                            }
                        }
                        
                        accountDetails.containers.push({
                            name: container.name,
                            publicAccess: container.properties?.publicAccess || 'private',
                            lastModified: container.properties?.lastModified,
                            sizeBytes: containerSize,
                            blobCount: blobCount,
                            estimated: blobCount > 100
                        });
                        
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
        return [];
    }
}

// FIXED: Enhanced Kubernetes details
async function fetchKubernetesMetrics() {
    try {
        const aksClient = new ContainerServiceClient(credential, subscriptionId);
        const monitorClient = new MonitorClient(credential, subscriptionId);
        const clusters = [];
        let totalNodes = 0;
        let totalCpu = 0;
        let totalMemory = 0;
        let totalPods = 0;
        
        for await (const cluster of aksClient.managedClusters.list()) {
            const resourceGroupName = cluster.id ? cluster.id.split('/')[4] : null;
            if (!resourceGroupName) continue;
            
            const agentPools = [];
            let clusterNodeCount = 0;
            
            for await (const pool of aksClient.agentPools.list(resourceGroupName, cluster.name)) {
                const poolDetails = {
                    name: pool.name,
                    count: pool.count || 0,
                    vmSize: pool.vmSize,
                    mode: pool.mode,
                    osType: pool.osType,
                    orchestratorVersion: pool.orchestratorVersion,
                    maxPods: pool.maxPods || 30,
                    nodeLabels: pool.nodeLabels,
                    nodeTaints: pool.nodeTaints
                };
                agentPools.push(poolDetails);
                clusterNodeCount += pool.count || 0;
                totalNodes += pool.count || 0;
                totalPods += (pool.count || 0) * (pool.maxPods || 30);
            }
            
            const clusterDetails = {
                name: cluster.name,
                location: cluster.location,
                resourceGroup: resourceGroupName,
                kubernetesVersion: cluster.kubernetesVersion,
                nodeCount: clusterNodeCount,
                agentPools: agentPools,
                status: cluster.provisioningState,
                fqdn: cluster.fqdn,
                networkProfile: {
                    networkPlugin: cluster.networkProfile?.networkPlugin,
                    serviceCidr: cluster.networkProfile?.serviceCidr,
                    dnsServiceIP: cluster.networkProfile?.dnsServiceIP,
                    dockerBridgeCidr: cluster.networkProfile?.dockerBridgeCidr
                },
                addonProfiles: cluster.addonProfiles ? Object.keys(cluster.addonProfiles).filter(key => 
                    cluster.addonProfiles[key]?.enabled
                ) : [],
                powerState: cluster.powerState?.code,
                maxPodsCapacity: totalPods,
                features: {
                    rbac: cluster.enableRBAC,
                    privateCluster: cluster.apiServerAccessProfile?.enablePrivateCluster,
                    monitoring: cluster.addonProfiles?.omsagent?.enabled || false
                }
            };
            
            // Get cluster metrics
            try {
                const resourceId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.ContainerService/managedClusters/${cluster.name}`;
                const endTime = new Date();
                const startTime = new Date(endTime.getTime() - 60 * 60 * 1000); // Last hour
                
                // CPU metrics
                const cpuMetrics = await monitorClient.metrics.list(
                    resourceId,
                    {
                        timespan: `${startTime.toISOString()}/${endTime.toISOString()}`,
                        metricnames: 'node_cpu_usage_percentage',
                        aggregation: 'Average',
                        interval: 'PT5M'
                    }
                );
                
                if (cpuMetrics.value?.[0]?.timeseries?.[0]?.data?.length > 0) {
                    const cpuData = cpuMetrics.value[0].timeseries[0].data;
                    const avgCpu = cpuData.reduce((sum, d) => sum + (d.average || 0), 0) / cpuData.length;
                    clusterDetails.cpuUsage = avgCpu;
                    totalCpu += avgCpu;
                }
                
                // Memory metrics
                const memoryMetrics = await monitorClient.metrics.list(
                    resourceId,
                    {
                        timespan: `${startTime.toISOString()}/${endTime.toISOString()}`,
                        metricnames: 'node_memory_working_set_percentage',
                        aggregation: 'Average',
                        interval: 'PT5M'
                    }
                );
                
                if (memoryMetrics.value?.[0]?.timeseries?.[0]?.data?.length > 0) {
                    const memData = memoryMetrics.value[0].timeseries[0].data;
                    const avgMem = memData.reduce((sum, d) => sum + (d.average || 0), 0) / memData.length;
                    clusterDetails.memoryUsage = avgMem;
                    totalMemory += avgMem;
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
            totalPodsCapacity: totalPods,
            avgCpuUsage: clusters.length > 0 ? (totalCpu / clusters.length).toFixed(2) : 0,
            avgMemoryUsage: clusters.length > 0 ? (totalMemory / clusters.length).toFixed(2) : 0
        };
    } catch (error) {
        console.error('Error fetching Kubernetes metrics:', error);
        return {
            clusterCount: 0,
            clusters: [],
            totalNodes: 0,
            totalPodsCapacity: 0,
            avgCpuUsage: 0,
            avgMemoryUsage: 0
        };
    }
}

// FIXED: Backup status including Kubernetes backup detection
async function fetchBackupStatus() {
    try {
        const graphClient = new ResourceGraphClient(credential);
        const storageClient = new StorageManagementClient(credential, subscriptionId);
        
        // Check for n8n Kubernetes backup storage
        let kubernetesBackup = null;
        try {
            // Check if the n8n backup storage account exists
            const backupStorage = await storageClient.storageAccounts.getProperties('saxtech-ai', 'saxtechn8nbackups');
            if (backupStorage) {
                kubernetesBackup = {
                    type: 'Kubernetes CronJob',
                    storageAccount: 'saxtechn8nbackups',
                    container: 'n8n-backups',
                    schedule: 'Every 6 hours',
                    components: ['PostgreSQL Database', 'n8n Files'],
                    status: 'Active'
                };
            }
        } catch (e) {
            // Storage account doesn't exist or not accessible
        }
        
        // Query for traditional backup vaults
        const vaultQuery = {
            subscriptions: [subscriptionId],
            query: `
                Resources
                | where subscriptionId =~ '${subscriptionId}'
                | where type =~ 'microsoft.recoveryservices/vaults' or type =~ 'microsoft.dataprotection/backupvaults'
                | project name, type, location, resourceGroup, id, properties
            `
        };
        
        const vaultResult = await graphClient.resources(vaultQuery);
        const vaults = [];
        let totalProtectedItems = 0;
        let totalVaults = 0;
        
        if (vaultResult.data && vaultResult.data.length > 0) {
            for (const vault of vaultResult.data) {
                totalVaults++;
                vaults.push({
                    name: vault.name,
                    type: vault.type,
                    location: vault.location,
                    resourceGroup: vault.resourceGroup,
                    protectedItems: [],
                    jobs: []
                });
            }
        }
        
        // Try to get protected items count from properties
        const protectedItemsQuery = {
            subscriptions: [subscriptionId],
            query: `
                Resources
                | where subscriptionId =~ '${subscriptionId}'
                | where type contains 'backup'
                | summarize count() by type
            `
        };
        
        const protectedResult = await graphClient.resources(protectedItemsQuery);
        if (protectedResult.data && protectedResult.data.length > 0) {
            totalProtectedItems = protectedResult.totalRecords || 0;
        }
        
        return {
            vaults: vaults,
            kubernetesBackup: kubernetesBackup,
            summary: {
                totalVaults: totalVaults,
                totalProtectedItems: totalProtectedItems,
                failedJobs: 0,
                successfulJobs: 0,
                status: kubernetesBackup ? 'Kubernetes Backup Active' : (totalVaults > 0 ? 'Configured' : 'Not Configured')
            }
        };
    } catch (error) {
        console.error('Error fetching backup status:', error);
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

// FIXED: GPT usage with proper OpenAI metrics
async function fetchGPTUsage(bypassCache = false) {
    const cacheKey = 'gptUsage';
    
    if (!bypassCache) {
        const cachedUsage = await getCachedData(cacheKey);
        if (cachedUsage && cachedUsage.modelUsage && Object.keys(cachedUsage.modelUsage).length > 0) {
            console.log('Returning cached GPT usage data');
            return cachedUsage;
        }
    }
    
    try {
        const cognitiveClient = new CognitiveServicesManagementClient(credential, subscriptionId);
        const monitorClient = new MonitorClient(credential, subscriptionId);
        const openAIAccounts = [];
        const modelUsage = {};
        let totalTokens = 0;
        let totalCost = 0;
        const dailyUsage = {};
        
        // Find OpenAI and AIServices accounts (which can also host OpenAI models)
        for await (const account of cognitiveClient.accounts.list()) {
            if (account.kind === 'OpenAI' || account.kind === 'AIServices') {
                const accountResourceGroup = account.id.split('/')[4];
                const accountDetails = {
                    name: account.name,
                    location: account.location,
                    resourceGroup: accountResourceGroup,
                    endpoint: account.properties?.endpoint,
                    deployments: []
                };
                
                // Get deployments
                try {
                    const deployments = cognitiveClient.deployments.list(
                        accountResourceGroup,
                        account.name
                    );
                    
                    for await (const deployment of deployments) {
                        const modelName = deployment.properties?.model?.name || deployment.model?.name || deployment.name || 'Unknown';
                        const modelVersion = deployment.properties?.model?.version || deployment.model?.version || 'latest';
                        
                        accountDetails.deployments.push({
                            name: deployment.name,
                            model: modelName,
                            version: modelVersion,
                            capacity: deployment.sku?.capacity || deployment.properties?.scaleSettings?.capacity
                        });
                        
                        // Initialize model tracking
                        if (!modelUsage[modelName]) {
                            modelUsage[modelName] = {
                                tokens: 0,
                                requests: 0,
                                cost: 0,
                                deploymentName: deployment.name
                            };
                        }
                    }
                } catch (error) {
                    console.log(`Could not get deployments for ${account.name}:`, error.message);
                    // Try alternate approach for deployments
                    try {
                        // Some accounts may have deployment info in properties
                        if (account.properties?.deployments) {
                            for (const dep of account.properties.deployments) {
                                const modelName = dep.model || dep.name || 'Unknown';
                                accountDetails.deployments.push({
                                    name: dep.name,
                                    model: modelName,
                                    version: dep.version || 'latest'
                                });
                                if (!modelUsage[modelName]) {
                                    modelUsage[modelName] = {
                                        tokens: 0,
                                        requests: 0,
                                        cost: 0,
                                        deploymentName: dep.name
                                    };
                                }
                            }
                        }
                    } catch (altError) {
                        // No deployments found via alternate method either
                    }
                }
                
                // Get usage metrics
                try {
                    const resourceId = account.id;
                    const endTime = new Date();
                    const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000); // Last 7 days
                    
                    // Try multiple metric names
                    const metricNames = [
                        'ProcessedInferenceTokens',
                        'GeneratedCompletionTokens', 
                        'ProcessedPromptTokens',
                        'TokenTransaction',
                        'ActiveTokens'
                    ];
                    
                    for (const metricName of metricNames) {
                        try {
                            const metrics = await monitorClient.metrics.list(
                                resourceId,
                                {
                                    timespan: `${startTime.toISOString()}/${endTime.toISOString()}`,
                                    metricnames: metricName,
                                    aggregation: 'Total',
                                    interval: 'P1D'
                                }
                            );
                            
                            if (metrics.value?.[0]?.timeseries?.[0]?.data) {
                                for (const dataPoint of metrics.value[0].timeseries[0].data) {
                                    const date = new Date(dataPoint.timeStamp).toISOString().split('T')[0];
                                    const tokens = dataPoint.total || 0;
                                    
                                    if (!dailyUsage[date]) {
                                        dailyUsage[date] = 0;
                                    }
                                    dailyUsage[date] += tokens;
                                    totalTokens += tokens;
                                    
                                    // Distribute to models
                                    if (accountDetails.deployments.length > 0) {
                                        const tokensPerModel = tokens / accountDetails.deployments.length;
                                        accountDetails.deployments.forEach(dep => {
                                            modelUsage[dep.model].tokens += tokensPerModel;
                                        });
                                    }
                                }
                            }
                        } catch (metricError) {
                            // Try next metric name
                        }
                    }
                } catch (error) {
                    console.log(`Could not fetch metrics for OpenAI account ${account.name}:`, error.message);
                }
                
                openAIAccounts.push(accountDetails);
            }
        }
        
        // Calculate costs based on actual model pricing
        Object.keys(modelUsage).forEach(model => {
            let costPer1K = 0.002; // Default
            const modelLower = model?.toLowerCase() || '';
            
            if (modelLower.includes('gpt-4o')) {
                costPer1K = 0.005; // GPT-4o pricing
            } else if (modelLower.includes('gpt-4')) {
                costPer1K = 0.03; // GPT-4 pricing
            } else if (modelLower.includes('gpt-3.5')) {
                costPer1K = 0.002; // GPT-3.5 pricing
            } else if (modelLower.includes('gpt-4.1-mini') || modelLower.includes('gpt-4o-mini')) {
                costPer1K = 0.00015; // GPT-4o-mini input pricing
            } else if (modelLower.includes('embedding') || modelLower.includes('ada')) {
                costPer1K = 0.0001; // Embedding model pricing (much cheaper!)
            } else if (modelLower.includes('davinci')) {
                costPer1K = 0.02;
            }
            
            modelUsage[model].cost = (modelUsage[model].tokens / 1000) * costPer1K;
            totalCost += modelUsage[model].cost;
        });
        
        // Convert model usage to array format for frontend
        const models = Object.keys(modelUsage).map(modelName => ({
            name: modelName,
            tokens: modelUsage[modelName].tokens,
            requests: modelUsage[modelName].requests || 0,
            cost: modelUsage[modelName].cost,
            deploymentName: modelUsage[modelName].deploymentName
        }));
        
        console.log(`GPT Usage: ${totalTokens} tokens, ${models.length} models detected`);
        
        // If we have daily usage but it's an object, convert to array
        const dailyUsageArray = [];
        if (dailyUsage && typeof dailyUsage === 'object') {
            Object.entries(dailyUsage).forEach(([date, tokens]) => {
                dailyUsageArray.push({ date, tokens });
            });
        }
        
        const gptUsage = {
            accounts: openAIAccounts,
            models: models, // Add models array that frontend expects
            modelUsage: modelUsage, // Keep for backward compatibility
            dailyUsage: dailyUsageArray.length > 0 ? dailyUsageArray : Object.entries(dailyUsage).map(([date, tokens]) => ({ date, tokens })),
            totalTokens: totalTokens,
            estimatedCost: totalCost,
            period: '7d'
        };
        
        await setCachedData(cacheKey, gptUsage);
        return gptUsage;
    } catch (error) {
        console.error('Error fetching GPT usage:', error);
        throw error; // Throw error instead of returning fake data
    }
}

// FIXED: Resources in resource group using Resource Management API
async function fetchResourcesInResourceGroup(resourceGroupName) {
    try {
        const resourceClient = new ResourceManagementClient(credential, subscriptionId);
        const resources = [];
        
        // Use Resource Management API to list resources in resource group
        console.log(`Fetching resources for resource group: ${resourceGroupName}`);
        
        for await (const resource of resourceClient.resources.listByResourceGroup(resourceGroupName)) {
            console.log(`Found resource: ${resource.name} of type ${resource.type}`);
            
            let url = null;
            const type = resource.type?.toLowerCase() || '';
            
            if (type === 'microsoft.web/sites') {
                url = `https://${resource.name}.azurewebsites.net`;
            } else if (type === 'microsoft.web/staticsites') {
                url = `https://${resource.name}.azurestaticapps.net`;
            } else if (type === 'microsoft.storage/storageaccounts') {
                url = `https://${resource.name}.blob.core.windows.net`;
            }
            
            // Estimate monthly costs based on resource type and SKU
            let estimatedMonthlyCost = 0;
            if (type === 'microsoft.web/sites') {
                // App Service pricing
                const sku = resource.sku?.name || 'F1';
                if (sku.startsWith('B')) estimatedMonthlyCost = 13.14; // Basic
                else if (sku.startsWith('S')) estimatedMonthlyCost = 73.00; // Standard
                else if (sku.startsWith('P')) estimatedMonthlyCost = 146.00; // Premium
            } else if (type === 'microsoft.web/staticsites') {
                const sku = resource.sku?.name || 'Free';
                if (sku === 'Standard') estimatedMonthlyCost = 9.00;
            } else if (type === 'microsoft.storage/storageaccounts') {
                estimatedMonthlyCost = 0.02; // Per GB, base cost
            } else if (type === 'microsoft.search/searchservices') {
                const sku = resource.sku?.name || 'free';
                if (sku.toLowerCase() === 'basic') estimatedMonthlyCost = 75.00;
                else if (sku.toLowerCase() === 'standard') estimatedMonthlyCost = 250.00;
            } else if (type === 'microsoft.cognitiveservices/accounts') {
                estimatedMonthlyCost = 0; // Pay per use
            } else if (type === 'microsoft.dbforpostgresql/servers' || type.includes('postgresql')) {
                estimatedMonthlyCost = 25.00; // Basic tier estimate
            } else if (type === 'microsoft.compute/virtualmachines') {
                estimatedMonthlyCost = 50.00; // B1s estimate
            }
            
            resources.push({
                name: resource.name,
                type: resource.type,
                shortType: resource.type.split('/').pop(),
                location: resource.location,
                id: resource.id,
                kind: resource.kind,
                sku: resource.sku?.name,
                url: url,
                estimatedMonthlyCost: estimatedMonthlyCost,
                tags: resource.tags || {}
            });
        }
        
        console.log(`Total resources found in ${resourceGroupName}: ${resources.length}`);
        return resources;
    } catch (error) {
        console.error(`Error fetching resources for resource group ${resourceGroupName}:`, error);
        
        // Fallback to Resource Graph API
        try {
            console.log('Attempting fallback to Resource Graph API...');
            const graphClient = new ResourceGraphClient(credential);
            
            const query = {
                subscriptions: [subscriptionId],
                query: `
                    Resources
                    | where subscriptionId =~ '${subscriptionId}'
                    | where resourceGroup =~ '${resourceGroupName}'
                    | project name, type, location, id, kind, sku, properties, tags
                    | order by type asc, name asc
                    | limit 1000
                `
            };
            
            const result = await graphClient.resources(query);
            const resources = [];
        
        if (result.data && result.data.length > 0) {
            result.data.forEach(resource => {
                let url = null;
                const type = resource.type?.toLowerCase() || '';
                
                if (type === 'microsoft.web/sites') {
                    url = `https://${resource.name}.azurewebsites.net`;
                } else if (type === 'microsoft.web/staticsites') {
                    url = resource.properties?.defaultHostname ? 
                        `https://${resource.properties.defaultHostname}` : 
                        `https://${resource.name}.azurestaticapps.net`;
                } else if (type === 'microsoft.storage/storageaccounts') {
                    url = resource.properties?.primaryEndpoints?.web || 
                          resource.properties?.primaryEndpoints?.blob;
                }
                
                // Estimate monthly costs based on resource type and SKU
                let estimatedMonthlyCost = 0;
                if (type === 'microsoft.web/sites') {
                    // App Service pricing
                    const sku = resource.sku?.name || resource.properties?.sku || 'F1';
                    if (sku.startsWith('B')) estimatedMonthlyCost = 13.14; // Basic
                    else if (sku.startsWith('S')) estimatedMonthlyCost = 73.00; // Standard
                    else if (sku.startsWith('P')) estimatedMonthlyCost = 146.00; // Premium
                } else if (type === 'microsoft.web/staticsites') {
                    const sku = resource.sku?.name || 'Free';
                    if (sku === 'Standard') estimatedMonthlyCost = 9.00;
                } else if (type === 'microsoft.storage/storageaccounts') {
                    estimatedMonthlyCost = 0.02; // Per GB, base cost
                } else if (type === 'microsoft.search/searchservices') {
                    const sku = resource.sku?.name || 'free';
                    if (sku.toLowerCase() === 'basic') estimatedMonthlyCost = 75.00;
                    else if (sku.toLowerCase() === 'standard') estimatedMonthlyCost = 250.00;
                } else if (type === 'microsoft.cognitiveservices/accounts') {
                    estimatedMonthlyCost = 0; // Pay per use
                } else if (type === 'microsoft.dbforpostgresql/servers' || type.includes('postgresql')) {
                    estimatedMonthlyCost = 25.00; // Basic tier estimate
                } else if (type === 'microsoft.compute/virtualmachines') {
                    estimatedMonthlyCost = 50.00; // B1s estimate
                }
                
                resources.push({
                    name: resource.name,
                    type: resource.type,
                    shortType: resource.type.split('/').pop(),
                    location: resource.location,
                    id: resource.id,
                    kind: resource.kind,
                    sku: resource.sku?.name || resource.properties?.sku,
                    url: url,
                    estimatedMonthlyCost: estimatedMonthlyCost,
                    tags: resource.tags || {}
                });
            });
        }
        
            return resources;
        } catch (fallbackError) {
            console.error(`Fallback also failed for resource group ${resourceGroupName}:`, fallbackError);
            return [];
        }
    }
}

// Fetch resource groups
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
        return [];
    }
}

// Main metrics endpoint
app.http('metrics', {
    methods: ['GET', 'POST', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log('Metrics function triggered');
        
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
            // Check if cache bypass is requested
            const url = new URL(request.url);
            const bypassCache = url.searchParams.get('nocache') === 'true' || request.body?.clearCache === true;
            
            const [costData, resourceData, storageData, k8sData, gptData, backupData] = await Promise.allSettled([
                fetchCostData(bypassCache),
                fetchResourceCounts(),
                fetchStorageAccounts(),
                fetchKubernetesMetrics(),
                fetchGPTUsage(bypassCache),
                fetchBackupStatus()
            ]);
            
            // Process results
            if (costData.status === 'fulfilled') {
                response.costs = costData.value;
            } else {
                response.costs = null;
                response.errors.push({
                    type: 'cost',
                    message: costData.reason?.message || 'Failed to fetch cost data'
                });
            }
            
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
            
            if (k8sData.status === 'fulfilled') {
                response.kubernetes = k8sData.value;
            } else {
                response.kubernetes = null;
                response.errors.push({
                    type: 'kubernetes',
                    message: k8sData.reason?.message || 'Failed to fetch Kubernetes data'
                });
            }
            
            if (gptData.status === 'fulfilled') {
                response.openAIUsage = gptData.value;
            } else {
                response.openAIUsage = null;
                response.errors.push({
                    type: 'openai',
                    message: gptData.reason?.message || 'Failed to fetch OpenAI usage'
                });
            }
            
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

// Resources endpoint
app.http('resources', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log('Resources function triggered');
        
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

// N8N Proxy endpoint to handle CORS
app.http('n8nProxy', {
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log('N8N Proxy function triggered');
        
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-N8N-API-Key'
                }
            };
        }
        
        try {
            // N8N configuration - direct IP access since domain has issues
            const N8N_BASE_URL = 'http://4.152.195.113:5678/api/v1';
            
            // Extract the path after /api/n8nProxy/
            const url = new URL(request.url);
            const pathMatch = url.pathname.match(/\/api\/n8nProxy\/(.*)/);
            const n8nPath = pathMatch ? pathMatch[1] : '';
            
            // Build the full n8n URL
            const n8nUrl = `${N8N_BASE_URL}/${n8nPath}${url.search}`;
            
            context.log(`Proxying to n8n: ${request.method} ${n8nUrl}`);
            
            // Prepare headers
            const headers = {
                'Content-Type': 'application/json'
            };
            
            // Forward API key header if present
            const apiKeyHeader = request.headers.get('x-n8n-api-key');
            if (apiKeyHeader) {
                headers['X-N8N-API-KEY'] = apiKeyHeader;
            }
            
            // Forward authorization header if present
            const authHeader = request.headers.get('authorization');
            if (authHeader) {
                headers['Authorization'] = authHeader;
            }
            
            // Make the request to n8n
            const config = {
                method: request.method.toLowerCase(),
                url: n8nUrl,
                headers: headers,
                timeout: 30000 // 30 second timeout
            };
            
            // Add body for POST/PUT requests
            if (request.method === 'POST' || request.method === 'PUT') {
                const body = await request.text();
                if (body) {
                    try {
                        config.data = JSON.parse(body);
                    } catch {
                        config.data = body;
                    }
                }
            }
            
            const response = await axios(config);
            
            return {
                status: response.status,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-N8N-API-Key'
                },
                body: JSON.stringify(response.data)
            };
            
        } catch (error) {
            context.log.error('Error proxying to n8n:', error);
            
            // If it's an axios error with a response, forward the error
            if (error.response) {
                return {
                    status: error.response.status,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    },
                    body: JSON.stringify({
                        error: error.response.data || error.message,
                        status: error.response.status
                    })
                };
            }
            
            // Otherwise return a generic error
            return {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    error: 'Failed to proxy request to n8n',
                    message: error.message,
                    details: 'The n8n service may be unreachable or the workflow ID may be invalid'
                })
            };
        }
    }
});

module.exports = { app };
