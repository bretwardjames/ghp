/**
 * Shared editor utilities
 */

import { spawn } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Open content in user's preferred editor and return the edited content.
 *
 * @param initialContent - The initial content to show in the editor
 * @param fileExtension - File extension for syntax highlighting (default: .md)
 * @returns The edited content
 */
export async function openEditor(
    initialContent: string,
    fileExtension: string = '.md'
): Promise<string> {
    const editor = process.env.EDITOR || process.env.VISUAL || 'vim';
    const tmpFile = join(tmpdir(), `ghp-edit-${Date.now()}${fileExtension}`);

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
                const edited = readFileSync(tmpFile, 'utf-8');
                unlinkSync(tmpFile);
                resolve(edited);
            } catch (err) {
                if (existsSync(tmpFile)) unlinkSync(tmpFile);
                reject(err);
            }
        });

        child.on('error', (err) => {
            if (existsSync(tmpFile)) unlinkSync(tmpFile);
            reject(err);
        });
    });
}
