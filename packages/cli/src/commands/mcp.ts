import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir, platform } from 'os';
import { join, dirname } from 'path';
import { getMcpConfig as getGhpMcpConfig } from '../config.js';
import { getToolStatus, type ToolCategory } from '@bretwardjames/ghp-mcp/tool-registry';

interface McpOptions {
    config?: boolean;
    install?: boolean;
    status?: boolean;
}

/**
 * Get the Claude Desktop config file path for the current OS.
 */
function getClaudeConfigPath(): string | null {
    const home = homedir();
    const os = platform();

    switch (os) {
        case 'darwin':
            return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
        case 'win32':
            return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
        case 'linux':
            return join(home, '.config', 'Claude', 'claude_desktop_config.json');
        default:
            return null;
    }
}

/**
 * Generate the MCP server config for ghp.
 */
function getMcpConfig(): object {
    return {
        mcpServers: {
            ghp: {
                command: 'ghp-mcp',
            },
        },
    };
}

export async function mcpCommand(options: McpOptions): Promise<void> {
    // Default to showing config if no option specified
    if (!options.config && !options.install && !options.status) {
        options.config = true;
    }

    if (options.status) {
        const mcpConfig = getGhpMcpConfig();
        const toolStatuses = getToolStatus(mcpConfig);

        console.log(chalk.bold('MCP Tool Status'));
        console.log();

        // Show category status
        console.log(chalk.bold('Categories:'));
        const categories: ToolCategory[] = ['read', 'action'];
        for (const cat of categories) {
            const enabled = mcpConfig.tools?.[cat] !== false;
            const status = enabled
                ? chalk.green('enabled')
                : chalk.red('disabled');
            console.log(`  ${cat}: ${status}`);
        }
        console.log();

        // Show individual tool status
        console.log(chalk.bold('Tools:'));
        for (const tool of toolStatuses) {
            const statusIcon = tool.enabled ? chalk.green('✓') : chalk.red('✗');
            const categoryTag = chalk.dim(`[${tool.category}]`);

            let line = `  ${statusIcon} ${tool.displayName} ${categoryTag}`;

            if (!tool.enabled && tool.disabledReason) {
                const reason = tool.disabledReason === 'category'
                    ? chalk.dim('(category disabled)')
                    : chalk.dim('(explicitly disabled)');
                line += ` ${reason}`;
            }

            console.log(line);
        }

        // Show disabled tools config
        if (mcpConfig.disabledTools && mcpConfig.disabledTools.length > 0) {
            console.log();
            console.log(chalk.bold('Explicitly disabled tools:'));
            for (const name of mcpConfig.disabledTools) {
                console.log(`  - ${name}`);
            }
        }

        console.log();
        console.log(chalk.dim('Configure via ghp config or edit ~/.config/ghp-cli/config.json'));
        return;
    }

    if (options.config) {
        console.log(chalk.bold('Claude Desktop MCP Configuration'));
        console.log();
        console.log('Add this to your Claude Desktop config file:');
        console.log();
        console.log(chalk.cyan(JSON.stringify(getMcpConfig(), null, 2)));
        console.log();

        const configPath = getClaudeConfigPath();
        if (configPath) {
            console.log(chalk.dim(`Config location: ${configPath}`));
        }
        console.log();
        console.log(chalk.dim('Or run'), chalk.cyan('ghp mcp --install'), chalk.dim('to configure automatically.'));
        return;
    }

    if (options.install) {
        const configPath = getClaudeConfigPath();

        if (!configPath) {
            console.error(chalk.red('Error:'), 'Unsupported operating system');
            console.log('Please manually add the config shown by', chalk.cyan('ghp mcp --config'));
            process.exit(1);
        }

        console.log(chalk.dim(`Config path: ${configPath}`));

        // Read existing config or create empty one
        let config: Record<string, unknown> = {};

        if (existsSync(configPath)) {
            try {
                const content = readFileSync(configPath, 'utf-8');
                config = JSON.parse(content);
                console.log(chalk.dim('Found existing config'));
            } catch (err) {
                console.error(chalk.red('Error:'), 'Failed to parse existing config file');
                console.log('Please manually add the config shown by', chalk.cyan('ghp mcp --config'));
                process.exit(1);
            }
        } else {
            console.log(chalk.dim('Creating new config file'));
        }

        // Ensure mcpServers exists
        if (!config.mcpServers || typeof config.mcpServers !== 'object') {
            config.mcpServers = {};
        }

        // Check if ghp is already configured
        const mcpServers = config.mcpServers as Record<string, unknown>;
        if (mcpServers.ghp) {
            console.log(chalk.yellow('ghp MCP server is already configured'));
            console.log('Current config:', JSON.stringify(mcpServers.ghp, null, 2));
            console.log();
            console.log('To reconfigure, remove the "ghp" entry from your config and run this again.');
            return;
        }

        // Add ghp config
        mcpServers.ghp = {
            command: 'ghp-mcp',
        };

        // Write config
        try {
            // Ensure directory exists
            const dir = dirname(configPath);
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true });
            }

            writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
            console.log(chalk.green('✓'), 'Configured ghp MCP server for Claude Desktop');
            console.log();
            console.log(chalk.bold('Next steps:'));
            console.log('  1. Make sure ghp-mcp is installed globally:');
            console.log('     ', chalk.cyan('npm install -g @bretwardjames/ghp-mcp'));
            console.log('  2. Restart Claude Desktop to load the new configuration');
        } catch (err) {
            console.error(chalk.red('Error:'), 'Failed to write config file');
            console.error(err instanceof Error ? err.message : String(err));
            console.log();
            console.log('Please manually add the config shown by', chalk.cyan('ghp mcp --config'));
            process.exit(1);
        }
    }
}
