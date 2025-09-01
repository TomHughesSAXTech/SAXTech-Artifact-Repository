// Preview Handler for Project URL Previews
(function() {
    'use strict';
    
    // Track loaded previews
    const loadedPreviews = new Set();
    
    // Initialize preview handlers when DOM is ready
    document.addEventListener('DOMContentLoaded', initializePreviews);
    
    function initializePreviews() {
        // Set up Intersection Observer for lazy loading
        const observer = new IntersectionObserver(handleIntersection, {
            root: null,
            rootMargin: '50px',
            threshold: 0.01
        });
        
        // Observe all project cards
        observeProjectCards(observer);
        
        // Re-observe when projects are re-rendered
        const originalRenderProjects = window.renderProjects;
        if (originalRenderProjects) {
            window.renderProjects = function(...args) {
                originalRenderProjects.apply(this, args);
                setTimeout(() => observeProjectCards(observer), 100);
            };
        }
    }
    
    function observeProjectCards(observer) {
        // Find all project cards with preview containers
        const previewContainers = document.querySelectorAll('.url-preview-container');
        previewContainers.forEach(container => {
            const projectId = container.dataset.projectId;
            if (!loadedPreviews.has(projectId)) {
                observer.observe(container);
            }
        });
        
        // Also set up hover handlers for project cards
        const projectCards = document.querySelectorAll('.project-card');
        projectCards.forEach(card => {
            card.addEventListener('mouseenter', handleCardHover);
            card.addEventListener('mouseleave', handleCardLeave);
        });
    }
    
    function handleIntersection(entries, observer) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const container = entry.target;
                const projectId = container.dataset.projectId;
                
                // Only load if hovering over the card
                const card = container.closest('.project-card');
                if (card && card.matches(':hover')) {
                    loadPreview(container);
                    observer.unobserve(container);
                }
            }
        });
    }
    
    function handleCardHover(event) {
        const card = event.currentTarget;
        const container = card.querySelector('.url-preview-container');
        
        if (container) {
            const projectId = container.dataset.projectId;
            
            // Delay loading to avoid loading on quick hovers
            card.previewTimeout = setTimeout(() => {
                if (!loadedPreviews.has(projectId)) {
                    loadPreview(container);
                }
            }, 500); // Wait 500ms before loading
        }
    }
    
    function handleCardLeave(event) {
        const card = event.currentTarget;
        
        // Cancel pending preview load
        if (card.previewTimeout) {
            clearTimeout(card.previewTimeout);
        }
    }
    
    function loadPreview(container) {
        const projectId = container.dataset.projectId;
        const iframe = container.querySelector('.preview-iframe');
        
        if (iframe && iframe.dataset.src && !iframe.src) {
            const url = iframe.dataset.src;
            
            // Mark as loaded
            loadedPreviews.add(projectId);
            
            // Check if URL is likely to allow embedding
            if (isEmbeddable(url)) {
                // Set the src to load the iframe
                iframe.src = url;
            } else {
                // Show message for non-embeddable sites
                const wrapper = iframe.parentElement;
                wrapper.innerHTML = `
                    <div class="preview-error">
                        <div style="font-size: 24px; margin-bottom: 8px;">🔒</div>
                        <div>Preview blocked by site policy</div>
                        <small style="color: var(--sax-text-dim); display: block; margin-top: 4px;">
                            ${new URL(url).hostname}
                        </small>
                    </div>
                `;
            }
        }
    }
    
    function isEmbeddable(url) {
        try {
            const hostname = new URL(url).hostname;
            
            // List of known sites that block embedding
            const blockedSites = [
                'github.com',
                'portal.azure.com',
                'chat.openai.com',
                'claude.ai',
                'google.com',
                'microsoft.com',
                'stackoverflow.com',
                'twitter.com',
                'x.com',
                'facebook.com',
                'linkedin.com',
                'youtube.com',
                'aol.com',
                'yahoo.com',
                'gmail.com',
                'outlook.com',
                'reddit.com',
                'instagram.com',
                'whatsapp.com',
                'tiktok.com',
                'amazon.com',
                'netflix.com',
                'spotify.com',
                'apple.com',
                'dropbox.com',
                'salesforce.com'
            ];
            
            // Check if hostname includes any blocked sites
            return !blockedSites.some(site => hostname.includes(site));
        } catch (e) {
            return false;
        }
    }
    
    // Export for testing
    window.previewHandler = {
        loadedPreviews,
        loadPreview,
        isEmbeddable
    };
})();
