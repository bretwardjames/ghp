import * as vscode from 'vscode';
import type { RepoInfo } from './repo-detector';

/**
 * Status bar item showing current repo and project context
 */
export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.command = 'ghProjects.showQuickPick';
    }

    show(): void {
        this.statusBarItem.show();
    }

    hide(): void {
        this.statusBarItem.hide();
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }

    setLoading(): void {
        this.statusBarItem.text = '$(sync~spin) GitHub Projects';
        this.statusBarItem.tooltip = 'Loading projects...';
    }

    setNoRepo(): void {
        this.statusBarItem.text = '$(project) No repo detected';
        this.statusBarItem.tooltip = 'Open a GitHub repository to see projects';
    }

    setNoProjects(repo: RepoInfo): void {
        this.statusBarItem.text = `$(project) ${repo.fullName}`;
        this.statusBarItem.tooltip = `No projects found for ${repo.fullName}.\n\nThis could mean:\n• No projects are linked to this repository\n• You may need organization access\n• Check if SSO authorization is required`;
    }

    setConnected(repo: RepoInfo, projectCount: number): void {
        this.statusBarItem.text = `$(project) ${projectCount} project${projectCount !== 1 ? 's' : ''}`;
        this.statusBarItem.tooltip = `${repo.fullName}\n${projectCount} project${projectCount !== 1 ? 's' : ''} available`;
    }

    setError(message: string): void {
        this.statusBarItem.text = '$(warning) Projects';
        this.statusBarItem.tooltip = message;
    }
}

/**
 * Show access troubleshooting information
 */
export async function showAccessHelp(): Promise<void> {
    const result = await vscode.window.showInformationMessage(
        'Cannot access GitHub Projects? Common reasons:',
        { modal: false },
        'Organization SSO',
        'Check Permissions',
        'Learn More'
    );

    if (result === 'Organization SSO') {
        vscode.window.showInformationMessage(
            'If your organization uses SSO, you may need to authorize this OAuth token. ' +
            'Visit github.com → Settings → Applications → Authorized OAuth Apps and authorize for your org.',
            'Open GitHub Settings'
        ).then((action) => {
            if (action) {
                vscode.env.openExternal(vscode.Uri.parse('https://github.com/settings/applications'));
            }
        });
    } else if (result === 'Check Permissions') {
        vscode.window.showInformationMessage(
            'You need at least read access to the repository and its linked projects. ' +
            'For organization projects, you must be a member of the organization.'
        );
    } else if (result === 'Learn More') {
        vscode.env.openExternal(
            vscode.Uri.parse('https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects')
        );
    }
}
