/**
 * AI-powered commands for GitHub Projects extension
 *
 * Provides Claude-powered features:
 * - Generate Commit Message: Creates commit messages from staged changes
 * - Explain Selected Code: Explains highlighted code
 * - Suggest Issue: Creates issue suggestions from code or TODOs
 */

export { ApiKeyManager } from './api-key-manager';
export { executeGenerateCommitMessage } from './generate-commit-message';
export { executeExplainCode } from './explain-code';
export { executeSuggestIssue } from './suggest-issue';
