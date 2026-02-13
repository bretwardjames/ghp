import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';
import { getAddIssueDefaults, getClaudeConfig, getHooksConfig } from '../config.js';
import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promptSelectWithDefault, isInteractive } from '../prompts.js';
import { generateWithClaude } from '../claude-runner.js';
import { runFeedbackLoop } from '../ai-feedback.js';
import {
    ClaudeClient,
    claudePrompts,
    executeHooksForEvent,
    hasHooksForEvent,
    type IssueCreatedPayload,
} from '@bretwardjames/ghp-core';
import { exit } from '../exit.js';

const execAsync = promisify(exec);

interface AddIssueOptions {
    body?: string;
    project?: string;
    status?: string;
    edit?: boolean;
    template?: string | false;  // --no-template sets this to false
    listTemplates?: boolean;
    /** Use default values for all prompts (non-interactive mode) */
    forceDefaults?: boolean;
    /** Use AI to expand brief description into full issue */
    ai?: boolean;
    /** Parent issue number to link as sub-issue */
    parent?: string;
    /** Labels to apply (comma-separated) */
    labels?: string;
    /** Users to assign (comma-separated, empty for self) */
    assign?: string;
    /** Project fields to set (field=value format, can be multiple) */
    field?: string[];
    /** Shortcut for --field Priority=... */
    priority?: string;
    /** Shortcut for --field Size=... */
    size?: string;
    /** Read issue body from a file */
    bodyFile?: string;
    /** Read issue body from stdin */
    bodyStdin?: boolean;
    /** Object type being created: 'issue' (default) or 'epic' */
    objectType?: 'issue' | 'epic';
    /** Execute AI plan (create sub-issues) - for epic with --ai */
    execute?: boolean;
    /** Additional context for AI planning - for epic with --ai */
    context?: string;
    /** Dry run mode - show what would be created without creating */
    dryRun?: boolean;
}

async function openEditor(initialContent: string): Promise<string> {
    const editor = process.env.EDITOR || process.env.VISUAL || 'vim';
    const tmpFile = join(tmpdir(), `ghp-issue-${Date.now()}.md`);

    writeFileSync(tmpFile, initialContent);

    return new Promise((resolve, reject) => {
        const child = spawn(editor, [tmpFile], {
            stdio: 'inherit',
        });

        child.on('exit', (code) => {
            if (code !== 0) {
                if (existsSync(tmpFile)) unlinkSync(tmpFile);
                reject(new Error(`Editor exited with code ${code}`));
                return;
            }

            try {
                const content = readFileSync(tmpFile, 'utf-8');
                unlinkSync(tmpFile);
                resolve(content);
            } catch (err) {
                reject(err);
            }
        });
    });
}

