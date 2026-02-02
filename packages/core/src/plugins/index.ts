/**
 * Event Hooks System Exports
 */

// Types
export type {
    EventType,
    HookMode,
    HookExitCodes,
    HookOutcome,
    EventHook,
    EventHooksConfig,
    BaseEventPayload,
    IssueCreatedPayload,
    IssueStartedPayload,
    PrePrPayload,
    PrCreatingPayload,
    PrCreatedPayload,
    PrMergedPayload,
    WorktreeCreatedPayload,
    WorktreeRemovedPayload,
    EventPayload,
    HookResult,
} from './types.js';

// Registry
export {
    getEventHooksConfigPath,
    loadEventHooksConfig,
    saveEventHooksConfig,
    getEventHooks,
    getEnabledEventHooks,
    getEventHook,
    getHooksForEvent,
    addEventHook,
    updateEventHook,
    removeEventHook,
    enableEventHook,
    disableEventHook,
    getValidEventTypes,
    getValidModes,
} from './registry.js';

// Executor
export {
    substituteTemplateVariables,
    executeEventHook,
    executeHooksForEvent,
    hasHooksForEvent,
    shouldAbort,
} from './executor.js';

export type { HookExecutionOptions } from './executor.js';
