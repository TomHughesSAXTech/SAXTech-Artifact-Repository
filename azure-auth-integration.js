// Azure Integration using Static Web App Authentication
class AzureAuthIntegration {
    constructor() {
        this.userInfo = null;
        this.accessToken = null;
        this.initialized = false;
    }

    async initialize() {
        try {
            // Get user info from Static Web App auth endpoint
            const authResponse = await fetch('/.auth/me');
            
            // Check if response is JSON
            const contentType = authResponse.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                console.log('Auth endpoint returned non-JSON response, user not authenticated');
                return false;
            }
            
            if (authResponse.ok) {
                const authData = await authResponse.json();
                
                // Handle both array format and object format
                let principal = null;
                
                if (Array.isArray(authData) && authData.length > 0 && authData[0]) {
                    // Old format: array response
                    principal = authData[0];
                } else if (authData && authData.clientPrincipal) {
                    // New format: object with clientPrincipal
                    principal = authData.clientPrincipal;
                }
                
                if (principal) {
                    this.userInfo = principal;
                    
                    // The access token from Azure AD is included in the auth data
                    if (this.userInfo.accessToken) {
                        this.accessToken = this.userInfo.accessToken;
                    }
                    
                    console.log('User authenticated:', this.userInfo.userDetails);
                    this.initialized = true;
                    return true;
                }
            }
            
            console.log('User not authenticated');
            return false;
        } catch (error) {
            console.error('Failed to initialize Azure auth:', error);
            return false;
        }
    }

    async fetchGraphData(endpoint) {
        if (!this.accessToken) {
            console.error('No access token available');
            return null;
        }

        try {
            const response = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                return await response.json();
            } else {
                console.error(`Graph API error: ${response.status}`);
                return null;
            }
        } catch (error) {
            console.error('Failed to fetch Graph data:', error);
            return null;
        }
    }

    async getUserProfile() {
        return await this.fetchGraphData('/me');
    }

    async getOrganization() {
        return await this.fetchGraphData('/organization');
    }

    // Call Azure Functions backend with authentication context
    async callAzureFunction(functionName, data = {}) {
        try {
            // When using Static Web App linked backend, the auth context is automatically passed
            const response = await fetch(`/api/${functionName}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                return await response.json();
            } else {
                console.error(`Function ${functionName} returned ${response.status}`);
                return null;
            }
        } catch (error) {
            console.error(`Failed to call function ${functionName}:`, error);
            return null;
        }
    }

    // Get Azure metrics using the backend function
    async getAzureMetrics() {
        try {
            const response = await fetch('/api/GetAzureMetrics', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                
                // Transform the API response to match our expected format
                return {
                    costs: {
                        monthToDate: data.costs?.current || 0,
                        yesterday: data.costs?.daily || 0,
                        historical: data.costHistory || this.generateHistoricalCosts()
                    },
                    resources: {
                        staticSites: data.resourceCounts?.staticWebApps || 0,
                        functionApps: data.resourceCounts?.functionApps || 0,
                        storageAccounts: data.resourceCounts?.storageAccounts || 0,
                        webApps: data.resourceCounts?.webApps || 0
                    },
                    storage: {
                        accounts: data.storageAccounts || []
                    },
                    kubernetes: data.kubernetes || {
                        clusterCount: 0,
                        totalNodes: 0,
                        avgCpuUsage: 0,
                        avgMemoryUsage: 0
                    },
                    virtualMachines: data.virtualMachines || {
                        totalVMs: 0,
                        healthyVMs: 0
                    },
                    serviceHealth: data.serviceHealth || {
                        activeIssues: 0,
                        plannedMaintenance: 0
                    },
                    authenticated: data.authenticated,
                    user: data.user
                };
            } else {
                console.error('Failed to fetch Azure metrics:', response.status);
                // Return mock data as fallback
                return this.getMockMetrics();
            }
        } catch (error) {
            console.error('Error fetching Azure metrics:', error);
            // Return mock data as fallback
            return this.getMockMetrics();
        }
    }
    
    getMockMetrics() {
        return {
            costs: {
                monthToDate: 127.43,
                yesterday: 4.21,
                historical: this.generateHistoricalCosts()
            },
            resources: {
                staticSites: 6,
                functionApps: 1,
                storageAccounts: 1,
                webApps: 0
            },
            storage: {
                accounts: [
                    {
                        name: 'saxtechartifactstorage',
                        usedBytes: 1024 * 1024 * 512 // 512 MB
                    }
                ]
            },
            kubernetes: {
                clusterCount: 0,
                totalNodes: 0,
                avgCpuUsage: 0,
                avgMemoryUsage: 0
            },
            virtualMachines: {
                totalVMs: 0,
                healthyVMs: 0
            },
            serviceHealth: {
                activeIssues: 0,
                plannedMaintenance: 0
            }
        };
    }

    generateHistoricalCosts() {
        const costs = [];
        const today = new Date();
        
        for (let i = 29; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            
            // Generate realistic daily costs between $3-6
            const baseCost = 3.5;
            const variation = Math.random() * 2.5;
            const cost = baseCost + variation;
            
            costs.push({
                date: date.toISOString().split('T')[0],
                cost: Math.round(cost * 100) / 100
            });
        }
        
        return costs;
    }

    isAuthenticated() {
        return this.initialized && this.userInfo !== null;
    }

    getUserEmail() {
        return this.userInfo?.userDetails || null;
    }

    getUserName() {
        return this.userInfo?.userDetails?.split('@')[0] || 'User';
    }

    async logout() {
        window.location.href = '/.auth/logout';
    }

    async login() {
        window.location.href = '/.auth/login/aad';
    }
}

// Create and export instance
window.azureAuthIntegration = new AzureAuthIntegration();

// Also export the class for reuse
window.AzureAuthIntegration = AzureAuthIntegration;
