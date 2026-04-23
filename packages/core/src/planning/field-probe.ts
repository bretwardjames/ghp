import type {
    FieldFallback,
    FieldProbeResult,
    FieldSupport,
    PlanningFieldName,
} from './types.js';

/**
 * Shape of an entry returned by `GitHubAPI.getProjectFields`. Duplicated
 * here (rather than imported) so the probe stays pure-data and is
 * trivially testable with fixtures.
 */
export interface ProjectFieldMetadata {
    id: string;
    name: string;
    /**
     * Derived from GraphQL __typename — useful for SingleSelect /
     * Iteration which have their own types, but collapses to '' for
     * generic ProjectV2Field (Date / Text / Number). Check `dataType`
     * when type is empty.
     */
    type: string;
    /**
     * GitHub's ProjectV2FieldType enum (DATE | TEXT | NUMBER |
     * SINGLE_SELECT | ITERATION | ...). This is the authoritative
     * source for distinguishing generic-typed fields.
     */
    dataType?: string;
    options?: Array<{ id: string; name: string }>;
}

/**
 * Run the capability probe. Stateless, test-friendly — the caller fetches
 * fields via `GitHubAPI.getProjectFields()` and passes them in.
 *
 * Matching is case-insensitive on the field name since GitHub Projects
 * lets users rename fields ("priority" / "Priority" / "PRIORITY" are
 * all treated as the same logical field).
 */
export function probeProjectFields(
    projectId: string,
    projectTitle: string,
    fields: ReadonlyArray<ProjectFieldMetadata>
): FieldProbeResult {
    const byLowerName = new Map(
        fields.map((f) => [f.name.toLowerCase(), f] as const)
    );

    const detected: Record<PlanningFieldName, FieldSupport> = {
        Status: fieldSupport(byLowerName.get('status'), 'single-select'),
        Priority: fieldSupport(byLowerName.get('priority'), 'single-select'),
        Size: fieldSupport(byLowerName.get('size'), 'single-select'),
        'Last Reviewed': fieldSupport(byLowerName.get('last reviewed'), 'date'),
        Sprint: resolveSprintSupport(byLowerName),
    };

    const fallbacks: FieldFallback[] = [];
    const suggestions: FieldProbeResult['suggestions'] = [];

    if (detected.Size !== true) {
        fallbacks.push({
            field: 'Size',
            strategy: 'label-prefix',
            description: "Labels matching /^size:(xs|s|m|l|xl)$/i will be treated as the item's Size.",
        });
        suggestions.push({
            field: 'Size',
            upgrade: 'Add a SingleSelect "Size" field to the project with options XS / S / M / L / XL.',
            impact: 'Enables sprint-capacity gut-checks; today the tool falls back to label prefixes.',
        });
    }

    if (detected['Last Reviewed'] !== true) {
        detected['Last Reviewed'] = 'fallback';
        fallbacks.push({
            field: 'Last Reviewed',
            strategy: 'body-sentinel',
            description:
                'An HTML-comment sentinel (<!-- ghp:reviewed:YYYY-MM-DD:decision:by -->) is appended to each issue body when a decision is recorded. Invisible in the GitHub UI; machine-parseable by this tool.',
        });
        suggestions.push({
            field: 'Last Reviewed',
            upgrade: 'Add a Date field named "Last Reviewed" to the project.',
            impact:
                'Removes the need for body sentinels entirely and lets GitHub Project views filter by staleness natively.',
        });
    }

    if (detected.Sprint !== true) {
        fallbacks.push({
            field: 'Sprint',
            strategy: 'milestone-group',
            description:
                'No Iteration field detected. GitHub milestones will be used as coarse sprint groupings; step 4 ("current sprint") and step 6 ("forward planning") will operate on milestone assignments instead of iteration IDs.',
        });
        suggestions.push({
            field: 'Sprint',
            upgrade: 'Add an Iteration field named "Sprint" to the project.',
            impact:
                'Enables true rolling-window planning with one-week iterations; milestone-fallback is coarser.',
        });
    }

    if (detected.Priority !== true) {
        fallbacks.push({
            field: 'Priority',
            strategy: 'label-prefix',
            description:
                "Labels matching /^priority:(low|med|high|urgent)$/i will be treated as the item's Priority.",
        });
        suggestions.push({
            field: 'Priority',
            upgrade:
                'Add a SingleSelect "Priority" field to the project with options Low / Med / High / Urgent.',
            impact: 'Enables priority-based backlog ranking; today the tool falls back to label prefixes.',
        });
    }

    return {
        projectId,
        projectTitle,
        detected,
        fallbacks,
        suggestions,
    };
}

function fieldSupport(
    field: ProjectFieldMetadata | undefined,
    expectedType: 'single-select' | 'date' | 'iteration'
): FieldSupport {
    if (!field) return 'fallback';
    // Prefer GitHub's ProjectV2FieldType enum (via `dataType`) since the
    // derived `type` string is empty for generic ProjectV2Field (Date /
    // Text / Number all collapse to the same variant in GraphQL). Fall
    // back to the __typename-derived string for tests / older data.
    const dataType = field.dataType?.toLowerCase();
    const normalizedType = field.type.toLowerCase();
    const expected = expectedType.replace('-', '');
    // Compare against the enum form used by GitHub (e.g. 'DATE',
    // 'SINGLE_SELECT', 'ITERATION'). Underscore-strip so 'single_select'
    // matches 'singleselect'.
    if (dataType) {
        const normalizedDataType = dataType.replace(/_/g, '');
        if (normalizedDataType === expected) return true;
        // dataType is authoritative — mismatch means the field is the
        // wrong kind, regardless of what the derived `type` string says.
        return 'fallback';
    }
    if (normalizedType === expected || normalizedType.startsWith(expected)) {
        return true;
    }
    return 'fallback';
}

function resolveSprintSupport(
    byLowerName: Map<string, ProjectFieldMetadata>
): FieldSupport {
    const sprint = byLowerName.get('sprint') ?? byLowerName.get('iteration');
    if (!sprint) return 'fallback';
    if (sprint.type.toLowerCase().includes('iteration')) return true;
    return 'fallback';
}
