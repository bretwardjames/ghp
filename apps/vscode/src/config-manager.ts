import * as vscode from 'vscode';
import type {
    GHProjectsConfig,
    ProjectStatusConfig,
    StatusMapping,
    ProjectWithFields,
} from './types';

const CONFIG_KEY = 'ghProjects';
const PROJECTS_CONFIG_KEY = 'projectConfigs';

/**
 * Default status categories that users can map their project statuses to
 */
export const DEFAULT_STATUS_CATEGORIES: Record<string, StatusMapping> = {
    'In Progress': {
        displayName: 'In Progress',
        order: 0,
        icon: 'play-circle',
        color: 'charts.yellow',
    },
    'In Review': {
        displayName: 'In Review',
        order: 1,
        icon: 'eye',
        color: 'charts.purple',
    },
    'Todo': {
        displayName: 'Todo',
        order: 2,
        icon: 'circle-outline',
    },
    'Backlog': {
        displayName: 'Backlog',
        order: 3,
        icon: 'inbox',
    },
    'Done': {
        displayName: 'Done',
        order: 4,
        icon: 'pass-filled',
        color: 'charts.green',
    },
    'Blocked': {
        displayName: 'Blocked',
        order: 5,
        icon: 'error',
        color: 'charts.red',
    },
};

/**
 * Manages extension configuration including status mappings
 */
export class ConfigManager {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Get the full configuration
     */
    getConfig(): GHProjectsConfig {
        const stored = this.context.workspaceState.get<GHProjectsConfig>(PROJECTS_CONFIG_KEY);
        return {
            statusCategories: stored?.statusCategories || { ...DEFAULT_STATUS_CATEGORIES },
            projects: stored?.projects || {},
        };
    }

    /**
     * Save configuration
     */
    async saveConfig(config: GHProjectsConfig): Promise<void> {
        await this.context.workspaceState.update(PROJECTS_CONFIG_KEY, config);
    }

    /**
     * Get configuration for a specific project
     */
    getProjectConfig(projectId: string): ProjectStatusConfig | null {
        const config = this.getConfig();
        return config.projects[projectId] || null;
    }

    /**
     * Initialize or update configuration for a project
     * Auto-maps status values to categories based on name similarity
     */
    async initializeProjectConfig(project: ProjectWithFields): Promise<ProjectStatusConfig> {
        const config = this.getConfig();

        // Check if already configured
        if (config.projects[project.id]) {
            return config.projects[project.id];
        }

        // Auto-generate mappings based on status option names
        const statusMappings: Record<string, string> = {};

        for (const statusOption of project.statusOptions) {
            const mappedCategory = this.autoMapStatus(statusOption);
            statusMappings[statusOption] = mappedCategory;
        }

        const projectConfig: ProjectStatusConfig = {
            projectId: project.id,
            projectTitle: project.title,
            enabled: true,
            statusMappings,
        };

        config.projects[project.id] = projectConfig;
        await this.saveConfig(config);

        return projectConfig;
    }

    /**
     * Update status mappings for a project
     */
    async updateProjectMappings(
        projectId: string,
        mappings: Record<string, string>
    ): Promise<void> {
        const config = this.getConfig();
        if (config.projects[projectId]) {
            config.projects[projectId].statusMappings = mappings;
            await this.saveConfig(config);
        }
    }

    /**
     * Enable or disable a project
     */
    async setProjectEnabled(projectId: string, enabled: boolean): Promise<void> {
        const config = this.getConfig();
        if (config.projects[projectId]) {
            config.projects[projectId].enabled = enabled;
            await this.saveConfig(config);
        }
    }

    /**
     * Get all enabled project IDs
     */
    getEnabledProjectIds(): string[] {
        const config = this.getConfig();
        return Object.entries(config.projects)
            .filter(([_, pc]) => pc.enabled)
            .map(([id]) => id);
    }

    /**
     * Map a status value to its display category
     */
    mapStatus(projectId: string, originalStatus: string): string {
        const projectConfig = this.getProjectConfig(projectId);
        if (!projectConfig) {
            return originalStatus;
        }
        return projectConfig.statusMappings[originalStatus] || originalStatus;
    }

    /**
     * Get status display info (icon, color, order)
     */
    getStatusDisplay(categoryName: string): StatusMapping {
        const config = this.getConfig();
        return (
            config.statusCategories[categoryName] || {
                displayName: categoryName,
                order: 99,
            }
        );
    }

    /**
     * Auto-map a status value to a category based on name similarity
     */
    private autoMapStatus(statusName: string): string {
        const lower = statusName.toLowerCase();

        // Direct matches
        if (lower.includes('progress') || lower.includes('doing') || lower.includes('active')) {
            return 'In Progress';
        }
        if (lower.includes('review') || lower.includes('pr ') || lower.includes('waiting')) {
            return 'In Review';
        }
        if (lower.includes('todo') || lower.includes('ready') || lower.includes('next')) {
            return 'Todo';
        }
        if (lower.includes('backlog') || lower.includes('later') || lower.includes('icebox')) {
            return 'Backlog';
        }
        if (lower.includes('done') || lower.includes('complete') || lower.includes('closed') || lower.includes('shipped')) {
            return 'Done';
        }
        if (lower.includes('block') || lower.includes('stuck') || lower.includes('hold')) {
            return 'Blocked';
        }

        // Default: keep original name
        return statusName;
    }

    /**
     * Add a custom status category
     */
    async addStatusCategory(name: string, mapping: StatusMapping): Promise<void> {
        const config = this.getConfig();
        config.statusCategories[name] = mapping;
        await this.saveConfig(config);
    }
}
