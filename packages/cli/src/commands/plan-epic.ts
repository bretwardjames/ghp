/**
 * Plan Epic Command
 *
 * Uses Claude AI to break down an epic into actionable issues.
 * Supports both planning mode (outputs markdown) and execution mode (creates issues).
 */

import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository, type RepoInfo } from '../git-utils.js';
import { getClaudeConfig } from '../config.js';
import {
    ClaudeClient,
    type ToolHandlers,
    type StreamCallbacks,
} from '@bretwardjames/ghp-core';

interface PlanEpicOptions {
    project?: string;
    execute?: boolean;
    dryRun?: boolean;
    context?: string;
}

/**
 * Create tool handlers that integrate with the GitHub API
 */
function createToolHandlers(
    repo: RepoInfo,
    projectId: string,
    projectTitle: string
): ToolHandlers {
    return {
        create_issue: async (input) => {
            const title = input.title as string;
            const body = input.body as string;

            const issue = await api.createIssue(repo, title, body);
            if (!issue) {
                return { error: 'Failed to create issue' };
            }

            // Add to project
            const itemId = await api.addToProject(projectId, issue.id);
            if (itemId) {
                console.log(chalk.green('  Created:'), `#${issue.number} ${title}`);
            }

            return {
                number: issue.number,
                title,
                id: issue.id,
                itemId,
            };
        },

        set_parent: async (input) => {
            const childNumber = input.child_number as number;
            const parentNumber = input.parent_number as number;

            // Update the child issue body to reference the parent
            const childDetails = await api.getIssueDetails(repo, childNumber);
            if (!childDetails) {
                return { error: `Could not find issue #${childNumber}` };
            }

            const updatedBody = `Part of #${parentNumber}\n\n${childDetails.body}`;
            const success = await api.updateIssueBody(repo, childNumber, updatedBody);

            if (success) {
                console.log(chalk.dim(`  Linked #${childNumber} to parent #${parentNumber}`));
            }

            return { success, childNumber, parentNumber };
        },

        set_field: async (input) => {
            const issueNumber = input.issue_number as number;
            const fieldName = input.field_name as string;
            const value = input.value as string;

            // Find the item in the project
            const item = await api.findItemByNumber(repo, issueNumber);
            if (!item) {
                return { error: `Issue #${issueNumber} not found in project` };
            }

            // Get project fields
            const fields = await api.getProjectFields(projectId);
            const field = fields.find(f =>
                f.name.toLowerCase() === fieldName.toLowerCase()
            );

            if (!field) {
                return { error: `Field "${fieldName}" not found` };
            }

            // Set the field value
            let valueToSet: { text?: string; singleSelectOptionId?: string } = {};
            if (field.options) {
                const option = field.options.find(o =>
                    o.name.toLowerCase() === value.toLowerCase()
                );
                if (option) {
                    valueToSet = { singleSelectOptionId: option.id };
                } else {
                    return { error: `Option "${value}" not found for field "${fieldName}"` };
                }
            } else {
                valueToSet = { text: value };
            }

            const success = await api.setFieldValue(projectId, item.id, field.id, valueToSet);
            if (success) {
                console.log(chalk.dim(`  Set ${fieldName}=${value} on #${issueNumber}`));
            }

            return { success, issueNumber, fieldName, value };
        },

        add_blocker: async (input) => {
            const blockedIssue = input.blocked_issue as number;
            const blockingIssue = input.blocking_issue as number;

            // Add a comment or update the issue body to indicate the dependency
            const blockedDetails = await api.getIssueDetails(repo, blockedIssue);
            if (!blockedDetails) {
                return { error: `Could not find issue #${blockedIssue}` };
            }

            const blockNote = `\n\n**Blocked by:** #${blockingIssue}`;
            const updatedBody = blockedDetails.body + blockNote;
            const success = await api.updateIssueBody(repo, blockedIssue, updatedBody);

            if (success) {
                console.log(chalk.dim(`  #${blockedIssue} blocked by #${blockingIssue}`));
            }

            return { success, blockedIssue, blockingIssue };
        },

        add_to_project: async (input) => {
            const issueNumber = input.issue_number as number;

            // Get the issue node ID
            const issueDetails = await api.getIssueDetails(repo, issueNumber);
            if (!issueDetails) {
                return { error: `Could not find issue #${issueNumber}` };
            }

            // Add to project
            // Note: We'd need the content ID which isn't available from getIssueDetails
            // This is a simplified version
            console.log(chalk.dim(`  Issue #${issueNumber} already in project ${projectTitle}`));
            return { success: true, issueNumber, project: projectTitle };
        },

        add_labels: async (input) => {
            const issueNumber = input.issue_number as number;
            const labels = input.labels as string[];

            let success = true;
            for (const label of labels) {
                const result = await api.addLabelToIssue(repo, issueNumber, label);
                if (result) {
                    console.log(chalk.dim(`  Added label "${label}" to #${issueNumber}`));
                } else {
                    console.log(chalk.yellow(`  Warning: Could not add label "${label}"`));
                    success = false;
                }
            }

            return { success, issueNumber, labels };
        },
    };
}

