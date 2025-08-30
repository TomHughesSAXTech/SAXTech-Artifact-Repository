// Metrics Cache Module - Reduces API calls and improves performance
class MetricsCache {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 300000; // 5 minute cache for better performance
        this.pendingRequests = new Map(); // Prevent duplicate simultaneous requests
        this.loadFromLocalStorage(); // Load any cached data from previous session
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
        
        // Check localStorage as fallback (even if expired, better than nothing while loading)
        const localCached = this.getFromLocalStorage(cacheKey);
        if (localCached && (now - localCached.timestamp) < this.cacheTimeout * 2) { // Accept 2x older data from localStorage
            console.log(`LocalStorage cache hit for ${endpoint}`);
            this.cache.set(cacheKey, localCached);
            // Still fetch fresh data in background
            this.fetchInBackground(endpoint, options);
            return localCached.data;
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
                const cacheEntry = {
                    data: data,
                    timestamp: now
                };
                this.cache.set(cacheKey, cacheEntry);
                this.saveToLocalStorage(cacheKey, cacheEntry);
                this.pendingRequests.delete(cacheKey);
                return data;
            })
            .catch(error => {
                this.pendingRequests.delete(cacheKey);
                // If fetch fails, try to return stale data from localStorage
                const staleCached = this.getFromLocalStorage(cacheKey);
                if (staleCached) {
                    console.warn(`Using stale cache for ${endpoint} due to error:`, error);
                    return staleCached.data;
                }
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
        // Only include endpoints that actually exist
        const endpoints = ['metrics', 'resourceGroups'];
        
        const promises = endpoints.map(endpoint => 
            this.getMetrics(endpoint).catch(err => {
                console.warn(`Failed to preload ${endpoint}:`, err);
                return null;
            })
        );
        
        await Promise.all(promises);
        console.log('Metrics preloaded');
    }
    
    // Fetch in background without blocking
    fetchInBackground(endpoint, options = {}) {
        this.fetchMetrics(endpoint, options)
            .then(data => {
                const cacheEntry = {
                    data: data,
                    timestamp: Date.now()
                };
                this.cache.set(endpoint, cacheEntry);
                this.saveToLocalStorage(endpoint, cacheEntry);
                console.log(`Background refresh completed for ${endpoint}`);
            })
            .catch(err => console.warn(`Background refresh failed for ${endpoint}:`, err));
    }
    
    // LocalStorage helpers
    saveToLocalStorage(key, value) {
        try {
            localStorage.setItem(`metricsCache_${key}`, JSON.stringify(value));
        } catch (e) {
            console.warn('Failed to save to localStorage:', e);
        }
    }
    
    getFromLocalStorage(key) {
        try {
            const item = localStorage.getItem(`metricsCache_${key}`);
            return item ? JSON.parse(item) : null;
        } catch (e) {
            console.warn('Failed to read from localStorage:', e);
            return null;
        }
    }
    
    loadFromLocalStorage() {
        try {
            // Load any cached metrics from localStorage
            const keys = Object.keys(localStorage)
                .filter(k => k.startsWith('metricsCache_'));
            
            keys.forEach(key => {
                const cacheKey = key.replace('metricsCache_', '');
                const cached = this.getFromLocalStorage(cacheKey);
                if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout * 2) {
                    this.cache.set(cacheKey, cached);
                    console.log(`Loaded ${cacheKey} from localStorage`);
                }
            });
        } catch (e) {
            console.warn('Failed to load from localStorage:', e);
        }
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
