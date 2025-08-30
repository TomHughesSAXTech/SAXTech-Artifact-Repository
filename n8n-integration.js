// N8N Integration Module with Workflow Visualization
class N8NIntegration {
    constructor() {
        // Default API key for SAXTech N8N instance
        const defaultApiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmNGM1ZDRmMy0wODlkLTQ3MDQtOWMxNy01MDY3Njc4ZjIxYzkiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwiaWF0IjoxNzU2MTcyNjAwfQ.hB9qJWoV-aFJCcYR791HALl9iBiP8lgdDM8lmG--3sI';
        
        // Check if API key is already stored, if not use default
        this.apiKey = localStorage.getItem('n8n_api_key') || defaultApiKey;
        
        // Store the API key if it wasn't already stored
        if (!localStorage.getItem('n8n_api_key')) {
            localStorage.setItem('n8n_api_key', defaultApiKey);
        }
        
        this.baseUrl = localStorage.getItem('n8n_url') || 'https://workflows.saxtechnology.com';
        this.syncInterval = null;
        this.lastSync = localStorage.getItem('n8n_last_sync') ? new Date(localStorage.getItem('n8n_last_sync')) : null;
        this.workflowCache = new Map();
        
        // Start periodic sync if API key exists
        if (this.apiKey) {
            this.startPeriodicSync();
        }
    }
    
    // Set or update API key
    setApiKey(apiKey) {
        this.apiKey = apiKey;
        localStorage.setItem('n8n_api_key', apiKey);
        if (apiKey) {
            this.startPeriodicSync();
        } else {
            this.stopPeriodicSync();
        }
    }
    
    // Parse N8N URL to extract workflow ID
    parseN8NUrl(url) {
        try {
            const urlObj = new URL(url);
            // Match patterns like /workflow/123 or /workflows/abc-def-ghi
            const match = urlObj.pathname.match(/\/workflows?\/([a-zA-Z0-9-]+)/);
            if (match) {
                return {
                    workflowId: match[1],
                    baseUrl: urlObj.origin
                };
            }
        } catch (e) {
            console.error('Invalid N8N URL:', url);
        }
        return null;
    }
    
