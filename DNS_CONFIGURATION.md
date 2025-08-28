# DNS Configuration for repository.saxtechnology.com

## Required DNS Record

To complete the custom domain setup for repository.saxtechnology.com, please add the following CNAME record to your DNS provider:

### CNAME Record Details:
- **Type:** CNAME
- **Name/Host:** repository
- **Value/Points to:** kind-ocean-0373f2a0f.1.azurestaticapps.net
- **TTL:** 3600 (or your preferred value)

## DNS Provider Instructions

### If using GoDaddy:
1. Log in to your GoDaddy account
2. Navigate to your domain (saxtechnology.com)
3. Click on "DNS" or "Manage DNS"
4. Add a new CNAME record with the values above
5. Save the changes

### If using Cloudflare:
1. Log in to Cloudflare
2. Select your domain (saxtechnology.com)
3. Go to DNS settings
4. Add a CNAME record with the values above
5. Set Proxy status to "DNS only" (grey cloud)
6. Save

### If using Azure DNS:
Already checked - no Azure DNS zone exists for this domain.

## Verification

After adding the CNAME record, it may take up to 48 hours for DNS propagation, though it typically completes within 15-30 minutes.

To verify the DNS record is properly configured:
```bash
nslookup repository.saxtechnology.com
# or
dig CNAME repository.saxtechnology.com
```

## Complete Custom Domain Setup in Azure

Once the DNS record is configured and propagated, run:
```bash
az rest --method put --uri "/subscriptions/3cfb259a-f02a-484e-9ce3-d83c21fd0ddb/resourceGroups/SAXTech-AI/providers/Microsoft.Web/staticSites/SAXTech-Artifacts/customDomains/repository.saxtechnology.com?api-version=2022-09-01" --body '{"properties":{"domainName":"repository.saxtechnology.com","validationMethod":"cname-delegation"}}'
```

## Current Status
- ✅ Azure Static Web App deployed
- ✅ Azure AD authentication configured
- ⏳ Waiting for DNS CNAME record to be added
- ⏳ Custom domain verification pending

## Access URLs
- **Primary URL:** https://kind-ocean-0373f2a0f.1.azurestaticapps.net
- **Custom Domain (pending DNS):** https://repository.saxtechnology.com
