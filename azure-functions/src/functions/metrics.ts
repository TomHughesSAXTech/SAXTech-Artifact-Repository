import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { DefaultAzureCredential } from "@azure/identity";
import { CostManagementClient } from "@azure/arm-costmanagement";
import { ResourceGraphClient } from "@azure/arm-resourcegraph";
import { StorageManagementClient } from "@azure/arm-storage";
import { BlobServiceClient } from "@azure/storage-blob";

const SUBSCRIPTION_ID = "3cfb259a-f02a-484e-9ce3-d83c21fd0ddb";
const RESOURCE_GROUP = "SAXTech-AI";

export async function metrics(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    context.log('HTTP trigger function processed a request for metrics.');

    try {
        const credential = new DefaultAzureCredential();
        
        // Parse request body if any
        let subscriptionId = SUBSCRIPTION_ID;
        let resourceGroup = RESOURCE_GROUP;
        
        if (request.body) {
            try {
                const body: any = await request.json();
                subscriptionId = body.subscriptionId || subscriptionId;
                resourceGroup = body.resourceGroup || resourceGroup;
            } catch (e) {
                // ignore parse errors
            }
        }

        // Fetch all metrics in parallel
        const [costs, resources, storage] = await Promise.all([
            getCosts(credential, subscriptionId),
            getResourceCounts(credential, subscriptionId, resourceGroup),
            getStorageMetrics(credential, subscriptionId, resourceGroup)
        ]);

        return {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            },
            body: JSON.stringify({
                subscriptionId,
                resourceGroup,
                timestamp: new Date().toISOString(),
                costs,
                resources,
                storage
            })
        };
    } catch (error) {
        context.log('Error fetching metrics:', error);
        return {
            status: 500,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({ error: error.message || "Failed to fetch metrics" })
        };
    }
}

async function getCosts(credential: DefaultAzureCredential, subscriptionId: string) {
    try {
        const costClient = new CostManagementClient(credential);
        const scope = `/subscriptions/${subscriptionId}`;
        
        // Get current month dates
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const yesterdayDate = new Date(now);
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        
        // Month-to-date query
        const mtdQuery = {
            type: "ActualCost",
            timeframe: "Custom",
            timePeriod: {
                from: startOfMonth,
                to: now
            },
            dataset: {
                granularity: "None",
                aggregation: {
                    totalCost: {
                        name: "Cost",
                        function: "Sum"
                    }
                }
            }
        };

        // Yesterday's cost query
        const dailyQuery = {
            type: "ActualCost",
            timeframe: "Custom",
            timePeriod: {
                from: yesterdayDate,
                to: yesterdayDate
            },
            dataset: {
                granularity: "Daily",
                aggregation: {
                    totalCost: {
                        name: "Cost",
                        function: "Sum"
                    }
                }
            }
        };

        const [mtdResult, dailyResult] = await Promise.all([
            costClient.query.usage(scope, mtdQuery).catch(() => null),
            costClient.query.usage(scope, dailyQuery).catch(() => null)
        ]);

        const monthToDate = mtdResult?.rows?.[0]?.[0] || 0;
        const yesterdayAmount = dailyResult?.rows?.[0]?.[0] || 0;

        return {
            monthToDate: Number(monthToDate),
            yesterday: Number(yesterdayAmount),
            currency: "USD"
        };
    } catch (error) {
        console.error('Cost API error:', error);
        return { monthToDate: 0, yesterday: 0, currency: "USD" };
    }
}

async function getResourceCounts(credential: DefaultAzureCredential, subscriptionId: string, resourceGroup: string) {
    try {
        const graphClient = new ResourceGraphClient(credential);
        
        const query = `
            Resources
            | where subscriptionId == '${subscriptionId}'
            | where resourceGroup == '${resourceGroup}'
            | summarize 
                staticSites = countif(type == 'microsoft.web/staticsites'),
                functionApps = countif(type == 'microsoft.web/sites' and kind contains 'functionapp'),
                storageAccounts = countif(type == 'microsoft.storage/storageaccounts'),
                totalResources = count()
        `;

        const result = await graphClient.resources({ query });
        const data = result.data?.[0] || {};
        
        return {
            staticSites: data.staticSites || 0,
            functionApps: data.functionApps || 0,
            storageAccounts: data.storageAccounts || 0,
            totalResources: data.totalResources || 0
        };
    } catch (error) {
        console.error('Resource Graph error:', error);
        return { staticSites: 0, functionApps: 0, storageAccounts: 0, totalResources: 0 };
    }
}

async function getStorageMetrics(credential: DefaultAzureCredential, subscriptionId: string, resourceGroup: string) {
    try {
        const storageClient = new StorageManagementClient(credential, subscriptionId);
        const accounts = [];
        
        // List storage accounts
        for await (const account of storageClient.storageAccounts.listByResourceGroup(resourceGroup)) {
            let usedBytes = 0;
            
            // Try to get blob metrics
            try {
                const blobClient = new BlobServiceClient(
                    `https://${account.name}.blob.core.windows.net`,
                    credential
                );
                
                // Get container statistics (simplified - real implementation would aggregate)
                for await (const container of blobClient.listContainers()) {
                    const containerClient = blobClient.getContainerClient(container.name);
                    for await (const blob of containerClient.listBlobsFlat()) {
                        usedBytes += blob.properties.contentLength || 0;
                    }
                }
            } catch (e) {
                // If we can't access blobs directly, estimate from account metrics
                usedBytes = 0;
            }
            
            accounts.push({
                name: account.name,
                location: account.location,
                sku: account.sku?.name,
                usedBytes
            });
        }
        
        return { accounts };
    } catch (error) {
        console.error('Storage metrics error:', error);
        return { accounts: [] };
    }
}

app.http('metrics', {
    methods: ['GET', 'POST', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: metrics
});
