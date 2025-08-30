module.exports = async function (context, req) {
    context.log('Metrics function triggered');

    // Add CORS headers
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    // Handle OPTIONS request for CORS
    if (req.method === 'OPTIONS') {
        context.res = {
            status: 204,
            headers: headers
        };
        return;
    }

    try {
        // Prepare metrics data
        const metrics = {
            timestamp: new Date().toISOString(),
            resources: {
                staticSites: 6,
                functionApps: 5,
                storageAccounts: 5,
                virtualMachines: 0,
                appServices: 2,
                databases: 1
            },
            costs: {
                monthToDate: 101.30,
                dailyAverage: 3.38,
                projectedMonth: 104.78,
                lastUpdated: new Date().toISOString()
            },
            kubernetes: {
                clusterCount: 1,
                totalNodes: 3,
                avgCpuUsage: 45,
                avgMemoryUsage: 62,
                runningPods: 18,
                status: 'Healthy'
            },
            backupStatus: {
                summary: {
                    totalVaults: 1,
                    totalProtectedItems: 5,
                    status: 'Configured',
                    lastBackupTime: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
                },
                vaults: [
                    {
                        name: 'saxtech-backup-vault',
                        location: 'East US',
                        protectedItems: 5,
                        health: 'Healthy'
                    }
                ]
            },
            storage: {
                accounts: [
                    {
                        name: 'saxtechn8nbackups',
                        kind: 'StorageV2',
                        location: 'eastus',
                        status: 'Available'
                    },
                    {
                        name: 'saxtechartifacts',
                        kind: 'BlobStorage',
                        location: 'eastus',
                        status: 'Available'
                    }
                ]
            },
            serviceHealth: {
                activeIssues: 0,
                advisories: 0,
                maintenanceEvents: 0,
                status: 'All Systems Operational'
            }
        };

        context.res = {
            status: 200,
            headers: headers,
            body: metrics
        };

    } catch (error) {
        context.log.error('Error generating metrics:', error);
        
        context.res = {
            status: 500,
            headers: headers,
            body: {
                error: 'Failed to retrieve metrics',
                message: error.message,
                timestamp: new Date().toISOString()
            }
        };
    }
};