    // Fetch workflow data from N8N API
    async fetchWorkflow(workflowId, baseUrl = null) {
        // Now using direct URL with CORS properly configured via NGINX
        const apiUrl = baseUrl || this.baseUrl || 'https://workflows.saxtechnology.com';
        
        if (!this.apiKey) {
            throw new Error('N8N API key not configured');
        }
        
        try {
            // Direct API call - CORS is now handled by NGINX ingress
            const response = await fetch(`${apiUrl}/api/v1/workflows/${workflowId}`, {
                headers: {
                    'X-N8N-API-KEY': this.apiKey,
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Invalid API key');
                }
                throw new Error(`Failed to fetch workflow: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Cache the workflow data
            this.workflowCache.set(workflowId, data);
            
            return data;
        } catch (error) {
            console.error('Error fetching N8N workflow:', error);
            throw error;
        }
    }
    
    // Fetch and store workflow JSON to blob
    async syncWorkflowToBlob(url, projectId) {
        const parsed = this.parseN8NUrl(url);
        if (!parsed) {
            console.error('Invalid N8N URL:', url);
            return false;
        }
        
        try {
            const workflowData = await this.fetchWorkflow(parsed.workflowId, parsed.baseUrl);
            
            // Create a blob from the workflow JSON
            const jsonString = JSON.stringify(workflowData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            
            // Generate consistent filename (no timestamp to avoid duplicates)
            const filename = `n8n_workflow_${workflowData.name || parsed.workflowId}.json`;
            
            // Store in blob storage - check for existing artifact first
            if (window.blobManager) {
                const project = window.blobManager.projects.find(p => String(p.id) === String(projectId));
                if (project) {
                    // Check if artifact with this name already exists
                    const existingArtifactIndex = project.artifacts.findIndex(a => 
                        a.name === filename || 
                        (a.name && a.name.startsWith(`n8n_workflow_${workflowData.name || parsed.workflowId}`))
                    );
                    
                    if (existingArtifactIndex >= 0) {
                        // Update existing artifact
                        project.artifacts[existingArtifactIndex] = {
                            name: filename,
                            type: 'N8N',
                            icon: '⚙️',
                            size: `${(blob.size / 1024).toFixed(2)} KB`,
                            uploadDate: new Date().toISOString(),
                            workflowId: parsed.workflowId
                        };
                    } else {
                        // Add new artifact
                        project.artifacts.push({
                            name: filename,
                            type: 'N8N',
                            icon: '⚙️',
                            size: `${(blob.size / 1024).toFixed(2)} KB`,
                            uploadDate: new Date().toISOString(),
                            workflowId: parsed.workflowId
                        });
                    }
                    
                    // Save updated project
                    await window.blobManager.saveProjectsToBlob();
                }
            }
            
            console.log(`Synced N8N workflow: ${workflowData.name}`);
            return workflowData;
        } catch (error) {
            console.error('Error syncing N8N workflow (non-blocking):', error);
            // Don't block project creation - just log the error
            console.warn('N8N workflow sync failed due to CORS. The project will be created without workflow sync.');
            // Return a placeholder object so project creation continues
            return {
                error: true,
                message: 'Workflow sync failed - CORS issue. Project created without workflow data.',
                workflowId: parsed.workflowId
            };
        }
    }
    
    // Sync all N8N workflows for a project
    async syncProjectWorkflows(project) {
        if (!project.n8nWorkflows) return [];
        
        const results = [];
        
        try {
            // Sync main workflow
            if (project.n8nWorkflows.main) {
                const result = await this.syncWorkflowToBlob(project.n8nWorkflows.main, project.id);
                if (result) results.push(result);
            }
            
            // Sync additional workflows
            if (project.n8nWorkflows.additional && Array.isArray(project.n8nWorkflows.additional)) {
                for (const url of project.n8nWorkflows.additional) {
                    if (url.trim()) {
                        const result = await this.syncWorkflowToBlob(url, project.id);
                        if (result) results.push(result);
                    }
                }
            }
        } catch (error) {
            console.error('Error in syncProjectWorkflows (non-blocking):', error);
            console.warn('Continuing without n8n workflow sync');
        }
        
        return results;
    }
    
    // Sync all workflows across all projects
    async syncAllWorkflows() {
        console.log('Starting N8N workflow sync...');
        const startTime = Date.now();
        let syncCount = 0;
        
        // Wait for blob manager to initialize if it hasn't yet
        if (!window.blobManager) {
            console.log('Waiting for blob manager to initialize...');
            // Try again in 2 seconds
            setTimeout(() => this.syncAllWorkflows(), 2000);
            return;
        }
        
        if (!window.blobManager.projects || window.blobManager.projects.length === 0) {
            console.log('No projects available for N8N sync');
            return;
        }
        
        for (const project of window.blobManager.projects) {
            const results = await this.syncProjectWorkflows(project);
            syncCount += results.length;
        }
        
        // Update last sync time
        this.lastSync = new Date();
        localStorage.setItem('n8n_last_sync', this.lastSync.toISOString());
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`N8N sync completed: ${syncCount} workflows in ${duration}s`);
        
        return syncCount;
    }
    
    // Start periodic sync (hourly)
    startPeriodicSync() {
        // Clear any existing interval
        this.stopPeriodicSync();
        
        // Run initial sync
        this.syncAllWorkflows();
        
        // Set up hourly sync (3600000 ms = 1 hour)
        this.syncInterval = setInterval(() => {
            this.syncAllWorkflows();
        }, 3600000);
        
        console.log('N8N periodic sync started (hourly)');
    }
    
    // Stop periodic sync
    stopPeriodicSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
            console.log('N8N periodic sync stopped');
        }
    }
    
    // Generate workflow visualization
    renderWorkflowDiagram(workflowData, containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('Container not found:', containerId);
            return;
        }
        
        // Clear existing content
        container.innerHTML = '';
        
        // Check if we have nodes to render
        if (!workflowData.nodes || workflowData.nodes.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--sax-text-dim);">No workflow nodes to display</div>';
            return;
        }
        
        // Create SVG canvas
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '400');
        svg.style.backgroundColor = '#0f1729';
        svg.style.borderRadius = '12px';
        svg.style.border = '1px solid rgba(0,212,255,0.15)';
        
        // Calculate node positions
        const nodes = workflowData.nodes || [];
        const connections = workflowData.connections || {};
        
        // Simple grid layout
        const nodeWidth = 180;
        const nodeHeight = 80;
        const padding = 40;
        const horizontalSpacing = 250;
        const verticalSpacing = 120;
        
        // Group nodes by their approximate flow position
        const nodePositions = new Map();
        const nodesByColumn = this.arrangeNodesInColumns(nodes, connections);
        
        // Position nodes
        nodesByColumn.forEach((columnNodes, columnIndex) => {
            columnNodes.forEach((node, rowIndex) => {
                const x = padding + (columnIndex * horizontalSpacing);
                const y = padding + (rowIndex * verticalSpacing);
                nodePositions.set(node.name, { x, y, node });
            });
        });
        
        // Draw connections
        const connectionsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        connectionsGroup.setAttribute('class', 'connections');
        
        Object.entries(connections).forEach(([sourceNodeName, sourceConnections]) => {
            const sourcePos = nodePositions.get(sourceNodeName);
            if (!sourcePos) return;
            
            Object.entries(sourceConnections).forEach(([outputType, outputConnections]) => {
                outputConnections.forEach(connectionArray => {
                    connectionArray.forEach(connection => {
                        const targetPos = nodePositions.get(connection.node);
                        if (!targetPos) return;
                        
                        // Create curved path
                        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                        const startX = sourcePos.x + nodeWidth;
                        const startY = sourcePos.y + nodeHeight / 2;
                        const endX = targetPos.x;
                        const endY = targetPos.y + nodeHeight / 2;
                        const midX = (startX + endX) / 2;
                        
                        const d = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
                        path.setAttribute('d', d);
                        path.setAttribute('stroke', '#00d4ff');
                        path.setAttribute('stroke-width', '2');
                        path.setAttribute('fill', 'none');
                        path.setAttribute('opacity', '0.6');
                        
                        connectionsGroup.appendChild(path);
                    });
                });
            });
        });
        
        svg.appendChild(connectionsGroup);
        
        // Draw nodes
        const nodesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        nodesGroup.setAttribute('class', 'nodes');
        
        nodePositions.forEach(({ x, y, node }) => {
            // Node container
            const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            nodeGroup.setAttribute('transform', `translate(${x}, ${y})`);
            
            // Node rectangle
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('width', nodeWidth);
            rect.setAttribute('height', nodeHeight);
            rect.setAttribute('rx', '8');
            rect.setAttribute('fill', '#1a2332');
            rect.setAttribute('stroke', 'rgba(0,212,255,0.3)');
            rect.setAttribute('stroke-width', '2');
            
            // Add gradient based on node type
            if (node.type.includes('trigger')) {
                rect.setAttribute('fill', 'rgba(16, 185, 129, 0.1)');
                rect.setAttribute('stroke', 'rgba(16, 185, 129, 0.5)');
            } else if (node.type.includes('webhook')) {
                rect.setAttribute('fill', 'rgba(124, 58, 237, 0.1)');
                rect.setAttribute('stroke', 'rgba(124, 58, 237, 0.5)');
            } else if (node.type.includes('if') || node.type.includes('switch')) {
                rect.setAttribute('fill', 'rgba(245, 158, 11, 0.1)');
                rect.setAttribute('stroke', 'rgba(245, 158, 11, 0.5)');
            }
            
            nodeGroup.appendChild(rect);
            
            // Node icon
            const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            icon.setAttribute('x', '15');
            icon.setAttribute('y', '35');
            icon.setAttribute('font-size', '24');
            icon.textContent = this.getNodeIcon(node.type);
            nodeGroup.appendChild(icon);
            
            // Node name
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', '50');
            text.setAttribute('y', '35');
            text.setAttribute('font-family', 'Inter, sans-serif');
            text.setAttribute('font-size', '13');
            text.setAttribute('font-weight', '600');
            text.setAttribute('fill', '#e2e8f0');
            
            // Truncate long names
            const displayName = node.name.length > 20 ? node.name.substring(0, 17) + '...' : node.name;
            text.textContent = displayName;
            nodeGroup.appendChild(text);
            
            // Node type
            const typeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            typeText.setAttribute('x', '50');
            typeText.setAttribute('y', '55');
            typeText.setAttribute('font-family', 'Inter, sans-serif');
            typeText.setAttribute('font-size', '11');
            typeText.setAttribute('fill', '#94a3b8');
            typeText.textContent = node.type.split('.').pop();
            nodeGroup.appendChild(typeText);
            
            nodesGroup.appendChild(nodeGroup);
        });
        
        svg.appendChild(nodesGroup);
        
        // Set viewBox to fit content - with fallback for empty bbox
        try {
            const bbox = svg.getBBox();
            if (bbox.width > 0 && bbox.height > 0) {
                svg.setAttribute('viewBox', `${bbox.x - 20} ${bbox.y - 20} ${bbox.width + 40} ${bbox.height + 40}`);
            } else {
                // Fallback viewBox if getBBox fails
                const maxX = Math.max(...Array.from(nodePositions.values()).map(p => p.x + nodeWidth));
                const maxY = Math.max(...Array.from(nodePositions.values()).map(p => p.y + nodeHeight));
                svg.setAttribute('viewBox', `0 0 ${maxX + 40} ${maxY + 40}`);
            }
        } catch (e) {
            console.warn('Could not calculate SVG viewBox, using default');
            svg.setAttribute('viewBox', '0 0 800 400');
        }
        
        container.appendChild(svg);
    }
    
    // Arrange nodes in columns for better visualization
    arrangeNodesInColumns(nodes, connections) {
        const columns = [];
        const visited = new Set();
        const nodeMap = new Map(nodes.map(n => [n.name, n]));
        
        // Find start nodes (triggers or nodes with no incoming connections)
        const startNodes = nodes.filter(node => {
            const hasIncoming = Object.values(connections).some(sourceConns =>
                Object.values(sourceConns).some(outputConns =>
                    outputConns.some(connArray =>
                        connArray.some(conn => conn.node === node.name)
                    )
                )
            );
            return !hasIncoming || node.type.includes('trigger') || node.type.includes('webhook');
        });
        
        // BFS to arrange nodes in columns
        let currentColumn = startNodes;
        while (currentColumn.length > 0) {
            columns.push(currentColumn);
            currentColumn.forEach(node => visited.add(node.name));
            
            const nextColumn = [];
            currentColumn.forEach(node => {
                const nodeConnections = connections[node.name] || {};
                Object.values(nodeConnections).forEach(outputConns => {
                    outputConns.forEach(connArray => {
                        connArray.forEach(conn => {
                            if (!visited.has(conn.node) && nodeMap.has(conn.node)) {
                                const targetNode = nodeMap.get(conn.node);
                                if (!nextColumn.includes(targetNode)) {
                                    nextColumn.push(targetNode);
                                }
                            }
                        });
                    });
                });
            });
            
            currentColumn = nextColumn;
        }
        
        // Add any unvisited nodes to the last column
        const unvisited = nodes.filter(n => !visited.has(n.name));
        if (unvisited.length > 0) {
            columns.push(unvisited);
        }
        
        return columns;
    }
    
    // Get icon for node type
    getNodeIcon(nodeType) {
        const type = nodeType.toLowerCase();
        if (type.includes('webhook')) return '🔗';
        if (type.includes('http')) return '🌐';
        if (type.includes('trigger')) return '⚡';
        if (type.includes('if') || type.includes('switch')) return '🔀';
        if (type.includes('function') || type.includes('code')) return '📝';
        if (type.includes('email')) return '📧';
        if (type.includes('database') || type.includes('sql')) return '🗄️';
        if (type.includes('spreadsheet') || type.includes('sheet')) return '📊';
        if (type.includes('slack')) return '💬';
        if (type.includes('discord')) return '🎮';
        if (type.includes('telegram')) return '✈️';
        if (type.includes('wait') || type.includes('delay')) return '⏱️';
        if (type.includes('merge')) return '🔄';
        if (type.includes('split')) return '✂️';
        if (type.includes('set') || type.includes('data')) return '📦';
        return '⚙️';
    }
    
    // Create workflow preview modal
    async showWorkflowPreview(url) {
        const parsed = this.parseN8NUrl(url);
        if (!parsed) {
            alert('Invalid N8N URL');
            return;
        }
        
        try {
            // Fetch workflow data
            const workflowData = await this.fetchWorkflow(parsed.workflowId, parsed.baseUrl);
            
            // Create modal
            const modal = document.createElement('div');
            modal.className = 'modal active';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 900px;">
                    <div class="modal-header">
                        <h2 class="modal-title">N8N Workflow: ${workflowData.name}</h2>
                        <button class="close-modal" onclick="this.closest('.modal').remove()">×</button>
                    </div>
                    <div style="margin-bottom: 20px;">
                        <div style="display: flex; gap: 20px; margin-bottom: 16px;">
                            <div>
                                <span style="color: var(--sax-text-dim); font-size: 12px;">Status:</span>
                                <span style="color: ${workflowData.active ? 'var(--sax-success)' : 'var(--sax-text-dim)'}; font-weight: 600;">
                                    ${workflowData.active ? '🟢 Active' : '⭕ Inactive'}
                                </span>
                            </div>
                            <div>
                                <span style="color: var(--sax-text-dim); font-size: 12px;">Nodes:</span>
                                <span style="color: var(--sax-text); font-weight: 600;">${workflowData.nodes?.length || 0}</span>
                            </div>
                            <div>
                                <span style="color: var(--sax-text-dim); font-size: 12px;">Updated:</span>
                                <span style="color: var(--sax-text); font-weight: 600;">${new Date(workflowData.updatedAt).toLocaleDateString()}</span>
                            </div>
                        </div>
                        <div id="workflowDiagram" style="width: 100%; height: 400px; overflow: auto;"></div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Close</button>
                        <button class="btn btn-primary" onclick="window.open('${url}', '_blank')">
                            <span class="btn-icon">🔗</span>
                            Open in N8N
                        </button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // Render workflow diagram
            this.renderWorkflowDiagram(workflowData, 'workflowDiagram');
            
        } catch (error) {
            alert('Failed to load workflow preview: ' + error.message);
        }
    }
}

// Initialize N8N integration
window.n8nIntegration = new N8NIntegration();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = N8NIntegration;
}
