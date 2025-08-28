// Azure Blob Storage Integration
const STORAGE_ACCOUNT = 'saxtechartifactstorage';
const CONTAINER_NAME = 'artifacts';
const BLOB_BASE_URL = `https://${STORAGE_ACCOUNT}.blob.core.windows.net/${CONTAINER_NAME}`;

// Project storage management
class AzureBlobManager {
    constructor() {
        this.projects = [];
        this.loadProjectsFromBlob();
    }

    // Load projects from blob storage
    async loadProjectsFromBlob() {
        try {
            const response = await fetch(`${BLOB_BASE_URL}/projects.json`);
            if (response.ok) {
                this.projects = await response.json();
                this.renderProjects();
                this.updateStats();
            } else {
                // If no projects file exists, use default data
                this.initializeDefaultProjects();
            }
        } catch (error) {
            console.log('Loading default projects:', error);
            this.initializeDefaultProjects();
        }
    }

    // Initialize with default projects
    initializeDefaultProjects() {
        this.projects = [
            {
                id: 1,
                name: "ConnectWise PSA Integration Suite",
                client: "Internal - SAXTech",
                type: "ITIL Automation",
                description: "Next-generation service desk automation leveraging Pia.AI for intelligent ticket routing and resolution",
                github: "https://github.com/saxtech/connectwise-integration",
                frontend: "https://saxtech-cw.azurewebsites.net",
                artifacts: [
                    { name: "SOW_ConnectWise_2024.pdf", type: "SOW", size: "2.4 MB", icon: "📋", blobUrl: "" },
                    { name: "ROI_Analysis_Q1.xlsx", type: "ROI", size: "1.1 MB", icon: "📊", blobUrl: "" }
                ],
                created: new Date("2024-01-15"),
                status: "active"
            },
            {
                id: 2,
                name: "Azure Cognitive Search Platform",
                client: "TechCorp Solutions",
                type: "AI Integration",
                description: "Enterprise semantic search with vectorized indexing and Azure OpenAI integration",
                github: "https://github.com/saxtech/azure-cognitive",
                frontend: "https://techcorp-search.azurewebsites.net",
                artifacts: [
                    { name: "Requirements_v2.docx", type: "ClientData", size: "890 KB", icon: "📄", blobUrl: "" },
                    { name: "API_Documentation.pdf", type: "Documentation", size: "4.5 MB", icon: "📚", blobUrl: "" }
                ],
                created: new Date("2024-02-01"),
                status: "active"
            }
        ];
        this.renderProjects();
        this.updateStats();
    }

    // List blobs in container
    async listBlobs() {
        try {
            const response = await fetch(`${BLOB_BASE_URL}?restype=container&comp=list`);
            if (response.ok) {
                const text = await response.text();
                const parser = new DOMParser();
                const xml = parser.parseFromString(text, 'text/xml');
                const blobs = xml.getElementsByTagName('Blob');
                
                const blobList = [];
                for (let blob of blobs) {
                    const name = blob.getElementsByTagName('Name')[0].textContent;
                    const url = blob.getElementsByTagName('Url')[0].textContent;
                    const size = blob.getElementsByTagName('Properties')[0]
                        .getElementsByTagName('Content-Length')[0].textContent;
                    
                    blobList.push({ name, url, size });
                }
                return blobList;
            }
        } catch (error) {
            console.error('Error listing blobs:', error);
        }
        return [];
    }

    // Upload file to blob storage
    async uploadFile(file, projectId, artifactType) {
        const fileName = `project-${projectId}/${artifactType}/${file.name}`;
        const blobUrl = `${BLOB_BASE_URL}/${fileName}`;
        
        try {
            // Note: In production, you would use Azure AD authentication
            // For now, we'll store the file reference
            const project = this.projects.find(p => p.id === projectId);
            if (project) {
                const artifact = {
                    name: file.name,
                    type: artifactType,
                    size: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
                    icon: this.getIconForType(artifactType),
                    blobUrl: blobUrl,
                    uploadDate: new Date().toISOString()
                };
                
                project.artifacts.push(artifact);
                this.saveProjectsToLocalStorage();
                return true;
            }
        } catch (error) {
            console.error('Upload error:', error);
            return false;
        }
    }

    // Download artifact
    async downloadArtifact(blobUrl, filename) {
        try {
            const response = await fetch(blobUrl);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Download error:', error);
            window.showToast('Error downloading file', 'error');
        }
    }

    // Get icon for artifact type
    getIconForType(type) {
        const iconMap = {
            'SOW': '📋',
            'ROI': '📊',
            'N8N': '⚙️',
            'ClientData': '📄',
            'Documentation': '📚',
            'Architecture': '🏗️',
            'Other': '📁'
        };
        return iconMap[type] || '📁';
    }

    // Save projects to localStorage (temporary until blob write is implemented)
    saveProjectsToLocalStorage() {
        localStorage.setItem('saxtech_projects', JSON.stringify(this.projects));
        this.renderProjects();
        this.updateStats();
    }

    // Load projects from localStorage
    loadProjectsFromLocalStorage() {
        const stored = localStorage.getItem('saxtech_projects');
        if (stored) {
            this.projects = JSON.parse(stored);
            return true;
        }
        return false;
    }

    // Render projects to UI
    renderProjects() {
        if (window.renderProjects) {
            window.renderProjects(this.projects);
        }
    }

    // Update statistics
    updateStats() {
        if (window.updateStats) {
            window.updateStats();
        }
    }

    // Create new project
    createProject(projectData) {
        const newProject = {
            id: this.projects.length + 1,
            ...projectData,
            artifacts: [],
            created: new Date(),
            status: "active"
        };
        
        this.projects.unshift(newProject);
        this.saveProjectsToLocalStorage();
        return newProject;
    }

    // Get all projects
    getProjects() {
        return this.projects;
    }

    // Get project by ID
    getProject(id) {
        return this.projects.find(p => p.id === id);
    }
}

// Initialize blob manager when DOM is ready
let blobManager;
document.addEventListener('DOMContentLoaded', () => {
    blobManager = new AzureBlobManager();
    
    // Override the global projects variable
    Object.defineProperty(window, 'projects', {
        get: function() {
            return blobManager.getProjects();
        },
        set: function(value) {
            blobManager.projects = value;
            blobManager.saveProjectsToLocalStorage();
        }
    });
});

// Export for use in HTML
window.AzureBlobManager = AzureBlobManager;
