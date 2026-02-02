/**
 * Shell Utilities - Safe command execution helpers
 *
 * Provides shell escaping and validation utilities to prevent command injection.
 */

// =============================================================================
// Shell Escaping
// =============================================================================

/**
 * Escape a string for safe use in shell commands.
 *
 * Uses POSIX-standard single-quote escaping: wraps the string in single quotes
 * and escapes any embedded single quotes as '\'' (end quote, escaped quote, start quote).
 *
 * This is the safest escaping method because single-quoted strings in POSIX shells
 * have NO special characters - everything is literal except the closing quote.
 *
 * @example
 * ```typescript
 * shellEscape("hello world")     // "'hello world'"
 * shellEscape("it's fine")       // "'it'\\''s fine'"
 * shellEscape("$(rm -rf /)")     // "'$(rm -rf /)'"  (safe - not executed)
 * shellEscape("`whoami`")        // "'`whoami`'"    (safe - not executed)
 * ```
 *
 * @param str - The string to escape
 * @returns The escaped string, safe for shell interpolation
 */
export function shellEscape(str: string): string {
    // Wrap in single quotes, escape embedded single quotes as '\''
    // This prevents ALL shell metacharacter interpretation
    return "'" + str.replace(/'/g, "'\\''") + "'";
}

// =============================================================================
// Input Validation
// =============================================================================

/**
 * Validate that a value is a safe integer for use in shell commands.
 * Returns the number if valid, throws if not.
 *
 * @example
 * ```typescript
 * validateNumericInput(123)        // 123
 * validateNumericInput("456")      // 456
 * validateNumericInput("12; rm")   // throws
 * validateNumericInput(NaN)        // throws
 * ```
 */
export function validateNumericInput(value: unknown, fieldName = 'value'): number {
    // For strings, ensure the ENTIRE string is numeric (parseInt stops at first non-digit)
    if (typeof value === 'string') {
        if (!/^\d+$/.test(value)) {
            throw new Error(`Invalid ${fieldName}: must be a non-negative integer`);
        }
        return parseInt(value, 10);
    }

    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new Error(`Invalid ${fieldName}: must be a non-negative integer`);
    }

    return value;
}

/**
 * Validate that a string matches a safe pattern (alphanumeric, hyphens, underscores, slashes, dots).
 * Useful for package names, paths, etc.
 *
 * @example
 * ```typescript
 * validateSafeString("@org/pkg-name")  // "@org/pkg-name"
 * validateSafeString("1.2.3-beta.1")   // "1.2.3-beta.1"
 * validateSafeString("$(whoami)")      // throws
 * ```
 */
export function validateSafeString(
    value: string,
    fieldName = 'value',
    pattern: RegExp = /^[@a-zA-Z0-9._/-]+$/
): string {
    if (!pattern.test(value)) {
        throw new Error(`Invalid ${fieldName}: contains unsafe characters`);
    }
    return value;
}

/**
 * Validate a URL for safe use in shell commands.
 * Only allows http:// and https:// URLs with safe characters.
 *
 * @example
 * ```typescript
 * validateUrl("https://github.com/org/repo")  // OK
 * validateUrl("file:///etc/passwd")           // throws
 * validateUrl("https://evil.com/$(whoami)")   // throws
 * ```
 */
export function validateUrl(url: string): string {
    // Parse URL to validate structure
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Invalid URL: ${url}`);
    }

    // Only allow http/https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Invalid URL protocol: ${parsed.protocol} (only http/https allowed)`);
    }

    // Check for shell metacharacters in the URL
    // These could be used for command injection even in quoted strings
    const dangerousPatterns = /[`$\\!<>|;&(){}[\]'"]/;
    if (dangerousPatterns.test(url)) {
        throw new Error(`URL contains potentially dangerous characters: ${url}`);
    }

    return url;
}
