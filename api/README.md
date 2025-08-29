# Azure Functions for SAXTech Artifact Repository

This directory contains Azure Functions that provide backend APIs for the SAXTech Artifact Repository application.

## Functions

### 1. GetAzureToken
Retrieves an Azure management token using Managed Identity for authenticating Azure API calls.

**Endpoint:** `/api/GetAzureToken`
**Methods:** GET, POST

### 2. GetGPTUsage
Fetches OpenAI/GPT usage metrics and costs for the last 30 days.

**Endpoint:** `/api/GetGPTUsage`
**Methods:** GET, POST

### 3. GetAzureMetrics
Fetches various Azure resource metrics including resource counts, Kubernetes cluster info, VM health, and service health.

**Endpoint:** `/api/GetAzureMetrics?type={all|resources|kubernetes|vms|health}`
**Methods:** GET, POST

## Setup Instructions

### Prerequisites
- Node.js 16.x or later
- Azure Functions Core Tools v4
- Azure CLI
- An Azure subscription

### Local Development

1. **Install dependencies:**
   ```bash
   cd api
   npm install
   ```

2. **Configure local settings:**
   ```bash
   cp local.settings.json.template local.settings.json
   ```
   Edit `local.settings.json` and add your configuration:
   - `AZURE_SUBSCRIPTION_ID`: Your Azure subscription ID
   - `OPENAI_API_KEY`: Your OpenAI API key (optional)
   - `OPENAI_ORG_ID`: Your OpenAI organization ID (optional)

3. **Run locally:**
   ```bash
   func start
   ```
   The functions will be available at `http://localhost:7071/api/`

### Deployment to Azure

1. **Create a Function App in Azure:**
   ```bash
   az functionapp create \
     --resource-group rg-saxtech-prod \
     --consumption-plan-location eastus \
     --runtime node \
     --runtime-version 18 \
     --functions-version 4 \
     --name saxtech-functions \
     --storage-account saxtechstorage
   ```

2. **Enable Managed Identity:**
   ```bash
   az functionapp identity assign \
     --resource-group rg-saxtech-prod \
     --name saxtech-functions
   ```

3. **Grant permissions to Managed Identity:**
   ```bash
   # Get the principal ID
   PRINCIPAL_ID=$(az functionapp identity show \
     --resource-group rg-saxtech-prod \
     --name saxtech-functions \
     --query principalId -o tsv)
   
   # Grant Reader role on subscription
   az role assignment create \
     --assignee $PRINCIPAL_ID \
     --role "Reader" \
     --scope /subscriptions/<subscription-id>
   
   # Grant Cost Management Reader role
   az role assignment create \
     --assignee $PRINCIPAL_ID \
     --role "Cost Management Reader" \
     --scope /subscriptions/<subscription-id>
   ```

4. **Configure application settings:**
   ```bash
   az functionapp config appsettings set \
     --resource-group rg-saxtech-prod \
     --name saxtech-functions \
     --settings \
       AZURE_SUBSCRIPTION_ID="<subscription-id>" \
       OPENAI_API_KEY="<openai-key>" \
       OPENAI_ORG_ID="<openai-org-id>"
   ```

5. **Deploy the functions:**
   ```bash
   func azure functionapp publish saxtech-functions
   ```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID | Yes |
| `OPENAI_API_KEY` | OpenAI API key for usage tracking | No |
| `OPENAI_ORG_ID` | OpenAI organization ID | No |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Application Insights connection string | No |

## Authentication

The functions use Azure Managed Identity for authentication when deployed to Azure. This eliminates the need for storing credentials and provides secure access to Azure resources.

For local development, the Azure Identity library will use your Azure CLI credentials or environment variables.

## CORS Configuration

When deployed with Azure Static Web Apps, CORS is automatically configured. For standalone deployment, update the CORS settings in the Function App:

```bash
az functionapp cors add \
  --resource-group rg-saxtech-prod \
  --name saxtech-functions \
  --allowed-origins https://yourdomain.com
```

## Monitoring

Application Insights is configured for monitoring. View logs and metrics in the Azure Portal under your Function App's Application Insights resource.

## Troubleshooting

1. **Authentication errors:** Ensure Managed Identity is enabled and has proper permissions
2. **CORS errors:** Check CORS configuration in Function App settings
3. **Missing data:** Verify environment variables are set correctly
4. **Timeout errors:** Some operations may take time; the timeout is set to 10 minutes

## Support

For issues or questions, contact the SAXTech development team.
