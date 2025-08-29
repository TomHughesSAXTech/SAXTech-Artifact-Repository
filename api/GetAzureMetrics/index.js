const { DefaultAzureCredential } = require('@azure/identity');
const { ResourceManagementClient } = require('@azure/arm-resources');
const { MonitorClient } = require('@azure/arm-monitor');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { ContainerServiceClient } = require('@azure/arm-containerservice');

module.exports = async function (context, req) {
    context.log('GetAzureMetrics function triggered');
    
    // Add CORS headers
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-ms-client-principal'
    };

    // Handle OPTIONS request for CORS
    if (req.method === 'OPTIONS') {
        context.res = {
            status: 200,
            headers: headers
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
        
        const subscriptionId = req.body?.subscriptionId || 
                             process.env.AZURE_SUBSCRIPTION_ID || 
                             "3cfb259a-f02a-484e-9ce3-d83c21fd0ddb";
        const metricType = req.query.type || req.body?.type || 'all';
        
        if (!subscriptionId) {
            context.res = {
                status: 400,
                body: {
                    error: "Subscription ID is required"
                },
                headers: headers
            };
            return;
        }

        const credential = new DefaultAzureCredential();
        const resourceClient = new ResourceManagementClient(credential, subscriptionId);
        const monitorClient = new MonitorClient(credential, subscriptionId);
        const computeClient = new ComputeManagementClient(credential, subscriptionId);
        const containerClient = new ContainerServiceClient(credential, subscriptionId);

        let metrics = {};

        // Fetch resource counts
        if (metricType === 'all' || metricType === 'resources') {
            const resources = [];
            for await (const resource of resourceClient.resources.list()) {
                resources.push(resource);
            }

            metrics.resourceCounts = {
                staticWebApps: resources.filter(r => r.type === 'Microsoft.Web/staticSites').length,
                functionApps: resources.filter(r => r.type === 'Microsoft.Web/sites' && r.kind?.includes('functionapp')).length,
                storageAccounts: resources.filter(r => r.type === 'Microsoft.Storage/storageAccounts').length,
                webApps: resources.filter(r => r.type === 'Microsoft.Web/sites' && !r.kind?.includes('functionapp')).length,
                total: resources.length
            };
        }

        // Fetch Kubernetes metrics
        if (metricType === 'all' || metricType === 'kubernetes') {
            const clusters = [];
            let totalNodes = 0;
            let totalCpu = 0;
            let totalMemory = 0;
            
            try {
                for await (const cluster of containerClient.managedClusters.list()) {
                    clusters.push({
                        name: cluster.name,
                        location: cluster.location,
                        nodeCount: cluster.agentPoolProfiles?.[0]?.count || 0,
                        kubernetesVersion: cluster.kubernetesVersion,
                        provisioningState: cluster.provisioningState
                    });
                    
                    totalNodes += cluster.agentPoolProfiles?.[0]?.count || 0;
                }

                // Get CPU and Memory metrics if clusters exist
                if (clusters.length > 0) {
                    // This would require additional Azure Monitor queries
                    // For now, returning placeholder values
                    totalCpu = clusters.length > 0 ? 45 : 0; // Average CPU %
                    totalMemory = clusters.length > 0 ? 62 : 0; // Average Memory %
                }
            } catch (error) {
                context.log.warn('No Kubernetes clusters found or access denied');
            }

            metrics.kubernetes = {
                clusterCount: clusters.length,
                clusters: clusters,
                totalNodes: totalNodes,
                avgCpuUsage: totalCpu,
                avgMemoryUsage: totalMemory
            };
        }

        // Fetch VM health metrics
        if (metricType === 'all' || metricType === 'vms') {
            const vms = [];
            let healthyVMs = 0;
            
            try {
                for await (const vm of computeClient.virtualMachines.listAll()) {
                    vms.push(vm);
                    if (vm.provisioningState === 'Succeeded') {
                        healthyVMs++;
                    }
                }
            } catch (error) {
                context.log.warn('No VMs found or access denied');
            }

            metrics.virtualMachines = {
                totalVMs: vms.length,
                healthyVMs: healthyVMs,
                unhealthyVMs: vms.length - healthyVMs
            };
        }

        // Fetch service health
        if (metricType === 'all' || metricType === 'health') {
            // This would require Azure Service Health API
            // For now, returning placeholder values
            metrics.serviceHealth = {
                activeIssues: 0,
                plannedMaintenance: 0,
                healthAdvisories: 0,
                securityAdvisories: 0
            };
        }

        // Add authentication status to metrics
        metrics.authenticated = !!userInfo;
        metrics.user = userInfo?.userDetails || 'anonymous';
        metrics.subscriptionId = subscriptionId;
        metrics.timestamp = new Date().toISOString();
        
        context.res = {
            status: 200,
            headers: headers,
            body: metrics
        };
    } catch (error) {
        context.log.error('Error fetching Azure metrics:', error);
        
        context.res = {
            status: 500,
            body: {
                error: "Failed to fetch Azure metrics",
                details: error.message
            },
            headers: headers
        };
    }
};
