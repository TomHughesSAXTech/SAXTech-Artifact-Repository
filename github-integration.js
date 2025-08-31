// GitHub Integration for SAXTech Repository Site
// Handles fetching repository information including last updated times

(function() {
    'use strict';

    // GitHub Integration Manager
    class GitHubIntegration {
        constructor() {
            this.apiBase = 'https://api.github.com';
            this.cache = new Map();
            this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
            this.rateLimitRemaining = null;
            this.rateLimitReset = null;
        }

        // Parse GitHub URL to extract owner and repo
        parseGitHubUrl(url) {
            if (!url) return null;
            
            // Handle various GitHub URL formats
            const patterns = [
                /github\.com[\/:]([^\/]+)\/([^\/\.\s]+)/i,
                /^([^\/]+)\/([^\/\s]+)$/
            ];
            
            for (const pattern of patterns) {
                const match = url.match(pattern);
                if (match) {
                    return {
                        owner: match[1],
                        repo: match[2].replace(/\.git$/, '')
                    };
                }
            }
            
            return null;
        }

        // Get cached data if available and not expired
        getCached(key) {
            const cached = this.cache.get(key);
            if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
            return null;
        }

        // Store data in cache
        setCache(key, data) {
            this.cache.set(key, {
                data: data,
                timestamp: Date.now()
            });
        }

        // Fetch repository information from GitHub API
        async fetchRepoInfo(owner, repo) {
            const cacheKey = `${owner}/${repo}`;
            
            // Check cache first
            const cached = this.getCached(cacheKey);
            if (cached) {
                return cached;
            }

            try {
                const response = await fetch(`${this.apiBase}/repos/${owner}/${repo}`, {
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        // Add token if available (optional, increases rate limit)
                        ...(this.token ? { 'Authorization': `token ${this.token}` } : {})
                    }
                });

                // Handle rate limiting
                this.rateLimitRemaining = parseInt(response.headers.get('X-RateLimit-Remaining') || '60');
                this.rateLimitReset = parseInt(response.headers.get('X-RateLimit-Reset') || '0') * 1000;

                if (response.status === 403 && this.rateLimitRemaining === 0) {
                    const resetTime = new Date(this.rateLimitReset).toLocaleTimeString();
                    console.warn(`GitHub API rate limit exceeded. Resets at ${resetTime}`);
                    return null;
                }

                if (!response.ok) {
                    console.error(`GitHub API error: ${response.status} for ${owner}/${repo}`);
                    return null;
                }

                const data = await response.json();
                
                // Extract relevant information
                const repoInfo = {
                    name: data.name,
                    fullName: data.full_name,
                    description: data.description,
                    updatedAt: data.updated_at,
                    pushedAt: data.pushed_at,
                    createdAt: data.created_at,
                    language: data.language,
                    stargazersCount: data.stargazers_count,
                    forksCount: data.forks_count,
                    openIssuesCount: data.open_issues_count,
                    defaultBranch: data.default_branch,
                    htmlUrl: data.html_url,
                    topics: data.topics || []
                };

                // Cache the result
                this.setCache(cacheKey, repoInfo);
                
                return repoInfo;
            } catch (error) {
                console.error(`Error fetching GitHub repo info for ${owner}/${repo}:`, error);
                return null;
            }
        }

        // Get last commit information
        async fetchLastCommit(owner, repo, branch = 'main') {
            const cacheKey = `${owner}/${repo}/commits/${branch}`;
            
            // Check cache first
            const cached = this.getCached(cacheKey);
            if (cached) {
                return cached;
            }

            try {
                const response = await fetch(`${this.apiBase}/repos/${owner}/${repo}/commits/${branch}`, {
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        ...(this.token ? { 'Authorization': `token ${this.token}` } : {})
                    }
                });

                if (!response.ok) {
                    // Try with 'master' branch if 'main' fails
                    if (branch === 'main') {
                        return this.fetchLastCommit(owner, repo, 'master');
                    }
                    return null;
                }

                const data = await response.json();
                
                const commitInfo = {
                    sha: data.sha,
                    message: data.commit.message,
                    author: data.commit.author.name,
                    date: data.commit.author.date,
                    url: data.html_url
                };

                // Cache the result
                this.setCache(cacheKey, commitInfo);
                
                return commitInfo;
            } catch (error) {
                console.error(`Error fetching last commit for ${owner}/${repo}:`, error);
                return null;
            }
        }

        // Format the last updated time in a user-friendly way
        formatLastUpdated(dateString) {
            if (!dateString) return 'Unknown';
            
            const date = new Date(dateString);
            const now = new Date();
            const diffMs = now - date;
            const diffSeconds = Math.floor(diffMs / 1000);
            const diffMinutes = Math.floor(diffSeconds / 60);
            const diffHours = Math.floor(diffMinutes / 60);
            const diffDays = Math.floor(diffHours / 24);
            const diffWeeks = Math.floor(diffDays / 7);
            const diffMonths = Math.floor(diffDays / 30);
            const diffYears = Math.floor(diffDays / 365);

            if (diffYears > 0) {
                return `${diffYears} year${diffYears > 1 ? 's' : ''} ago`;
            } else if (diffMonths > 0) {
                return `${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
            } else if (diffWeeks > 0) {
                return `${diffWeeks} week${diffWeeks > 1 ? 's' : ''} ago`;
            } else if (diffDays > 0) {
                return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
            } else if (diffHours > 0) {
                return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
            } else if (diffMinutes > 0) {
                return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''} ago`;
            } else {
                return 'Just now';
            }
        }

        // Update project with GitHub information
        async enrichProjectWithGitHubData(project) {
            if (!project.github) return project;

            const parsed = this.parseGitHubUrl(project.github);
            if (!parsed) return project;

            const repoInfo = await this.fetchRepoInfo(parsed.owner, parsed.repo);
            if (!repoInfo) return project;

            // Add GitHub metadata to project
            return {
                ...project,
                githubData: {
                    lastUpdated: repoInfo.pushedAt || repoInfo.updatedAt,
                    lastUpdatedFormatted: this.formatLastUpdated(repoInfo.pushedAt || repoInfo.updatedAt),
                    description: repoInfo.description,
                    language: repoInfo.language,
                    stars: repoInfo.stargazersCount,
                    forks: repoInfo.forksCount,
                    openIssues: repoInfo.openIssuesCount
                }
            };
        }

        // Batch update projects with GitHub data
        async enrichProjectsWithGitHubData(projects) {
            const enrichedProjects = [];
            
            for (const project of projects) {
                const enriched = await this.enrichProjectWithGitHubData(project);
                enrichedProjects.push(enriched);
                
                // Add a small delay to avoid hitting rate limits
                if (this.rateLimitRemaining && this.rateLimitRemaining < 10) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            return enrichedProjects;
        }

        // Check rate limit status
        getRateLimitStatus() {
            if (this.rateLimitRemaining === null) {
                return { remaining: 60, reset: null };
            }
            
            return {
                remaining: this.rateLimitRemaining,
                reset: this.rateLimitReset ? new Date(this.rateLimitReset) : null
            };
        }

        // Set optional GitHub token for higher rate limits
        setToken(token) {
            this.token = token;
        }
    }

    // Create global instance
    window.gitHubIntegration = new GitHubIntegration();

    // Auto-enrich projects when they're rendered
    const originalRenderProjects = window.renderProjects;
    if (typeof originalRenderProjects === 'function') {
        window.renderProjects = async function(projectList) {
            // Call original render first for immediate display
            originalRenderProjects.call(this, projectList);
            
            // Then enrich with GitHub data and re-render
            const projectsToEnrich = projectList || window.projects || [];
            if (projectsToEnrich.length > 0) {
                const enriched = await window.gitHubIntegration.enrichProjectsWithGitHubData(projectsToEnrich);
                
                // Update the projects array if we enriched the main projects
                if (!projectList || projectList === window.projects) {
                    window.projects = enriched;
                }
                
                // Re-render with enriched data
                originalRenderProjects.call(this, enriched);
            }
        };
    }

    console.log('GitHub Integration loaded successfully');
})();
