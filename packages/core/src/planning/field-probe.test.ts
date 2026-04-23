import { describe, it, expect } from 'vitest';
import { probeProjectFields, type ProjectFieldMetadata } from './field-probe.js';

function field(name: string, type: string): ProjectFieldMetadata {
    return { id: `F_${name}`, name, type };
}

describe('probeProjectFields', () => {
    it('all fields present → everything detected as real', () => {
        const report = probeProjectFields('P_1', 'Full Project', [
            field('Status', 'SingleSelect'),
            field('Priority', 'SingleSelect'),
            field('Size', 'SingleSelect'),
            field('Last Reviewed', 'Date'),
            field('Sprint', 'Iteration'),
        ]);
        expect(report.detected).toEqual({
            Status: true,
            Priority: true,
            Size: true,
            'Last Reviewed': true,
            Sprint: true,
        });
        expect(report.fallbacks).toEqual([]);
        expect(report.suggestions).toEqual([]);
    });

    it('no project fields → every fallback + suggestion surfaces', () => {
        const report = probeProjectFields('P_1', 'Bare Project', []);
        expect(report.detected.Status).toBe('fallback');
        expect(report.detected.Priority).toBe('fallback');
        expect(report.detected.Size).toBe('fallback');
        expect(report.detected['Last Reviewed']).toBe('fallback');
        expect(report.detected.Sprint).toBe('fallback');
        const fields = report.fallbacks.map((f) => f.field);
        expect(fields).toContain('Priority');
        expect(fields).toContain('Size');
        expect(fields).toContain('Last Reviewed');
        expect(fields).toContain('Sprint');
        expect(report.suggestions.map((s) => s.field)).toEqual(
            expect.arrayContaining(['Size', 'Last Reviewed', 'Sprint', 'Priority'])
        );
    });

    it('case-insensitive field matching', () => {
        const report = probeProjectFields('P_1', 'Mixed Case', [
            field('priority', 'SingleSelect'),
            field('STATUS', 'SingleSelect'),
        ]);
        expect(report.detected.Priority).toBe(true);
        expect(report.detected.Status).toBe(true);
    });

    it('field present but wrong type → counted as fallback', () => {
        // Someone named a Text field "Priority" — do not silently coerce.
        const report = probeProjectFields('P_1', 'Wrong Types', [
            field('Priority', 'Text'),
        ]);
        expect(report.detected.Priority).toBe('fallback');
        expect(report.fallbacks.find((f) => f.field === 'Priority')?.strategy).toBe(
            'label-prefix'
        );
    });

    it('Last Reviewed always reports as fallback when missing (never `false`)', () => {
        const report = probeProjectFields('P_1', 'X', []);
        expect(report.detected['Last Reviewed']).toBe('fallback');
        expect(
            report.fallbacks.find((f) => f.field === 'Last Reviewed')?.strategy
        ).toBe('body-sentinel');
    });

    it('Sprint missing → milestone-group strategy + suggestion to add iteration', () => {
        const report = probeProjectFields('P_1', 'X', []);
        const sprintFallback = report.fallbacks.find((f) => f.field === 'Sprint');
        expect(sprintFallback?.strategy).toBe('milestone-group');
        expect(report.suggestions.find((s) => s.field === 'Sprint')).toBeTruthy();
    });
});
