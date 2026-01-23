/**
 * Session Watcher
 *
 * Monitors Claude's .jsonl session files to provide real-time status updates
 * for agents in the registry.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Parsed event from a Claude session file
 */
export interface SessionEvent {
    type: 'tool_start' | 'tool_end' | 'text' | 'thinking' | 'error' | 'user_input';
    timestamp: Date;
    /** Tool name if type is tool_start/tool_end */
    toolName?: string;
    /** Tool input/description if available */
    toolInput?: Record<string, unknown>;
    /** Text content if type is text */
    text?: string;
    /** Whether the tool was interrupted/rejected */
    interrupted?: boolean;
    /** Error message if any */
    error?: string;
}

/**
 * Current status derived from session events
 */
export interface AgentSessionStatus {
    /** What the agent is currently doing */
    currentAction?: string;
    /** Tool currently being executed */
    currentTool?: string;
    /** Whether waiting for user input/permission */
    waitingForInput: boolean;
    /** Last activity timestamp */
    lastActivity: Date;
    /** Recent events (for context) */
    recentEvents: SessionEvent[];
}

/**
 * Convert a worktree path to Claude's project directory name format.
 * Claude encodes paths like /home/user/project as -home-user-project
 * Also removes dots from hidden directory names (-.ghp- -> --ghp-)
 */
