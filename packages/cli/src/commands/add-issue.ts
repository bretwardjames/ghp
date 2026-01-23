import chalk from 'chalk';
import { api } from '../github-api.js';
import { detectRepository } from '../git-utils.js';
import { getAddIssueDefaults } from '../config.js';
import { spawn } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promptSelectWithDefault, isInteractive } from '../prompts.js';

interface AddIssueOptions {
    body?: string;
    project?: string;
    status?: string;
    edit?: boolean;
    template?: string;
    listTemplates?: boolean;
    // Non-interactive flags
    noTemplate?: boolean;
    /** Use default values for all prompts (non-interactive mode) */
    forceDefaults?: boolean;
    /** Parent issue number to link as sub-issue */
    parent?: string;
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

    // Load defaults from config
    const defaults = getAddIssueDefaults();

    // Get projects
    const projects = await api.getProjects(repo);
    if (projects.length === 0) {
        console.error(chalk.red('Error:'), 'No GitHub Projects found for this repository');
        process.exit(1);
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
            process.exit(1);
        }
        project = found;
    }

    // Handle template and editor
    let body = options.body || '';
    const templates = getTemplates();

    // Determine which template to use (CLI > config default)
    let templateName = options.template || defaults.template;

    // If no template specified and templates exist, prompt user to pick one
    // --no-template flag skips this entirely
    if (!templateName && templates.length > 0 && !options.body && !options.noTemplate) {
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
            process.exit(1);
        } else {
            console.error(chalk.red('Error:'), `Template "${templateName}" not found`);
            console.log(chalk.dim('No templates in .github/ISSUE_TEMPLATE/'));
            process.exit(1);
        }
    }

    // Open editor if: using template (always), -e flag, or no body provided
    // But only if we're in interactive mode
    const shouldOpenEditor = usingTemplate || options.edit || !options.body;
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
            process.exit(1);
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
        process.exit(1);
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
        process.exit(1);
    }

    console.log(chalk.green('Created:'), `#${issue.number} ${title}`);

    // Add to project
    const itemId = await api.addToProject(project.id, issue.id);
    if (!itemId) {
        console.error(chalk.yellow('Warning:'), 'Issue created but failed to add to project');
        return;
    }

    console.log(chalk.green('Added to:'), project.title);

    // Set initial status
    if (statusName && statusField) {
        const option = statusField.options.find(o =>
            o.name.toLowerCase() === statusName!.toLowerCase()
        );
        if (option) {
            await api.updateItemStatus(project.id, itemId, statusField.fieldId, option.id);
            console.log(chalk.green('Status:'), statusName);
        } else {
            console.log(chalk.yellow('Warning:'), `Status "${statusName}" not found`);
        }
    }

    // Link to parent issue if specified
    if (options.parent) {
        const parentNumber = parseInt(options.parent, 10);
        if (isNaN(parentNumber)) {
            console.log(chalk.yellow('Warning:'), `Invalid parent issue number: ${options.parent}`);
        } else {
            const success = await api.addSubIssue(repo, parentNumber, issue.number);
            if (success) {
                console.log(chalk.green('Parent:'), `#${parentNumber}`);
            } else {
                console.log(chalk.yellow('Warning:'), `Failed to link to parent #${parentNumber}`);
            }
        }
    }

    console.log();
    console.log(chalk.dim(`Start working: ${chalk.cyan(`ghp start ${issue.number}`)}`));
}
