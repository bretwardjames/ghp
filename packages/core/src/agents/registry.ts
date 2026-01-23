/**
 * File-based Agent Registry
 *
 * MVP implementation using JSON file storage.
 * Future: IPC socket for real-time updates (#107)
 *
 * File location: ~/.ghp/agents.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import type {
    AgentInstance,
    AgentRegistry,
    AgentSummary,
    AgentStatus,
    RegisterAgentOptions,
    UpdateAgentOptions,
} from './types.js';

const REGISTRY_VERSION = 1;

/**
 * Get the path to the registry file
 */
export function getRegistryPath(): string {
    return join(homedir(), '.ghp', 'agents.json');
}

/**
 * Load the registry from disk, creating if needed
 */
export function loadRegistry(): AgentRegistry {
    const path = getRegistryPath();

    if (!existsSync(path)) {
        return {
            version: REGISTRY_VERSION,
            agents: {},
            updatedAt: new Date().toISOString(),
        };
    }

    try {
        const content = readFileSync(path, 'utf-8');
        const registry = JSON.parse(content) as AgentRegistry;

        // Version migration could happen here
        if (registry.version !== REGISTRY_VERSION) {
            // For now, just update version
            registry.version = REGISTRY_VERSION;
        }

        return registry;
    } catch (error) {
        // Corrupted file - start fresh
        console.error('Warning: Could not parse agents.json, starting fresh');
        return {
            version: REGISTRY_VERSION,
            agents: {},
            updatedAt: new Date().toISOString(),
        };
    }
}

/**
 * Save the registry to disk
 */
export function saveRegistry(registry: AgentRegistry): void {
    const path = getRegistryPath();
    const dir = dirname(path);

    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    registry.updatedAt = new Date().toISOString();
    writeFileSync(path, JSON.stringify(registry, null, 2));
}

/**
 * Register a new agent
 */
export function registerAgent(options: RegisterAgentOptions): AgentInstance {
    const registry = loadRegistry();

    const agent: AgentInstance = {
        id: randomUUID(),
        issueNumber: options.issueNumber,
        issueTitle: options.issueTitle,
        pid: options.pid,
        port: options.port,
        worktreePath: options.worktreePath,
        branch: options.branch,
        status: 'starting',
        startedAt: new Date().toISOString(),
    };

    registry.agents[agent.id] = agent;
    saveRegistry(registry);

    return agent;
}

/**
 * Update an existing agent
 */
export function updateAgent(id: string, options: UpdateAgentOptions): AgentInstance | null {
    const registry = loadRegistry();
    const agent = registry.agents[id];

    if (!agent) {
        return null;
    }

    if (options.status !== undefined) {
        agent.status = options.status;
    }
    if (options.port !== undefined) {
        agent.port = options.port;
    }
    if (options.error !== undefined) {
        agent.error = options.error;
    }
    if (options.currentAction !== undefined) {
        agent.currentAction = options.currentAction;
    }
    if (options.waitingForInput !== undefined) {
        agent.waitingForInput = options.waitingForInput;
    }

    agent.lastSeen = new Date().toISOString();
    saveRegistry(registry);

    return agent;
}

/**
 * Unregister an agent (remove from registry)
 */
export function unregisterAgent(id: string): boolean {
    const registry = loadRegistry();

    if (!registry.agents[id]) {
        return false;
    }

    delete registry.agents[id];
    saveRegistry(registry);

    return true;
}

/**
 * Get an agent by ID
 */
export function getAgent(id: string): AgentInstance | null {
    const registry = loadRegistry();
    return registry.agents[id] || null;
}

/**
 * Get an agent by issue number
 */
export function getAgentByIssue(issueNumber: number): AgentInstance | null {
    const registry = loadRegistry();

    for (const agent of Object.values(registry.agents)) {
        if (agent.issueNumber === issueNumber) {
            return agent;
        }
    }

    return null;
}

/**
 * List all registered agents
 */
export function listAgents(): AgentInstance[] {
    const registry = loadRegistry();
    return Object.values(registry.agents);
}

/**
 * Calculate human-readable uptime
 */
function formatUptime(startedAt: string): string {
    const start = new Date(startedAt).getTime();
    const now = Date.now();
    const diffMs = now - start;

    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
}

/**
 * Get summaries of all agents for display
 */
export function getAgentSummaries(): AgentSummary[] {
    const agents = listAgents();

    return agents.map((agent) => ({
        id: agent.id,
        issueNumber: agent.issueNumber,
        issueTitle: agent.issueTitle,
        status: agent.status,
        port: agent.port,
        branch: agent.branch,
        uptime: formatUptime(agent.startedAt),
        currentAction: agent.currentAction,
        waitingForInput: agent.waitingForInput,
    }));
}

/**
 * Clean up stale agents (process no longer running)
 *
 * TODO: This is a placeholder for the stale detection logic.
 * The actual implementation depends on how we want to handle this:
 * - Check if PID exists?
 * - Use heartbeat mechanism?
 * - Trust explicit unregister only?
 */
export function cleanupStaleAgents(): number {
    // Placeholder - will be implemented based on chosen strategy
    // See comment in function for design decision needed
    return 0;
}
