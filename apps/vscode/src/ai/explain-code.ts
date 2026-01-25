/**
 * AI-powered code explanation
 *
 * Uses Claude to explain selected code to the user.
 */

import * as vscode from 'vscode';
import { ClaudeClient } from '@bretwardjames/ghp-core';
import { ApiKeyManager } from './api-key-manager';

const EXPLAIN_CODE_SYSTEM_PROMPT = `You are a helpful programming assistant that explains code clearly and concisely.

When explaining code:
1. Start with a brief high-level summary (1-2 sentences)
2. Explain the key components and their purpose
3. Note any important patterns, idioms, or best practices used
4. Point out potential issues or improvements if relevant
5. Keep explanations accessible but technically accurate

Format your response with markdown for readability. Use code blocks for any code references.`;

/**
 * Execute the explain selected code command
 */
export async function executeExplainCode(apiKeyManager: ApiKeyManager): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor. Open a file and select some code.');
        return;
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
        vscode.window.showWarningMessage('No code selected. Select some code to explain.');
        return;
    }

    const selectedText = editor.document.getText(selection);
    if (!selectedText.trim()) {
        vscode.window.showWarningMessage('Selected text is empty');
        return;
    }

    // Get file context
    const fileName = editor.document.fileName.split('/').pop() || 'file';
    const languageId = editor.document.languageId;
    const startLine = selection.start.line + 1;
    const endLine = selection.end.line + 1;

    // Ensure we have an API key
    const apiKey = await apiKeyManager.ensureApiKey();
    if (!apiKey) {
        return;
    }

    // Create Claude client
    const claude = new ClaudeClient({
        apiKeyProvider: apiKeyManager,
    });

    // Generate explanation with progress
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Analyzing code...',
            cancellable: false,
        },
        async () => {
            try {
                const userMessage = `Please explain this ${languageId} code from ${fileName} (lines ${startLine}-${endLine}):

\`\`\`${languageId}
${selectedText}
\`\`\``;

                const result = await claude.complete({
                    system: EXPLAIN_CODE_SYSTEM_PROMPT,
                    messages: [{ role: 'user', content: userMessage }],
                    maxTokens: 2000,
                });

                // Show explanation in a webview panel
                const panel = vscode.window.createWebviewPanel(
                    'ghpCodeExplanation',
                    `Code Explanation: ${fileName}`,
                    vscode.ViewColumn.Beside,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true,
                    }
                );

                panel.webview.html = getExplanationHtml(
                    selectedText,
                    languageId,
                    result.text,
                    fileName,
                    startLine,
                    endLine
                );
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to explain code: ${errorMessage}`);
            }
        }
    );
}

/**
 * Generate HTML for the explanation panel
 */
function getExplanationHtml(
    code: string,
    language: string,
    explanation: string,
    fileName: string,
    startLine: number,
    endLine: number
): string {
    // Escape HTML in code and explanation
    const escapeHtml = (text: string) =>
        text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');

    // Convert markdown-style formatting in explanation to HTML
    const formatExplanation = (text: string) => {
        return escapeHtml(text)
            // Code blocks
            .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
            // Inline code
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            // Bold
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            // Italic
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            // Headers
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            // Lists
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
            // Numbered lists
            .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
            // Line breaks
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Code Explanation</title>
    <style>
        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--vscode-foreground, #333);
            background-color: var(--vscode-editor-background, #fff);
            padding: 20px;
            line-height: 1.6;
        }
        h1, h2, h3 {
            color: var(--vscode-foreground, #333);
            margin-top: 1.5em;
            margin-bottom: 0.5em;
        }
        h1 { font-size: 1.5em; }
        h2 { font-size: 1.25em; }
        h3 { font-size: 1.1em; }
        pre {
            background-color: var(--vscode-textCodeBlock-background, #f4f4f4);
            padding: 12px;
            border-radius: 4px;
            overflow-x: auto;
            font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
            font-size: var(--vscode-editor-font-size, 12px);
        }
        code {
            font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
            background-color: var(--vscode-textCodeBlock-background, #f4f4f4);
            padding: 2px 4px;
            border-radius: 3px;
        }
        pre code {
            background: none;
            padding: 0;
        }
        .source-info {
            color: var(--vscode-descriptionForeground, #666);
            font-size: 0.9em;
            margin-bottom: 1em;
            padding-bottom: 0.5em;
            border-bottom: 1px solid var(--vscode-panel-border, #ddd);
        }
        .section {
            margin-bottom: 2em;
        }
        .section-title {
            font-weight: 600;
            margin-bottom: 0.5em;
            color: var(--vscode-foreground, #333);
        }
        ul, ol {
            padding-left: 1.5em;
        }
        li {
            margin-bottom: 0.25em;
        }
        strong {
            font-weight: 600;
        }
        p {
            margin: 0.75em 0;
        }
    </style>
</head>
<body>
    <div class="source-info">
        <strong>${escapeHtml(fileName)}</strong> (lines ${startLine}-${endLine})
    </div>

    <div class="section">
        <div class="section-title">Selected Code</div>
        <pre><code class="language-${language}">${escapeHtml(code)}</code></pre>
    </div>

    <div class="section">
        <div class="section-title">Explanation</div>
        <p>${formatExplanation(explanation)}</p>
    </div>
</body>
</html>`;
}
