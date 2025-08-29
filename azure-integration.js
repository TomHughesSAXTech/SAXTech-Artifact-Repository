// Azure Integration Module
class AzureIntegration {
    constructor() {
        this.subscriptionId = null;
        this.accessToken = null;
        this.resourceGroups = [];
        this.resources = {};
        this.costData = {};
        this.initialized = false;
    }

    async initialize() {
        try {
            // Get Azure access token from the logged-in user's session
            const authResponse = await fetch('/.auth/me');
            const authData = await authResponse.json();
            
            if (authData && authData.clientPrincipal) {
                // For Azure Static Web Apps, we need to get a proper Azure management token
                // This would typically be done through a backend API
                await this.getManagementToken();
            }
            
            this.initialized = true;
        } catch (error) {
            console.error('Failed to initialize Azure integration:', error);
        }
    }

    async getManagementToken() {
        try {
            // Call your backend API to get Azure management token
            // Use the deployed Function App URL
            const functionUrl = 'https://saxtech-metrics-api.azurewebsites.net/api/getazuretoken';
            const response = await fetch(functionUrl);
            if (response.ok) {
                const data = await response.json();
                this.accessToken = data.accessToken;
                this.subscriptionId = data.subscriptionId;
            }
        } catch (error) {
            console.error('Failed to get management token:', error);
        }
    }

    async fetchResourceGroups() {
        if (!this.accessToken || !this.subscriptionId) {
            console.warn('Azure not authenticated');
            return [];
        }

        try {
            const response = await fetch(
                `https://management.azure.com/subscriptions/${this.subscriptionId}/resourcegroups?api-version=2021-04-01`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.ok) {
                const data = await response.json();
                this.resourceGroups = data.value || [];
                return this.resourceGroups;
            }
        } catch (error) {
            console.error('Failed to fetch resource groups:', error);
        }
        
        return [];
    }

    async fetchResourcesInGroup(resourceGroupName) {
        if (!this.accessToken || !this.subscriptionId) {
            console.warn('Azure not authenticated');
            return [];
        }

        try {
            const response = await fetch(
                `https://management.azure.com/subscriptions/${this.subscriptionId}/resourceGroups/${resourceGroupName}/resources?api-version=2021-04-01`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.ok) {
                const data = await response.json();
                const resources = data.value || [];
                
                // Categorize resources
                const categorizedResources = resources.map(resource => {
                    const type = resource.type.toLowerCase();
                    let category = 'Other';
                    let url = '';
                    
                    if (type.includes('microsoft.web/sites')) {
                        category = 'Web App';
                        url = `https://${resource.name}.azurewebsites.net`;
                    } else if (type.includes('microsoft.web/sites/functions')) {
                        category = 'Function';
                        url = `https://${resource.name}.azurewebsites.net`;
                    } else if (type.includes('microsoft.storage/storageaccounts')) {
                        category = 'Storage';
                        url = `https://${resource.name}.blob.core.windows.net`;
                    } else if (type.includes('microsoft.documentdb/databaseaccounts')) {
                        category = 'CosmosDB';
                        url = `https://${resource.name}.documents.azure.com`;
                    } else if (type.includes('microsoft.keyvault/vaults')) {
                        category = 'KeyVault';
                        url = `https://${resource.name}.vault.azure.net`;
                    } else if (type.includes('microsoft.containerservice/managedclusters')) {
                        category = 'AKS';
                        url = '';
                    } else if (type.includes('microsoft.sql/servers')) {
                        category = 'SQL';
                        url = `${resource.name}.database.windows.net`;
                    }
                    
                    return {
                        name: resource.name,
                        type: category,
                        url: url,
                        id: resource.id,
                        location: resource.location,
                        resourceType: resource.type
                    };
                });
                
                this.resources[resourceGroupName] = categorizedResources;
                return categorizedResources;
            }
        } catch (error) {
            console.error('Failed to fetch resources:', error);
        }
        
        return [];
    }

