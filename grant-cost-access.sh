#!/bin/bash

# Grant Cost Management Reader role to all SAXTechnology.com users
# This script grants access to view cost data in the Real-Time Dashboard

SUBSCRIPTION_ID="3cfb259a-f02a-484e-9ce3-d83c21fd0ddb"
ROLE="Cost Management Reader"

echo "==================================="
echo "SAXTechnology Cost Management Access Grant"
echo "==================================="
echo ""
echo "This script will grant '$ROLE' role to all @saxtechnology.com users"
echo "Subscription: $SUBSCRIPTION_ID"
echo ""

# Array of users
declare -a USERS=(
    "Acarcione@saxtechnology.com"
    "alerts@saxtechnology.com"
    "ap@saxtechnology.com"
    "DRodriguez@saxtechnology.com"
    "help@saxtechnology.com"
    "info@saxtechnology.com"
    "LGrassi@saxtechnology.com"
    "noreply@saxtechnology.com"
    "RAlexander@saxtechnology.com"
    "RLange@saxtechnology.com"
    "ROwen@saxtechnology.com"
    "support@saxtechnology.com"
    "thughes@saxtechnology.com"
    "vboddie@saxtechnology.com"
)

SUCCESS_COUNT=0
FAIL_COUNT=0

echo "Starting role assignments..."
echo "-----------------------------------"

for USER in "${USERS[@]}"
do
    echo -n "Granting access to $USER... "
    
    # Check if this looks like a service account
    if [[ "$USER" == "alerts@"* ]] || [[ "$USER" == "help@"* ]] || [[ "$USER" == "info@"* ]] || [[ "$USER" == "noreply@"* ]] || [[ "$USER" == "support@"* ]] || [[ "$USER" == "ap@"* ]]; then
        echo "Skipping (service account)"
        continue
    fi
    
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
echo "Users with Cost Management Reader access can now:"
echo "• View real-time cost data in the dashboard"
echo "• Access cost breakdowns by service"
echo "• See month-to-date spending"
echo "• View weekly cost trends"
echo ""
echo "Dashboard URL: https://repository.saxtechnology.com/realtime-dashboard.html"
