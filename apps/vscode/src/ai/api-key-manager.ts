/**
 * API Key management using VS Code SecretStorage
 *
 * Provides secure storage and retrieval of the Anthropic API key
 * using VS Code's built-in secret storage mechanism.
 */

import * as vscode from 'vscode';
import type { ApiKeyProvider } from '@bretwardjames/ghp-core';

const API_KEY_SECRET_KEY = 'ghp-anthropic-api-key';

/**
 * API Key Manager that uses VS Code SecretStorage
 */
export class ApiKeyManager implements ApiKeyProvider {
    private secretStorage: vscode.SecretStorage;

    constructor(secretStorage: vscode.SecretStorage) {
        this.secretStorage = secretStorage;
    }

    /**
     * Get the API key from secret storage
     */
    async getApiKey(): Promise<string | null> {
        const key = await this.secretStorage.get(API_KEY_SECRET_KEY);
        return key ?? null;
    }

    /**
     * Store the API key in secret storage
     */
    async setApiKey(apiKey: string): Promise<void> {
        await this.secretStorage.store(API_KEY_SECRET_KEY, apiKey);
    }

    /**
     * Delete the API key from secret storage
     */
    async deleteApiKey(): Promise<void> {
        await this.secretStorage.delete(API_KEY_SECRET_KEY);
    }

    /**
     * Check if an API key is stored
     */
    async hasApiKey(): Promise<boolean> {
        const key = await this.getApiKey();
        return key !== null && key.length > 0;
    }

    /**
     * Prompt the user to enter their API key
     */
    async promptForApiKey(): Promise<string | null> {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Anthropic API key',
            placeHolder: 'sk-ant-...',
            password: true,
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'API key is required';
                }
                if (!value.startsWith('sk-ant-')) {
                    return 'API key should start with "sk-ant-"';
                }
                return null;
            },
        });

        if (apiKey) {
            await this.setApiKey(apiKey);
            vscode.window.showInformationMessage('Anthropic API key saved securely');
            return apiKey;
        }

        return null;
    }

    /**
     * Ensure we have an API key, prompting if necessary
     */
    async ensureApiKey(): Promise<string | null> {
        const existingKey = await this.getApiKey();
        if (existingKey) {
            return existingKey;
        }

        const action = await vscode.window.showWarningMessage(
            'An Anthropic API key is required for AI features. Would you like to enter one now?',
            'Enter API Key',
            'Get API Key',
            'Cancel'
        );

        if (action === 'Enter API Key') {
            return this.promptForApiKey();
        } else if (action === 'Get API Key') {
            await vscode.env.openExternal(vscode.Uri.parse('https://console.anthropic.com/settings/keys'));
            return this.promptForApiKey();
        }

        return null;
    }
}
