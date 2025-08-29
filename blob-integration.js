// Azure Blob Storage Integration with Azure AD Authentication
const STORAGE_ACCOUNT = 'saxtechartifactstorage';
const CONTAINER_NAME = 'artifacts';
const BLOB_BASE_URL = `https://${STORAGE_ACCOUNT}.blob.core.windows.net/${CONTAINER_NAME}`;
// SAS token for read/write access (expires in 1 year - regenerate as needed)
const SAS_TOKEN = 'se=2026-08-29T00%3A40%3A06Z&sp=racwdl&sv=2022-11-02&sr=c&sig=yQaTgRxCPw6PfIJznS5uiavItFNG5PCv5Mzu9k8YB4c%3D';

// Get user info from Azure Static Web Apps authentication
async function getUserInfo() {
    try {
        const response = await fetch('/.auth/me');
        const data = await response.json();
        return data.clientPrincipal;
    } catch (error) {
        console.error('Error getting user info:', error);
        return null;
    }
}

// Check if user is from saxtechnology.com domain
async function isAuthorizedUser() {
    const userInfo = await getUserInfo();
    if (userInfo && userInfo.userDetails) {
        const email = userInfo.userDetails.toLowerCase();
        return email.endsWith('@saxtechnology.com');
    }
    return false;
}

// Project storage management
class AzureBlobManager {
    constructor() {
        this.projects = [];
        this.userInfo = null;
        this.isAuthenticated = false;
        this.initializeAuth();
    }

    // Initialize authentication
    async initializeAuth() {
        this.userInfo = await getUserInfo();
        this.isAuthenticated = await isAuthorizedUser();
        
        if (!this.isAuthenticated) {
            console.log('User not authorized. Redirecting to login...');
            // Static Web App config will handle redirect
        } else {
            console.log('User authenticated:', this.userInfo.userDetails);
            this.loadProjectsFromBlob();
        }
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

    // Initialize with empty projects or load from localStorage
    initializeDefaultProjects() {
        // Try to load from localStorage first
        const stored = localStorage.getItem('saxtech_projects');
        if (stored) {
            try {
                this.projects = JSON.parse(stored);
            } catch (e) {
                this.projects = [];
            }
        } else {
            this.projects = [];
        }
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
        const fileName = `project-${projectId}/${artifactType}/${Date.now()}-${file.name}`;
        const blobUrl = `${BLOB_BASE_URL}/${fileName}`;
        const uploadUrl = `${blobUrl}?${SAS_TOKEN}`;
        
        try {
            // Upload using SAS token
            const response = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    'x-ms-blob-type': 'BlockBlob',
                    'Content-Type': file.type || 'application/octet-stream',
                    'x-ms-blob-content-type': file.type || 'application/octet-stream'
                },
                body: file
            });

            if (response.ok || response.status === 201) {
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
                    await this.saveProjectsToBlob();
                    this.saveProjectsToLocalStorage();
                    return true;
                }
            } else {
                // Fallback to localStorage only
                const project = this.projects.find(p => p.id === projectId);
                if (project) {
                    const artifact = {
                        name: file.name,
                        type: artifactType,
                        size: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
                        icon: this.getIconForType(artifactType),
                        blobUrl: blobUrl,
                        uploadDate: new Date().toISOString(),
                        localOnly: true
                    };
                    
                    project.artifacts.push(artifact);
                    this.saveProjectsToLocalStorage();
                    return true;
                }
            }
        } catch (error) {
            console.error('Upload error:', error);
            // Fallback to localStorage
            const project = this.projects.find(p => p.id === projectId);
            if (project) {
                const artifact = {
                    name: file.name,
                    type: artifactType,
                    size: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
                    icon: this.getIconForType(artifactType),
                    blobUrl: blobUrl,
                    uploadDate: new Date().toISOString(),
                    localOnly: true
                };
                
                project.artifacts.push(artifact);
                this.saveProjectsToLocalStorage();
                return true;
            }
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

    // Save projects to localStorage
    saveProjectsToLocalStorage() {
        localStorage.setItem('saxtech_projects', JSON.stringify(this.projects));
        this.renderProjects();
        this.updateStats();
    }

    // Save projects metadata to blob storage
    async saveProjectsToBlob() {
        try {
            const projectsJson = JSON.stringify(this.projects, null, 2);
            const blob = new Blob([projectsJson], { type: 'application/json' });
            const uploadUrl = `${BLOB_BASE_URL}/projects.json?${SAS_TOKEN}`;
            
            const response = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    'x-ms-blob-type': 'BlockBlob',
                    'Content-Type': 'application/json',
                    'x-ms-blob-content-type': 'application/json'
                },
                body: blob
            });
            
            return response.ok || response.status === 201;
        } catch (error) {
            console.error('Error saving projects to blob:', error);
            return false;
        }
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
    
    // Make blob manager globally accessible
    window.blobManager = blobManager;
    
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
