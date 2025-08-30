// Metrics Cache Module - Reduces API calls and improves performance
class MetricsCache {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 60000; // 1 minute cache
        this.pendingRequests = new Map(); // Prevent duplicate simultaneous requests
    }

    // Get cached data or fetch new
    async getMetrics(endpoint, options = {}) {
        const cacheKey = endpoint;
        const now = Date.now();
        
        // Check if we have valid cached data
        const cached = this.cache.get(cacheKey);
        if (cached && (now - cached.timestamp) < this.cacheTimeout) {
            console.log(`Cache hit for ${endpoint}`);
            return cached.data;
        }
        
        // Check if there's already a pending request for this endpoint
        if (this.pendingRequests.has(cacheKey)) {
            console.log(`Waiting for pending request: ${endpoint}`);
            return this.pendingRequests.get(cacheKey);
        }
        
        // Create new request promise
        const requestPromise = this.fetchMetrics(endpoint, options)
            .then(data => {
                // Cache the successful response
                this.cache.set(cacheKey, {
                    data: data,
                    timestamp: now
                });
                this.pendingRequests.delete(cacheKey);
                return data;
            })
            .catch(error => {
                this.pendingRequests.delete(cacheKey);
                throw error;
            });
        
        // Store the pending request
        this.pendingRequests.set(cacheKey, requestPromise);
        
        return requestPromise;
    }
    
    // Actual fetch implementation
    async fetchMetrics(endpoint, options = {}) {
        const baseUrl = 'https://saxtech-metrics-api.azurewebsites.net/api';
        const url = `${baseUrl}/${endpoint}`;
        
        console.log(`Fetching fresh data from: ${url}`);
        
        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            mode: 'cors',
            ...options
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        return response.json();
    }
    
    // Clear cache
    clearCache() {
        this.cache.clear();
        console.log('Metrics cache cleared');
    }
    
    // Update cache timeout
    setCacheTimeout(ms) {
        this.cacheTimeout = ms;
    }
    
    // Preload metrics to warm up cache
    async preloadMetrics() {
        console.log('Preloading metrics...');
        const endpoints = ['metrics', 'resourceGroups', 'backupStatus'];
        
        const promises = endpoints.map(endpoint => 
            this.getMetrics(endpoint).catch(err => {
                console.warn(`Failed to preload ${endpoint}:`, err);
                return null;
            })
        );
        
        await Promise.all(promises);
        console.log('Metrics preloaded');
    }
}

// Create singleton instance
const metricsCache = new MetricsCache();

// Auto-preload on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Start preloading after a short delay to not block initial render
        setTimeout(() => metricsCache.preloadMetrics(), 100);
    });
} else {
    // DOM already loaded
    setTimeout(() => metricsCache.preloadMetrics(), 100);
}

// Export for use
window.metricsCache = metricsCache;
