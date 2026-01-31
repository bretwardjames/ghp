/**
 * Event Hooks System Exports
 */

// Types
export type {
    EventType,
    EventHook,
    EventHooksConfig,
    BaseEventPayload,
    IssueCreatedPayload,
    IssueStartedPayload,
    PrCreatedPayload,
    PrMergedPayload,
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
} from './registry.js';

// Executor
export {
    substituteTemplateVariables,
    executeEventHook,
    executeHooksForEvent,
    hasHooksForEvent,
} from './executor.js';
