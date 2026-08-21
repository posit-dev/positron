// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

export interface SplitLinesOptions {
    trim?: boolean;
    removeEmptyEntries?: boolean;
}

/**
 * Split a string using the cr and lf characters and return them as an array.
 * By default lines are trimmed and empty lines are removed.
 * @param {SplitLinesOptions=} splitOptions - Options used for splitting the string.
 */
export function splitLines(
    source: string,
    splitOptions: SplitLinesOptions = { removeEmptyEntries: true, trim: true },
): string[] {
    let lines = source.split(/\r?\n/g);
    if (splitOptions?.trim) {
        lines = lines.map((line) => line.trim());
    }
    if (splitOptions?.removeEmptyEntries) {
        lines = lines.filter((line) => line.length > 0);
    }
    return lines;
}

/**
 * Replaces all instances of a substring with a new substring.
 */
export function replaceAll(source: string, substr: string, newSubstr: string): string {
    if (!source) {
        return source;
    }

    /** Escaping function from the MDN web docs site
     * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#escaping
     * Escapes all the following special characters in a string . * + ? ^ $ { } ( ) | \ \\
     */

    function escapeRegExp(unescapedStr: string): string {
        return unescapedStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
    }

    return source.replace(new RegExp(escapeRegExp(substr), 'g'), newSubstr);
}

// --- Start Positron ---
/**
 * Returns the shortest string from an array of strings.
 *
 * Equal-length strings are broken lexicographically so that the result depends
 * only on the set of inputs, not on their order. Callers use this to pick a
 * single winner among equivalent interpreter paths; an order-dependent result
 * lets two equal-length paths each displace the other indefinitely.
 * @param strings - The strings to compare.
 * @returns The shortest string, or the lexicographically first of the shortest.
 */
export function getShortestString(strings: string[]): string {
    return strings.reduce((a, b) => {
        if (a.length !== b.length) {
            return a.length < b.length ? a : b;
        }
        return a <= b ? a : b;
    });
}
// --- End Positron ---