function getTemplates(): Array<{ name: string; filename: string; content: string }> {
    const templateDir = join(process.cwd(), '.github', 'ISSUE_TEMPLATE');
    const templates: Array<{ name: string; filename: string; content: string }> = [];

    try {
        if (!existsSync(templateDir)) return templates;
        const files = readdirSync(templateDir);

        for (const file of files) {
            if (file === 'config.yml' || file === 'config.yaml') continue;
            if (!file.endsWith('.md') && !file.endsWith('.yml') && !file.endsWith('.yaml')) continue;

            const content = readFileSync(join(templateDir, file), 'utf-8');

            // Parse name from frontmatter
            const nameMatch = content.match(/^name:\s*["']?(.+?)["']?\s*$/m);
            const name = nameMatch ? nameMatch[1] : file.replace(/\.(md|ya?ml)$/, '');

            // Remove frontmatter for body
            const bodyContent = content.replace(/^---[\s\S]*?---\n?/, '');

            templates.push({ name, filename: file, content: bodyContent });
        }
    } catch {
        // No templates directory or error reading
    }

    return templates;
}

export async function addIssueCommand(title: string, options: AddIssueOptions): Promise<void> {
    // Handle --list-templates
    if (options.listTemplates) {
        const templates = getTemplates();
        if (templates.length === 0) {
            console.log(chalk.dim('No templates found in .github/ISSUE_TEMPLATE/'));
        } else {
            console.log(chalk.bold('Available templates:'));
            for (const t of templates) {
                const preview = t.content.trim().split('\n')[0].substring(0, 50);
                console.log(`  ${chalk.cyan(t.name)} ${chalk.dim(`(${t.filename})`)}`);
                if (preview) console.log(`    ${chalk.dim(preview)}...`);
            }
        }
        return;
    }

    // Merge named field flags into the generic --field array
    const fieldSpecs: string[] = options.field || [];
    if (options.priority) {
        fieldSpecs.push(`Priority=${options.priority}`);
    }
    if (options.size) {
        fieldSpecs.push(`Size=${options.size}`);
    }
    options.field = fieldSpecs;

    // Check for conflicting body sources
    const bodySources = [
        options.body ? '--body' : null,
        options.bodyFile ? '--body-file' : null,
        options.bodyStdin ? '--body-stdin' : null,
    ].filter(Boolean);
    if (bodySources.length > 1) {
        console.error(chalk.red('Error:'), `Cannot use ${bodySources.join(' and ')} together`);
        exit(1);
        return;
    }

    // Handle --body-file: read body from file
    if (options.bodyFile) {
        try {
            options.body = readFileSync(options.bodyFile, 'utf-8');
        } catch (err) {
            console.error(chalk.red('Error:'), `Could not read body file: ${(err as Error).message}`);
            exit(1);
            return;
        }
    }

    // Handle --body-stdin: read body from stdin
    if (options.bodyStdin) {
        if (process.stdin.isTTY) {
            console.error(chalk.red('Error:'), '--body-stdin requires piped input (e.g., echo "body" | ghp add issue "Title" --body-stdin)');
            exit(1);
            return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
            chunks.push(chunk);
        }
        options.body = Buffer.concat(chunks).toString('utf-8').trim();
        if (!options.body) {
            console.error(chalk.red('Error:'), 'No input received from stdin');
            exit(1);
            return;
        }
    }

    const repo = await detectRepository();
    if (!repo) {
        console.error(chalk.red('Error:'), 'Not in a git repository with a GitHub remote');
        exit(1);
    }

    const authenticated = await api.authenticate();
    if (!authenticated) {
        console.error(chalk.red('Error:'), 'Not authenticated. Run', chalk.cyan('ghp auth'));
        exit(1);
    }

    // Load defaults from config
    const defaults = getAddIssueDefaults();

    // Get projects
    const projects = await api.getProjects(repo);
    if (projects.length === 0) {
        console.error(chalk.red('Error:'), 'No GitHub Projects found for this repository');
        exit(1);
    }

    // Select project (CLI > config default > first project)
    const projectName = options.project || defaults.project;
    let project = projects[0];
    if (projectName) {
        const found = projects.find(p =>
            p.title.toLowerCase().includes(projectName.toLowerCase())
        );
        if (!found) {
            console.error(chalk.red('Error:'), `Project "${projectName}" not found`);
            console.log('Available projects:', projects.map(p => p.title).join(', '));
            exit(1);
        }
        project = found;
    }

    // Epic + AI: delegate to planEpicCommand for full breakdown workflow
    if (options.ai && options.objectType === 'epic') {
        console.log(chalk.dim('Using AI to plan epic breakdown...'));
        try {
            const { planEpicCommand } = await import('./plan-epic.js');
            await planEpicCommand(title, {
                project: options.project,
                execute: options.execute,
                context: options.context,
                dryRun: options.dryRun,
            });
        } catch (error) {
            console.error(chalk.red('Error:'), 'Failed to run epic planning');
            console.error(chalk.dim(error instanceof Error ? error.message : String(error)));
            exit(1);
        }
        return;
    }

    // Handle template and editor
    let body = options.body || '';
    const templates = getTemplates();

    // Determine which template to use (CLI > config default)
    // Note: --no-template sets options.template to false (Commander.js convention)
    let templateName = (options.template !== false && options.template) || defaults.template;

    // If no template specified and templates exist, prompt user to pick one
    // --no-template flag, --body-file, and --body-stdin skip this entirely
    if (!templateName && templates.length > 0 && !options.body && options.template !== false && !options.bodyFile && !options.bodyStdin) {
        // Build options list: templates + blank issue
        const templateOptions = [...templates.map(t => t.name), chalk.dim('Blank issue')];

        // In non-interactive or with --force-defaults, default to blank issue
        const defaultIdx = templates.length; // "Blank issue" is last

        const idx = await promptSelectWithDefault(
            'Select a template:',
            templateOptions,
            defaultIdx, // default: blank issue for non-interactive
            options.forceDefaults ? defaultIdx : undefined // --force-defaults forces blank
        );

        if (idx >= 0 && idx < templates.length) {
            templateName = templates[idx].name;
        }
        console.log();
    }

    let usingTemplate = false;
    if (templateName) {
        const template = templates.find(t =>
            t.filename.toLowerCase().includes(templateName!.toLowerCase()) ||
            t.name.toLowerCase().includes(templateName!.toLowerCase())
        );
        if (template) {
            body = template.content;
            usingTemplate = true;
        } else if (templates.length > 0) {
            console.error(chalk.red('Error:'), `Template "${templateName}" not found`);
            console.log('Available templates:', templates.map(t => t.name).join(', '));
            exit(1);
        } else {
            console.error(chalk.red('Error:'), `Template "${templateName}" not found`);
            console.log(chalk.dim('No templates in .github/ISSUE_TEMPLATE/'));
            exit(1);
        }
    }

    // Track AI-suggested labels
    let aiLabels: string[] | undefined;

    // AI expansion: if --ai flag is set, expand the brief title into a full issue
    if (options.ai && title) {
        console.log(chalk.dim('Expanding issue with AI...'));
        console.log();

        const expanded = await expandIssueWithAI(title, project.title);

        if (expanded) {
            body = expanded.body;
            aiLabels = expanded.labels;
            // Skip template selection since we're using AI
            usingTemplate = false;
        }
    }

    // Open editor if: using template (always), -e flag, or no body provided
    // But only if we're in interactive mode and not using AI (AI has its own feedback loop)
    const shouldOpenEditor = !options.ai && (usingTemplate || options.edit || !options.body);
    if (shouldOpenEditor && isInteractive()) {
        const instructions = [
            `# ${title || '<Replace with issue title>'}`,
            '',
            '<!-- ─────────────────────────────────────────────',
            '     First line (after #) = Issue title',
            '     Everything below = Issue description',
            '     These comment lines will be removed',
            '───────────────────────────────────────────────── -->',
            '',
        ].join('\n');
        try {
            const edited = await openEditor(instructions + body);
            // Extract title from first line if it changed
            const lines = edited.split('\n');
            if (lines[0].startsWith('# ')) {
                title = lines[0].slice(2).trim();
                // Remove comment block and get body
                body = lines.slice(1).join('\n')
                    .replace(/<!--[\s\S]*?-->/g, '') // Remove HTML comments
                    .trim();
            } else {
                body = edited.replace(/<!--[\s\S]*?-->/g, '').trim();
            }
        } catch (err) {
            console.error(chalk.red('Error:'), 'Editor failed:', err);
            exit(1);
        }
    } else if (shouldOpenEditor && !isInteractive()) {
        // Non-interactive mode: skip editor, use template body as-is
        if (options.edit) {
            console.log(chalk.yellow('Warning:'), 'Cannot open editor in non-interactive mode, using body as-is');
        }
        // Clean up template body (remove HTML comments)
        body = body.replace(/<!--[\s\S]*?-->/g, '').trim();
    }

    // Validate title
    if (!title || title === 'Issue Title' || title === '<Replace with issue title>') {
        console.error(chalk.red('Error:'), 'Issue title is required');
        exit(1);
    }

    // Determine status (CLI > config default > interactive picker)
    let statusName = options.status || defaults.status;
    const statusField = await api.getStatusField(project.id);

    if (!statusName && statusField && statusField.options.length > 0) {
        // In non-interactive or with --force-defaults, use first status option as default
        const statusOptions = statusField.options.map(opt => opt.name);

        const idx = await promptSelectWithDefault(
            'Select initial status:',
            statusOptions,
            0, // default: first status for non-interactive
            options.forceDefaults ? 0 : undefined // --force-defaults forces first
        );

        if (idx >= 0 && idx < statusField.options.length) {
            statusName = statusField.options[idx].name;
        }
        console.log();
    }

    console.log(chalk.dim(`Creating issue in ${project.title}...`));

    // Create the issue
    const issue = await api.createIssue(repo, title, body);
    if (!issue) {
        console.error(chalk.red('Error:'), 'Failed to create issue');
        exit(1);
    }

    console.log(chalk.green('Created:'), `#${issue.number} ${title}`);

    // Add to project
    const itemId = await api.addToProject(project.id, issue.id);
    if (!itemId) {
        console.error(chalk.yellow('Warning:'), 'Issue created but failed to add to project');
        return;
    }

    // Summary collector for verbose output
    const summary: { field: string; value: string; status: 'success' | 'warning' | 'none' }[] = [];

    summary.push({ field: 'Added to', value: project.title, status: 'success' });

    // Track body
    if (body && body.trim().length > 0) {
        summary.push({ field: 'Body', value: `${body.trim().length} chars`, status: 'success' });
    } else {
        summary.push({ field: 'Body', value: '(not set)', status: 'none' });
    }

    // Set initial status
    if (statusName && statusField) {
        const option = statusField.options.find(o =>
            o.name.toLowerCase() === statusName!.toLowerCase()
        );
        if (option) {
            await api.updateItemStatus(project.id, itemId, statusField.fieldId, option.id);
            summary.push({ field: 'Status', value: statusName!, status: 'success' });
        } else {
            summary.push({ field: 'Status', value: `"${statusName}" not found`, status: 'warning' });
        }
    } else {
        summary.push({ field: 'Status', value: '(not set)', status: 'none' });
    }

    // Link to parent issue if specified
    if (options.parent) {
        const parentNumber = parseInt(options.parent, 10);
        if (isNaN(parentNumber)) {
            summary.push({ field: 'Parent', value: `Invalid: ${options.parent}`, status: 'warning' });
        } else {
            const success = await api.addSubIssue(repo, parentNumber, issue.number);
            if (success) {
                summary.push({ field: 'Parent', value: `#${parentNumber}`, status: 'success' });
            } else {
                summary.push({ field: 'Parent', value: `Failed to link #${parentNumber}`, status: 'warning' });
            }
        }
    }

    // Collect labels to apply (CLI + AI-suggested + epic type)
    const labelsToApply: string[] = [];
    if (options.objectType === 'epic') {
        labelsToApply.push('epic');
    }
    if (options.labels) {
        labelsToApply.push(...options.labels.split(',').map(l => l.trim()).filter(Boolean));
    }
    if (aiLabels && aiLabels.length > 0) {
        // Add AI labels that aren't already in the list
        for (const label of aiLabels) {
            if (!labelsToApply.includes(label)) {
                labelsToApply.push(label);
            }
        }
    }

    // Apply labels
    if (labelsToApply.length > 0) {
        const appliedLabels: string[] = [];
        const failedLabels: string[] = [];
        for (const label of labelsToApply) {
            const success = await api.addLabelToIssue(repo, issue.number, label);
            if (success) {
                appliedLabels.push(label);
            } else {
                failedLabels.push(label);
            }
        }
        if (appliedLabels.length > 0 && failedLabels.length === 0) {
            summary.push({ field: 'Labels', value: appliedLabels.join(', '), status: 'success' });
        } else if (appliedLabels.length > 0 && failedLabels.length > 0) {
            summary.push({ field: 'Labels', value: `${appliedLabels.join(', ')} (failed: ${failedLabels.join(', ')})`, status: 'warning' });
        } else {
            summary.push({ field: 'Labels', value: `Failed: ${failedLabels.join(', ')}`, status: 'warning' });
        }
    } else {
        summary.push({ field: 'Labels', value: '(none)', status: 'none' });
    }

    // Assign users if specified
    if (options.assign !== undefined) {
        // --assign with no value gives true, --assign "" gives empty string
        // Both should mean "assign to self"
        const assignees = (typeof options.assign === 'string' && options.assign.length > 0)
            ? options.assign.split(',').map(u => u.trim()).filter(Boolean)
            : [api.username!]; // No value or empty string means assign to self

        if (assignees.length > 0) {
            try {
                const assigneeList = assignees.join(',');
                await execAsync(`gh issue edit ${issue.number} --add-assignee "${assigneeList}"`);
                summary.push({ field: 'Assigned', value: assignees.join(', '), status: 'success' });
            } catch (error: unknown) {
                const err = error as { stderr?: string };
                summary.push({ field: 'Assigned', value: `Failed: ${err.stderr || 'unknown error'}`, status: 'warning' });
            }
        }
    } else {
        summary.push({ field: 'Assigned', value: '(not assigned)', status: 'none' });
    }

    // Set project fields if specified
    if (options.field && options.field.length > 0) {
        const projectFields = await api.getProjectFields(project.id);

        for (const fieldSpec of options.field) {
            const [fieldName, ...valueParts] = fieldSpec.split('=');
            const value = valueParts.join('='); // Handle values with = in them

            if (!fieldName || !value) {
                summary.push({ field: fieldName || fieldSpec, value: `Invalid format (use field=value)`, status: 'warning' });
                continue;
            }

            const field = projectFields.find(f =>
                f.name.toLowerCase() === fieldName.toLowerCase()
            );

            if (!field) {
                summary.push({ field: fieldName, value: `Field not found`, status: 'warning' });
                continue;
            }

            // Build value based on field type
            let fieldValue: { text?: string; number?: number; singleSelectOptionId?: string };

            if (field.type === 'SingleSelect' && field.options) {
                const option = field.options.find(o =>
                    o.name.toLowerCase() === value.toLowerCase()
                );
                if (!option) {
                    summary.push({ field: fieldName, value: `"${value}" not found`, status: 'warning' });
                    continue;
                }
                fieldValue = { singleSelectOptionId: option.id };
            } else if (field.type === 'Number') {
                const num = parseFloat(value);
                if (isNaN(num)) {
                    summary.push({ field: fieldName, value: `Invalid number "${value}"`, status: 'warning' });
                    continue;
                }
                fieldValue = { number: num };
            } else {
                fieldValue = { text: value };
            }

            const success = await api.setFieldValue(project.id, itemId, field.id, fieldValue);
            if (success) {
                summary.push({ field: fieldName, value, status: 'success' });
            } else {
                summary.push({ field: fieldName, value: `Failed to set "${value}"`, status: 'warning' });
            }
        }
    }

    // Print verbose summary
    if (summary.length > 0) {
        const maxFieldLen = Math.max(...summary.map(s => s.field.length));
        for (const entry of summary) {
            const paddedField = entry.field.padEnd(maxFieldLen);
            if (entry.status === 'success') {
                console.log(`  ${paddedField}  ${entry.value} ${chalk.green('✓')}`);
            } else if (entry.status === 'warning') {
                console.log(`  ${paddedField}  ${chalk.yellow(entry.value)} ${chalk.yellow('⚠')}`);
            } else {
                console.log(`  ${paddedField}  ${chalk.dim(entry.value)}`);
            }
        }
    }

    // Fire issue-created event hooks
    if (hasHooksForEvent('issue-created')) {
        console.log();
        console.log(chalk.dim('Running issue-created hooks...'));

        const payload: IssueCreatedPayload = {
            repo: `${repo.owner}/${repo.name}`,
            issue: {
                number: issue.number,
                title,
                body,
                url: `https://github.com/${repo.owner}/${repo.name}/issues/${issue.number}`,
            },
        };

        const hooksConfig = getHooksConfig();
        const results = await executeHooksForEvent('issue-created', payload, {
            onFailure: hooksConfig.onFailure,
        });

        for (const result of results) {
            if (result.success) {
                console.log(chalk.green('✓'), `Hook "${result.hookName}" completed`);
                if (result.output) {
                    console.log(chalk.dim(result.output));
                }
            } else {
                console.log(chalk.yellow('⚠'), `Hook "${result.hookName}" failed`);
                if (result.error) {
                    console.log(chalk.dim(result.error));
                }
            }
        }
    }

    console.log();
    console.log(chalk.dim(`Start working: ${chalk.cyan(`ghp start ${issue.number}`)}`));
}

/**
 * Expand a brief issue description into a full issue using AI
 */
async function expandIssueWithAI(
    brief: string,
    projectName: string
): Promise<{ body: string; labels?: string[] } | null> {
    const systemPrompt = claudePrompts.EXPAND_ISSUE_PROMPT;
    const userPrompt = claudePrompts.buildExpandIssueUserPrompt({
        brief,
        projectContext: `Project: ${projectName}`,
    });

    // Try to generate with Claude (handles auth fallback)
    const initialContent = await generateWithClaude({
        prompt: userPrompt,
        systemPrompt,
        contentType: 'issue description',
    });

    // If null, user chose to write manually - return null to open editor
    if (initialContent === null) {
        return null;
    }

    // Parse the AI response - it might be JSON or markdown
    let expandedBody: string;
    let aiLabels: string[] | undefined;
    try {
        const parsed = JSON.parse(initialContent);
        // If JSON, extract body and labels
        expandedBody = parsed.body || initialContent;
        if (Array.isArray(parsed.labels) && parsed.labels.length > 0) {
            aiLabels = parsed.labels;
        }
    } catch {
        // Not JSON, use as-is
        expandedBody = initialContent;
    }

    // Get Claude config for regeneration
    const claudeConfig = getClaudeConfig();

    // Run feedback loop
    const result = await runFeedbackLoop({
        contentType: 'issue description',
        initialContent: expandedBody,
        regenerate: async (feedback: string) => {
            console.log(chalk.dim('Regenerating...'));

            const feedbackPrompt = `${userPrompt}\n\n## User Feedback\nPlease regenerate taking this feedback into account:\n${feedback}`;

            // Try to regenerate with Claude
            const regenerated = await generateWithClaude({
                prompt: feedbackPrompt,
                systemPrompt,
                contentType: 'issue description',
            });

            if (regenerated) {
                try {
                    const parsed = JSON.parse(regenerated);
                    // Update labels if new ones were suggested
                    if (Array.isArray(parsed.labels) && parsed.labels.length > 0) {
                        aiLabels = parsed.labels;
                    }
                    return parsed.body || regenerated;
                } catch {
                    return regenerated;
                }
            }

            return expandedBody;
        },
    });

    return { body: result.content, labels: aiLabels };
}