function pathToClaudeProjectName(dirPath: string): string {
    return dirPath
        .replace(/\//g, '-')     // Replace slashes with dashes
        .replace(/-\./g, '--');  // Remove dots after dashes (hidden dirs: -.ghp -> --ghp)
}

/**
 * Find the active session file for a worktree
 */
export async function findSessionFile(worktreePath: string): Promise<string | null> {
    const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
    const projectName = pathToClaudeProjectName(worktreePath);
    const projectDir = path.join(claudeProjectsDir, projectName);

    try {
        const files = await fs.promises.readdir(projectDir);
        const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

        if (jsonlFiles.length === 0) return null;

        // Find the most recently modified session file
        let mostRecent: { file: string; mtime: number } | null = null;
        for (const file of jsonlFiles) {
            const filePath = path.join(projectDir, file);
            const stat = await fs.promises.stat(filePath);
            if (!mostRecent || stat.mtimeMs > mostRecent.mtime) {
                mostRecent = { file: filePath, mtime: stat.mtimeMs };
            }
        }

        return mostRecent?.file || null;
    } catch {
        return null;
    }
}

/**
 * Parse a single line from a Claude session file
 */
export function parseSessionLine(line: string): SessionEvent | null {
    try {
        const entry = JSON.parse(line);
        const timestamp = new Date(entry.timestamp || Date.now());

        // Handle new "progress" wrapper format (Claude 2.1+)
        if (entry.type === 'progress' && entry.data?.message) {
            const innerMessage = entry.data.message;
            const messageType = innerMessage.type;
            const messageContent = innerMessage.message?.content;

            // Handle assistant messages with tool_use
            if (messageType === 'assistant' && messageContent) {
                for (const block of messageContent) {
                    if (block.type === 'tool_use') {
                        return {
                            type: 'tool_start',
                            timestamp,
                            toolName: block.name,
                            toolInput: block.input,
                        };
                    }
                    if (block.type === 'text' && block.text) {
                        return {
                            type: 'text',
                            timestamp,
                            text: block.text,
                        };
                    }
                    if (block.type === 'thinking') {
                        return {
                            type: 'thinking',
                            timestamp,
                            text: block.thinking,
                        };
                    }
                }
            }

            // Handle user messages (tool results)
            if (messageType === 'user' && messageContent) {
                for (const block of messageContent) {
                    if (block.type === 'tool_result') {
                        // Check for rejection
                        if (typeof block.content === 'string' && block.content.includes('rejected')) {
                            return {
                                type: 'user_input',
                                timestamp,
                                interrupted: true,
                            };
                        }
                        // Normal tool result = tool_end
                        return {
                            type: 'tool_end',
                            timestamp,
                            interrupted: false,
                        };
                    }
                }
            }
        }

        // Handle legacy direct format (Claude 2.0 and earlier)
        if (entry.type === 'assistant' && entry.message?.content) {
            for (const block of entry.message.content) {
                if (block.type === 'tool_use') {
                    return {
                        type: 'tool_start',
                        timestamp,
                        toolName: block.name,
                        toolInput: block.input,
                    };
                }
                if (block.type === 'text' && block.text) {
                    return {
                        type: 'text',
                        timestamp,
                        text: block.text,
                    };
                }
                if (block.type === 'thinking') {
                    return {
                        type: 'thinking',
                        timestamp,
                        text: block.thinking,
                    };
                }
            }
        }

        // Handle tool results (legacy)
        if (entry.type === 'user' && entry.toolUseResult !== undefined) {
            return {
                type: 'tool_end',
                timestamp,
                interrupted: entry.toolUseResult?.interrupted === true,
                error: entry.toolUseResult?.is_error ? 'Tool execution failed' : undefined,
            };
        }

        // Handle user messages (potential permission requests, legacy)
        if (entry.type === 'user' && entry.message?.content) {
            const content = entry.message.content;
            // Check if this is a tool rejection
            for (const block of content) {
                if (block.type === 'tool_result' && block.content?.includes?.('rejected')) {
                    return {
                        type: 'user_input',
                        timestamp,
                        interrupted: true,
                    };
                }
            }
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Format a tool name and input into a human-readable action string
 */
export function formatAction(toolName: string, toolInput?: Record<string, unknown>): string {
    switch (toolName) {
        case 'Read':
            return `Reading ${toolInput?.file_path || 'file'}`;
        case 'Write':
            return `Writing ${toolInput?.file_path || 'file'}`;
        case 'Edit':
            return `Editing ${toolInput?.file_path || 'file'}`;
        case 'Bash':
            const cmd = toolInput?.command as string;
            if (cmd) {
                // Truncate long commands
                const shortCmd = cmd.length > 40 ? cmd.substring(0, 37) + '...' : cmd;
                return `Running: ${shortCmd}`;
            }
            return 'Running command';
        case 'Grep':
            return `Searching for "${toolInput?.pattern || 'pattern'}"`;
        case 'Glob':
            return `Finding files: ${toolInput?.pattern || 'pattern'}`;
        case 'WebFetch':
            return `Fetching ${toolInput?.url || 'URL'}`;
        case 'WebSearch':
            return `Searching: ${toolInput?.query || 'query'}`;
        case 'Task':
            return `Spawning agent: ${toolInput?.description || 'task'}`;
        default:
            return `Using ${toolName}`;
    }
}

/**
 * Permission prompt info extracted from tmux pane
 */
export interface PermissionPrompt {
    /** The tool requesting permission */
    toolName: string;
    /** Brief description of what it wants to do */
    description?: string;
}

/**
 * Check a tmux pane for Claude permission prompts
 */
export async function checkTmuxForPermission(windowName: string): Promise<PermissionPrompt | null> {
    try {
        // Validate window name to prevent command injection
        // Only allow alphanumeric, dashes, and underscores
        if (!/^[a-zA-Z0-9_-]+$/.test(windowName)) {
            return null;
        }

        // Use -S -50 to get more scrollback in case prompt is higher up
        const { stdout } = await execAsync(`tmux capture-pane -t "${windowName}" -p -S -50 2>/dev/null`);

        // Look for permission prompt pattern
        if (!stdout.includes('Do you want to proceed?')) {
            return null;
        }

        let toolName = 'Unknown tool';
        let description: string | undefined;

        // Try different prompt formats:

        // 1. MCP Tool format: "Tool use\n\n   toolName(args) (MCP)"
        const mcpMatch = stdout.match(/Tool use\s*\n\s*\n\s*([^\n(]+)\(/);
        if (mcpMatch) {
            toolName = mcpMatch[1].trim().replace(/\s*\(MCP\)\s*$/, '');
            const argsMatch = stdout.match(/Tool use\s*\n\s*\n\s*[^\n(]+\(([^)]*)\)/);
            description = argsMatch ? argsMatch[1].substring(0, 40) : undefined;
        }

        // 2. Bash command format: "Bash command\n\n   command here"
        if (toolName === 'Unknown tool') {
            const bashMatch = stdout.match(/Bash command[^\n]*\n\s*\n\s*([^\n]+)/);
            if (bashMatch) {
                toolName = 'Bash';
                description = bashMatch[1].trim().substring(0, 40);
            }
        }

        // 3. Simple tool format: "● ToolName(args)"
        if (toolName === 'Unknown tool') {
            const simpleMatch = stdout.match(/●\s*([A-Za-z]+)\s*\(/);
            if (simpleMatch) {
                toolName = simpleMatch[1];
            }
        }

        return { toolName, description };
    } catch {
        // tmux not available or window doesn't exist
        return null;
    }
}

/**
 * Session Watcher - monitors a Claude session file for events
 */
export class SessionWatcher extends EventEmitter {
    private filePath: string;
    private watcher: fs.FSWatcher | null = null;
    private position: number = 0;
    private status: AgentSessionStatus;
    private isWatching: boolean = false;
    private isReading: boolean = false;
    private tmuxWindow: string | null = null;
    private tmuxPollInterval: NodeJS.Timeout | null = null;

    constructor(sessionFilePath: string, tmuxWindowName?: string) {
        super();
        this.filePath = sessionFilePath;
        this.tmuxWindow = tmuxWindowName || null;
        this.status = {
            waitingForInput: false,
            lastActivity: new Date(),
            recentEvents: [],
        };
    }

    /**
     * Get current status
     */
    getStatus(): AgentSessionStatus {
        return {
            ...this.status,
            recentEvents: [...this.status.recentEvents],
        };
    }

    /**
     * Start watching the session file
     */
    async start(): Promise<void> {
        if (this.isWatching) return;

        try {
            // Open file and seek to end (we only want new events)
            const stat = await fs.promises.stat(this.filePath);
            this.position = stat.size;

            // Set up file watcher
            this.watcher = fs.watch(this.filePath, async (eventType) => {
                if (eventType === 'change') {
                    await this.readNewLines();
                }
            });

            // Start tmux polling if window name provided
            if (this.tmuxWindow) {
                this.startTmuxPolling();
            }

            this.isWatching = true;
            this.emit('started');
        } catch (error) {
            this.emit('error', error);
        }
    }

    /**
     * Stop watching
     */
    stop(): void {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        if (this.tmuxPollInterval) {
            clearInterval(this.tmuxPollInterval);
            this.tmuxPollInterval = null;
        }
        this.isWatching = false;
        this.emit('stopped');
    }

    /**
     * Start polling tmux for permission prompts
     */
    private startTmuxPolling(): void {
        // Poll every 2 seconds
        this.tmuxPollInterval = setInterval(async () => {
            if (!this.tmuxWindow) return;

            const prompt = await checkTmuxForPermission(this.tmuxWindow);

            if (prompt && !this.status.waitingForInput) {
                // Detected a permission prompt
                this.status.waitingForInput = true;
                this.status.currentAction = `Waiting: ${prompt.toolName}`;
                this.status.currentTool = prompt.toolName;
                this.emit('permission', prompt);
                this.emit('status', this.getStatus());
            } else if (!prompt && this.status.waitingForInput) {
                // Permission prompt cleared (user responded)
                this.status.waitingForInput = false;
                // Keep last action until new one comes in
                this.emit('status', this.getStatus());
            }
        }, 2000);
    }

    /**
     * Read new lines from the file
     */
    private async readNewLines(): Promise<void> {
        // Prevent concurrent reads (race condition from rapid fs.watch triggers)
        if (this.isReading) return;
        this.isReading = true;

        try {
            const handle = await fs.promises.open(this.filePath, 'r');
            const stat = await handle.stat();

            if (stat.size <= this.position) {
                await handle.close();
                return;
            }

            // Read new content
            const buffer = Buffer.alloc(stat.size - this.position);
            await handle.read(buffer, 0, buffer.length, this.position);
            await handle.close();

            this.position = stat.size;

            // Parse lines
            const content = buffer.toString('utf-8');
            const lines = content.split('\n').filter(l => l.trim());

            for (const line of lines) {
                const event = parseSessionLine(line);
                if (event) {
                    this.processEvent(event);
                }
            }
        } catch (error) {
            this.emit('error', error);
        } finally {
            this.isReading = false;
        }
    }

    /**
     * Process a parsed event and update status
     */
    private processEvent(event: SessionEvent): void {
        this.status.lastActivity = event.timestamp;

        // Keep last 10 events for context
        this.status.recentEvents.push(event);
        if (this.status.recentEvents.length > 10) {
            this.status.recentEvents.shift();
        }

        switch (event.type) {
            case 'tool_start':
                this.status.currentTool = event.toolName;
                this.status.currentAction = formatAction(event.toolName!, event.toolInput);
                this.status.waitingForInput = false;
                break;

            case 'tool_end':
                if (event.interrupted) {
                    this.status.waitingForInput = true;
                    this.status.currentAction = 'Waiting for approval';
                } else {
                    this.status.currentTool = undefined;
                    this.status.currentAction = undefined;
                }
                break;

            case 'user_input':
                if (event.interrupted) {
                    this.status.waitingForInput = true;
                    this.status.currentAction = 'Action rejected';
                }
                break;

            case 'text':
                // Could show last message, but might be noisy
                break;
        }

        this.emit('event', event);
        this.emit('status', this.getStatus());
    }
}

/**
 * Create a watcher for an agent's session
 * @param worktreePath Path to the agent's worktree
 * @param tmuxWindowName Optional tmux window name for permission detection
 */
export async function createSessionWatcher(
    worktreePath: string,
    tmuxWindowName?: string
): Promise<SessionWatcher | null> {
    const sessionFile = await findSessionFile(worktreePath);
    if (!sessionFile) return null;
    return new SessionWatcher(sessionFile, tmuxWindowName);
}
