/**
 * Tool definitions for Claude to interact with GitHub Projects
 *
 * These tools allow Claude to create and manage issues, set fields,
 * and establish relationships between issues.
 */

import type { ClaudeTool } from './types.js';

/**
 * Tool for creating a new issue
 */
export const CREATE_ISSUE_TOOL: ClaudeTool = {
    name: 'create_issue',
    description: 'Create a new GitHub issue in the repository. Returns the created issue number and URL.',
    input_schema: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                description: 'The title of the issue. Should be clear and action-oriented.',
            },
            body: {
                type: 'string',
                description: 'The body/description of the issue in markdown format.',
            },
            labels: {
                type: 'array',
                description: 'Labels to apply to the issue.',
                items: { type: 'string' },
            },
            assignees: {
                type: 'array',
                description: 'GitHub usernames to assign to the issue.',
                items: { type: 'string' },
            },
        },
        required: ['title', 'body'],
    },
};

/**
 * Tool for setting a parent-child relationship between issues
 */
export const SET_PARENT_TOOL: ClaudeTool = {
    name: 'set_parent',
    description: 'Set a parent-child relationship between two issues. The child issue will be linked to the parent epic.',
    input_schema: {
        type: 'object',
        properties: {
            child_number: {
                type: 'number',
                description: 'The issue number of the child issue.',
            },
            parent_number: {
                type: 'number',
                description: 'The issue number of the parent epic.',
            },
        },
        required: ['child_number', 'parent_number'],
    },
};

/**
 * Tool for setting a project field value on an issue
 */
export const SET_FIELD_TOOL: ClaudeTool = {
    name: 'set_field',
    description: 'Set a project field value on an issue (e.g., Status, Priority, Size).',
    input_schema: {
        type: 'object',
        properties: {
            issue_number: {
                type: 'number',
                description: 'The issue number to update.',
            },
            field_name: {
                type: 'string',
                description: 'The name of the field to set (e.g., "Status", "Priority").',
            },
            value: {
                type: 'string',
                description: 'The value to set for the field.',
            },
        },
        required: ['issue_number', 'field_name', 'value'],
    },
};

/**
 * Tool for adding a blocking relationship between issues
 */
export const ADD_BLOCKER_TOOL: ClaudeTool = {
    name: 'add_blocker',
    description: 'Add a blocking dependency between issues. The blocker must be completed before the blocked issue.',
    input_schema: {
        type: 'object',
        properties: {
            blocked_issue: {
                type: 'number',
                description: 'The issue number that is blocked.',
            },
            blocking_issue: {
                type: 'number',
                description: 'The issue number that is blocking.',
            },
        },
        required: ['blocked_issue', 'blocking_issue'],
    },
};

/**
 * Tool for adding an issue to a project
 */
export const ADD_TO_PROJECT_TOOL: ClaudeTool = {
    name: 'add_to_project',
    description: 'Add an issue to a GitHub Project board.',
    input_schema: {
        type: 'object',
        properties: {
            issue_number: {
                type: 'number',
                description: 'The issue number to add to the project.',
            },
            project_name: {
                type: 'string',
                description: 'The name of the project to add the issue to.',
            },
        },
        required: ['issue_number'],
    },
};

/**
 * Tool for adding labels to an issue
 */
export const ADD_LABELS_TOOL: ClaudeTool = {
    name: 'add_labels',
    description: 'Add labels to an existing issue.',
    input_schema: {
        type: 'object',
        properties: {
            issue_number: {
                type: 'number',
                description: 'The issue number to add labels to.',
            },
            labels: {
                type: 'array',
                description: 'The labels to add.',
                items: { type: 'string' },
            },
        },
        required: ['issue_number', 'labels'],
    },
};

/**
 * All GHP tools available to Claude
 */
export const GHP_TOOLS: ClaudeTool[] = [
    CREATE_ISSUE_TOOL,
    SET_PARENT_TOOL,
    SET_FIELD_TOOL,
    ADD_BLOCKER_TOOL,
    ADD_TO_PROJECT_TOOL,
    ADD_LABELS_TOOL,
];

/**
 * Get a subset of tools by name
 */
export function getTools(names: string[]): ClaudeTool[] {
    return GHP_TOOLS.filter(tool => names.includes(tool.name));
}

/**
 * Tool names for easy reference
 */
export const TOOL_NAMES = {
    CREATE_ISSUE: 'create_issue',
    SET_PARENT: 'set_parent',
    SET_FIELD: 'set_field',
    ADD_BLOCKER: 'add_blocker',
    ADD_TO_PROJECT: 'add_to_project',
    ADD_LABELS: 'add_labels',
} as const;
