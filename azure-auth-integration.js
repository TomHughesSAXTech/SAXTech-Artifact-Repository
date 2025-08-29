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
                
                if (authData && authData.length > 0 && authData[0]) {
                    this.userInfo = authData[0];
                    
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
        // Use mock data for now since Functions need fixing
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
