import { describe, it, expect } from 'vitest';
import { shellEscape, validateNumericInput, validateSafeString, validateUrl } from './shell-utils.js';

describe('shellEscape', () => {
    it('escapes simple strings by wrapping in single quotes', () => {
        expect(shellEscape('hello')).toBe("'hello'");
        expect(shellEscape('hello world')).toBe("'hello world'");
    });

    it('escapes embedded single quotes', () => {
        expect(shellEscape("it's")).toBe("'it'\\''s'");
        expect(shellEscape("don't do that")).toBe("'don'\\''t do that'");
    });

    it('prevents command substitution attacks', () => {
        // These should be literal strings, not executed
        expect(shellEscape('$(rm -rf /)')).toBe("'$(rm -rf /)'");
        expect(shellEscape('`whoami`')).toBe("'`whoami`'");
    });

    it('prevents variable expansion attacks', () => {
        expect(shellEscape('$HOME')).toBe("'$HOME'");
        expect(shellEscape('${PATH}')).toBe("'${PATH}'");
    });

    it('handles special shell characters', () => {
        expect(shellEscape('a; rm -rf /')).toBe("'a; rm -rf /'");
        expect(shellEscape('a && evil')).toBe("'a && evil'");
        expect(shellEscape('a | cat /etc/passwd')).toBe("'a | cat /etc/passwd'");
        expect(shellEscape('a > /dev/null')).toBe("'a > /dev/null'");
    });

    it('handles empty strings', () => {
        expect(shellEscape('')).toBe("''");
    });

    it('handles strings with only quotes', () => {
        // Single quote becomes: ' + '\'' + ' = ''\'''
        expect(shellEscape("'")).toBe("''\\'''");
        // Two quotes: ' + '\'''\'' + ' = ''\'''\'''
        expect(shellEscape("''")).toBe("''\\'''\\'''");
    });

    it('handles newlines and carriage returns', () => {
        // Newlines are safe inside single quotes - they become literal
        expect(shellEscape("hello\nworld")).toBe("'hello\nworld'");
        expect(shellEscape("hello\rworld")).toBe("'hello\rworld'");
        expect(shellEscape("line1\r\nline2")).toBe("'line1\r\nline2'");
    });

    it('handles null bytes', () => {
        // Null bytes are preserved inside single quotes
        expect(shellEscape("hello\x00world")).toBe("'hello\x00world'");
    });

    it('handles unicode and special characters', () => {
        expect(shellEscape("héllo wörld")).toBe("'héllo wörld'");
        expect(shellEscape("emoji 🎉")).toBe("'emoji 🎉'");
    });
});

describe('validateNumericInput', () => {
    it('accepts valid integers', () => {
        expect(validateNumericInput(123)).toBe(123);
        expect(validateNumericInput(0)).toBe(0);
    });

    it('accepts numeric strings', () => {
        expect(validateNumericInput('456')).toBe(456);
        expect(validateNumericInput('0')).toBe(0);
    });

    it('rejects negative numbers', () => {
        expect(() => validateNumericInput(-1)).toThrow('must be a non-negative integer');
    });

    it('rejects non-numeric strings', () => {
        expect(() => validateNumericInput('abc')).toThrow('must be a non-negative integer');
        expect(() => validateNumericInput('12; rm -rf')).toThrow('must be a non-negative integer');
    });

    it('rejects NaN and Infinity', () => {
        expect(() => validateNumericInput(NaN)).toThrow('must be a non-negative integer');
        expect(() => validateNumericInput(Infinity)).toThrow('must be a non-negative integer');
    });

    it('includes field name in error message', () => {
        expect(() => validateNumericInput('bad', 'issue')).toThrow('Invalid issue:');
    });
});

describe('validateSafeString', () => {
    it('accepts safe strings', () => {
        expect(validateSafeString('hello')).toBe('hello');
        expect(validateSafeString('hello-world')).toBe('hello-world');
        expect(validateSafeString('@org/pkg-name')).toBe('@org/pkg-name');
        expect(validateSafeString('1.2.3-beta.1')).toBe('1.2.3-beta.1');
    });

    it('rejects strings with shell metacharacters', () => {
        expect(() => validateSafeString('$(whoami)')).toThrow('contains unsafe characters');
        expect(() => validateSafeString('a; rm -rf')).toThrow('contains unsafe characters');
        expect(() => validateSafeString('a`whoami`')).toThrow('contains unsafe characters');
    });

    it('supports custom patterns', () => {
        const alphaOnly = /^[a-z]+$/;
        expect(validateSafeString('hello', 'value', alphaOnly)).toBe('hello');
        expect(() => validateSafeString('hello123', 'value', alphaOnly)).toThrow('contains unsafe characters');
    });
});

describe('validateUrl', () => {
    it('accepts valid https URLs', () => {
        expect(validateUrl('https://github.com/org/repo')).toBe('https://github.com/org/repo');
        expect(validateUrl('https://example.com/path/to/page')).toBe('https://example.com/path/to/page');
    });

    it('accepts valid http URLs', () => {
        expect(validateUrl('http://localhost:3000')).toBe('http://localhost:3000');
    });

    it('accepts URLs with query parameters', () => {
        expect(validateUrl('https://github.com/org/repo/issues?q=is:open')).toBe('https://github.com/org/repo/issues?q=is:open');
        expect(validateUrl('https://example.com/search?foo=bar')).toBe('https://example.com/search?foo=bar');
    });

    it('accepts URLs with fragments', () => {
        expect(validateUrl('https://example.com/page#section')).toBe('https://example.com/page#section');
    });

    it('rejects non-http protocols', () => {
        expect(() => validateUrl('file:///etc/passwd')).toThrow('only http/https allowed');
        expect(() => validateUrl('javascript:alert(1)')).toThrow('only http/https allowed');
        expect(() => validateUrl('ftp://server.com')).toThrow('only http/https allowed');
    });

    it('rejects invalid URLs', () => {
        expect(() => validateUrl('not-a-url')).toThrow('Invalid URL');
        expect(() => validateUrl('')).toThrow('Invalid URL');
    });

    it('rejects URLs with shell metacharacters', () => {
        expect(() => validateUrl('https://evil.com/$(whoami)')).toThrow('potentially dangerous characters');
        expect(() => validateUrl('https://evil.com/`id`')).toThrow('potentially dangerous characters');
        expect(() => validateUrl("https://evil.com/'; rm -rf")).toThrow('potentially dangerous characters');
    });
});