    async fetchResourceCounts() {
        if (!this.accessToken || !this.subscriptionId) {
            return {
                webApps: 0,
                functionApps: 0,
                storageAccounts: 0,
                staticWebApps: 0
            };
        }

        try {
            // Fetch all resources in subscription
            const response = await fetch(
                `https://management.azure.com/subscriptions/${this.subscriptionId}/resources?api-version=2021-04-01`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (response.ok) {
                const data = await response.json();
                const resources = data.value || [];
                
                const counts = {
                    webApps: resources.filter(r => r.type === 'Microsoft.Web/sites' && !r.kind?.includes('functionapp')).length,
                    functionApps: resources.filter(r => r.type === 'Microsoft.Web/sites' && r.kind?.includes('functionapp')).length,
                    storageAccounts: resources.filter(r => r.type === 'Microsoft.Storage/storageAccounts').length,
                    staticWebApps: resources.filter(r => r.type === 'Microsoft.Web/staticSites').length
                };
                
                return counts;
            }
        } catch (error) {
            console.error('Failed to fetch resource counts:', error);
        }
        
        return {
            webApps: 0,
            functionApps: 0,
            storageAccounts: 0,
            staticWebApps: 0
        };
    }

    async fetchCostData(timeframe = 'MonthToDate') {
        if (!this.accessToken || !this.subscriptionId) {
            return { monthToDate: 0, total: 0, daily: 0, byResourceGroup: {} };
        }

        try {
            const endDate = new Date();
            const startDate = new Date();
            
            if (timeframe === 'MonthToDate') {
                startDate.setDate(1);
            } else if (timeframe === 'Yesterday') {
                startDate.setDate(startDate.getDate() - 1);
                endDate.setDate(endDate.getDate() - 1);
            }

            const response = await fetch(
                `https://management.azure.com/subscriptions/${this.subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2021-10-01`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        type: 'Usage',
                        timeframe: 'Custom',
                        timePeriod: {
                            from: startDate.toISOString().split('T')[0],
                            to: endDate.toISOString().split('T')[0]
                        },
                        dataset: {
                            granularity: 'Daily',
                            aggregation: {
                                totalCost: {
                                    name: 'Cost',
                                    function: 'Sum'
                                }
                            },
                            grouping: [
                                {
                                    type: 'Dimension',
                                    name: 'ResourceGroup'
                                }
                            ]
                        }
                    })
                }
            );

            if (response.ok) {
                const data = await response.json();
                const rows = data.properties?.rows || [];
                
                let total = 0;
                const byResourceGroup = {};
                
                rows.forEach(row => {
                    const cost = row[0]; // Cost value
                    const resourceGroup = row[2]; // Resource group name
                    
                    total += cost;
                    if (!byResourceGroup[resourceGroup]) {
                        byResourceGroup[resourceGroup] = 0;
                    }
                    byResourceGroup[resourceGroup] += cost;
                });
                
                this.costData = {
                    monthToDate: Math.round(total * 100) / 100,
                    total: Math.round(total * 100) / 100,
                    daily: timeframe === 'Yesterday' ? Math.round(total * 100) / 100 : 0,
                    byResourceGroup: byResourceGroup
                };
                
                return this.costData;
            }
        } catch (error) {
            console.error('Failed to fetch cost data:', error);
        }
        
        return { monthToDate: 0, total: 0, daily: 0, byResourceGroup: {} };
    }

    async fetchKubernetesMetrics() {
        // This would connect to Azure Monitor API for AKS metrics
        // For now, return placeholder until AKS monitoring is configured
        return {
            clusterCount: 0,
            totalNodes: 0,
            avgCpuUsage: 0,
            avgMemoryUsage: 0,
            clusters: []
        };
    }

    async fetchBackupStatus() {
        // This would connect to Azure Backup API
        // For now, return placeholder until backup is configured
        return {
            vaultCount: 0,
            protectedItemCount: 0,
            lastBackupTime: 'Not configured',
            healthStatus: 'Unknown'
        };
    }

    async fetchServiceHealth() {
        if (!this.accessToken || !this.subscriptionId) {
            return {
                activeIssues: 0,
                plannedMaintenance: 0,
                healthyVMs: 0,
                totalVMs: 0
            };
        }

        try {
            // Fetch Application Insights data if available
            // This would need Application Insights resource ID
            return {
                activeIssues: 0,
                plannedMaintenance: 0,
                healthyVMs: 0,
                totalVMs: 0
            };
        } catch (error) {
            console.error('Failed to fetch service health:', error);
        }
        
        return {
            activeIssues: 0,
            plannedMaintenance: 0,
            healthyVMs: 0,
            totalVMs: 0
        };
    }

    async fetchGPTUsage() {
        try {
            // Call your backend API to get OpenAI usage
            const functionUrl = 'https://saxtech-metrics-api.azurewebsites.net/api/GetGPTUsage';
            const response = await fetch(functionUrl);
            if (response.ok) {
                const data = await response.json();
                return data;
            }
        } catch (error) {
            console.error('Failed to fetch GPT usage:', error);
        }
        
        return {
            daily: [],
            byProject: {},
            totalTokens: 0,
            totalCost: 0
        };
    }
}

// Export for use in other files
window.AzureIntegration = AzureIntegration;

// Create and export instance for use
window.azureIntegration = new AzureIntegration();