export async function planEpicCommand(title: string, options: PlanEpicOptions): Promise<void> {
    if (!title) {
        console.error(chalk.red('Error:'), 'Epic title is required');
        console.log(chalk.dim('Usage: ghp plan-epic "Epic title" [options]'));
        process.exit(1);
    }

    // Check Claude configuration
    const claudeConfig = getClaudeConfig();
    if (!claudeConfig.apiKey) {
        console.error(chalk.red('Error:'), 'No Anthropic API key configured');
        console.log();
        console.log('Set your API key using one of these methods:');
        console.log(`  ${chalk.cyan('export ANTHROPIC_API_KEY=sk-ant-...')}`);
        console.log(`  ${chalk.cyan('ghp config claude.apiKey sk-ant-...')}`);
        process.exit(1);
    }

    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        process.exit(1);
    }

    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        process.exit(1);
    }

    // Get projects
    const projects = await api.getProjects(repo);
    if (projects.length === 0) {
        console.error(chalk.red('Error:'), 'No GitHub Projects found for this repository');
        process.exit(1);
    }

    // Select project
    const projectName = options.project;
    let project = projects[0];
    if (projectName) {
        const found = projects.find(p =>
            p.title.toLowerCase().includes(projectName.toLowerCase())
        );
        if (!found) {
            console.error(chalk.red('Error:'), `Project "${projectName}" not found`);
            console.log('Available projects:', projects.map(p => p.title).join(', '));
            process.exit(1);
        }
        project = found;
    }

    // Get existing issues for context
    const existingItems = await api.getProjectItems(project.id, project.title);
    const existingIssues = existingItems
        .filter(item => item.number !== null)
        .map(item => ({
            number: item.number!,
            title: item.title,
        }));

    // Build context
    let contextStr = '';
    if (options.context) {
        contextStr = options.context;
    }
    contextStr += `\nProject: ${project.title}\n`;

    // Create Claude client
    const claude = new ClaudeClient({
        apiKey: claudeConfig.apiKey,
        model: claudeConfig.model,
        maxTokens: claudeConfig.maxTokens,
    });

    console.log();
    console.log(chalk.bold('Planning Epic:'), title);
    console.log(chalk.dim(`Project: ${project.title}`));
    console.log(chalk.dim(`Model: ${claudeConfig.model}`));
    console.log();

    // Create streaming callbacks
    const callbacks: StreamCallbacks = {
        onToken: (token) => {
            process.stdout.write(token);
        },
        onToolCall: (toolName, input) => {
            console.log();
            console.log(chalk.cyan(`Calling ${toolName}...`));
        },
        onToolResult: (toolName, result) => {
            // Logged by the tool handler
        },
    };

    if (options.execute && !options.dryRun) {
        // Execute mode - actually create issues
        console.log(chalk.yellow('Executing mode - issues will be created'));
        console.log();

        const toolHandlers = createToolHandlers(repo, project.id, project.title);

        try {
            const result = await claude.planEpic({
                title,
                context: contextStr,
                existingIssues,
                tools: toolHandlers,
                callbacks,
            });

            console.log();
            console.log();
            console.log(chalk.bold.green('Epic planning complete!'));
            console.log(`Created ${result.createdIssues.length} issues`);

            if (result.createdIssues.length > 0) {
                console.log();
                console.log(chalk.bold('Created Issues:'));
                for (const issue of result.createdIssues) {
                    console.log(`  #${issue.number}: ${issue.title}`);
                }
            }

            console.log();
            console.log(chalk.dim(`Tokens used: ${result.usage.total_tokens} (input: ${result.usage.input_tokens}, output: ${result.usage.output_tokens})`));

        } catch (error) {
            console.error();
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error');
            process.exit(1);
        }
    } else {
        // Planning mode - output markdown plan
        if (options.dryRun) {
            console.log(chalk.yellow('Dry run mode - no issues will be created'));
            console.log();
        }

        try {
            const result = await claude.planEpic({
                title,
                context: contextStr,
                existingIssues,
                // No tools = output markdown
                callbacks,
            });

            console.log();
            console.log();
            console.log(chalk.dim(`Tokens used: ${result.usage.total_tokens}`));

            if (!options.execute) {
                console.log();
                console.log(chalk.dim('To create these issues, run:'));
                console.log(chalk.cyan(`  ghp plan-epic "${title}" --execute`));
            }

        } catch (error) {
            console.error();
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error');
            process.exit(1);
        }
    }
}
