#!/bin/bash

# Grant Reader role to all SAXTechnology.com users
# This ensures they can view all Azure resources in the dashboard

SUBSCRIPTION_ID="3cfb259a-f02a-484e-9ce3-d83c21fd0ddb"
ROLE="Reader"

echo "==================================="
echo "SAXTechnology Reader Access Grant"
echo "==================================="
echo ""
echo "This script will grant '$ROLE' role to all @saxtechnology.com users"
echo "Subscription: $SUBSCRIPTION_ID"
echo ""

# Array of human users (excluding service accounts)
declare -a USERS=(
    "Acarcione@saxtechnology.com"
    "DRodriguez@saxtechnology.com"
    "LGrassi@saxtechnology.com"
    "RAlexander@saxtechnology.com"
    "RLange@saxtechnology.com"
    "ROwen@saxtechnology.com"
    "thughes@saxtechnology.com"
    "vboddie@saxtechnology.com"
)

SUCCESS_COUNT=0
FAIL_COUNT=0

echo "Starting role assignments..."
echo "-----------------------------------"

for USER in "${USERS[@]}"
do
    echo -n "Granting Reader access to $USER... "
    
    # Grant the role
    if az role assignment create \
        --assignee "$USER" \
        --role "$ROLE" \
        --scope "/subscriptions/$SUBSCRIPTION_ID" \
        --output none 2>/dev/null; then
        echo "✅ Success"
        ((SUCCESS_COUNT++))
    else
        # Check if assignment already exists
        if az role assignment list \
            --assignee "$USER" \
            --role "$ROLE" \
            --scope "/subscriptions/$SUBSCRIPTION_ID" \
            --query "[0].id" -o tsv 2>/dev/null | grep -q .; then
            echo "✓ Already assigned"
            ((SUCCESS_COUNT++))
        else
            echo "❌ Failed"
            ((FAIL_COUNT++))
        fi
    fi
done

echo ""
echo "==================================="
echo "Role Assignment Complete!"
echo "==================================="
echo "✅ Successful assignments: $SUCCESS_COUNT"
echo "❌ Failed assignments: $FAIL_COUNT"
echo ""
echo "Users now have full read access to:"
echo "• View all Azure resources"
echo "• See resource groups and their contents"
echo "• Access Virtual Machines information"
echo "• View Storage Accounts"
echo "• See Web Apps and Function Apps"
echo "• Access real-time cost data (via Cost Management Reader)"
echo ""
echo "Dashboard URL: https://repository.saxtechnology.com/realtime-dashboard.html"
