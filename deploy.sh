#!/bin/bash

# SAXTech Metrics Dashboard and API Deployment Script
# This script deploys the Azure Function API and updates the dashboard

echo "========================================="
echo "SAXTech Metrics Deployment"
echo "========================================="

# Set variables
RESOURCE_GROUP="SAXTech-AI"
FUNCTION_APP_NAME="saxtech-metrics-api"
STORAGE_ACCOUNT="saxtechartifactstorage"
DASHBOARD_CONTAINER="\$web"

# Check if logged in to Azure
echo ""
echo "Checking Azure login..."
az account show > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "Not logged in to Azure. Please run 'az login' first."
    exit 1
fi

echo "Logged in to Azure ✓"

# Deploy Azure Function
echo ""
echo "========================================="
echo "Deploying Azure Function..."
echo "========================================="

cd azure-functions

# Build the function
echo "Building TypeScript..."
npm run build

# Deploy using Azure Functions Core Tools
echo "Deploying to Azure Function App: $FUNCTION_APP_NAME"
func azure functionapp publish $FUNCTION_APP_NAME --typescript

if [ $? -eq 0 ]; then
    echo "Azure Function deployed successfully ✓"
else
    echo "Azure Function deployment failed ✗"
    exit 1
fi

cd ..

# Deploy Dashboard
echo ""
echo "========================================="
echo "Deploying Dashboard to Azure Storage..."
echo "========================================="

# Upload dashboard files
echo "Uploading dashboard.html..."
az storage blob upload \
    --account-name $STORAGE_ACCOUNT \
    --container-name $DASHBOARD_CONTAINER \
    --name "dashboard.html" \
    --file "dashboard.html" \
    --content-type "text/html" \
    --overwrite

echo "Uploading chart.min.js..."
az storage blob upload \
    --account-name $STORAGE_ACCOUNT \
    --container-name $DASHBOARD_CONTAINER \
    --name "chart.min.js" \
    --file "chart.min.js" \
    --content-type "application/javascript" \
    --overwrite

echo "Uploading chartjs-plugin-datalabels.min.js..."
az storage blob upload \
    --account-name $STORAGE_ACCOUNT \
    --container-name $DASHBOARD_CONTAINER \
    --name "chartjs-plugin-datalabels.min.js" \
    --file "chartjs-plugin-datalabels.min.js" \
    --content-type "application/javascript" \
    --overwrite

echo "Uploading index.html..."
az storage blob upload \
    --account-name $STORAGE_ACCOUNT \
    --container-name $DASHBOARD_CONTAINER \
    --name "index.html" \
    --file "index.html" \
    --content-type "text/html" \
    --overwrite

echo ""
echo "========================================="
echo "Deployment Complete!"
echo "========================================="
echo ""
echo "Dashboard URL: https://$STORAGE_ACCOUNT.z20.web.core.windows.net/"
echo "API Endpoint: https://$FUNCTION_APP_NAME.azurewebsites.net/api/metrics"
echo ""
echo "You can test the API with:"
echo "curl -X POST https://$FUNCTION_APP_NAME.azurewebsites.net/api/metrics -H 'Content-Type: application/json' -d '{}'"
echo ""
