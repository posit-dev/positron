/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure, I/O-free helpers that add or remove a single top-level entry in a
 * `requirements.txt` while leaving every other line byte-for-byte intact.
 * Used to keep the file's declared set in sync after an explicit install or
 * uninstall (see `requirementsSync.ts`). We never re-version an existing pin
 * and never reformat the file.
 */

import { extractRequirementName, normalizePackageName } from './requirementsFile';

/** A named top-level requirement and the line span it occupies (0-based, inclusive). */
export interface RequirementEntry {
    normalizedName: string;
    startLine: number;
    endLine: number;
}

/** Strip a single trailing CR so CRLF files parse the same as LF files. */
function stripCr(line: string): string {
    return line.replace(/\r$/, '');
}

/**
 * Parse the named top-level requirements out of `content`. Blank lines,
 * comments (`#`), and option/editable lines (`-r`, `-e`, `--index-url`, ...)
 * are not entries and are never matched or removed. Each entry's span covers
 * trailing `\`-continuation lines and any following per-requirement `--hash`
 * option lines, so removal takes the whole logical requirement with it.
 */
export function parseRequirements(content: string): RequirementEntry[] {
    const lines = content.split('\n');
    const entries: RequirementEntry[] = [];
    let i = 0;
    while (i < lines.length) {
        const startLine = i;
        const logical = stripCr(lines[i]);
        const trimmed = logical.trim();
        if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('-')) {
            i += 1;
            continue;
        }
        let endLine = i;
        // Backslash line-continuations belong to this requirement.
        while (endLine + 1 < lines.length && stripCr(lines[endLine]).trimEnd().endsWith('\\')) {
            endLine += 1;
        }
        // Trailing `--hash` option lines belong to this requirement too.
        while (endLine + 1 < lines.length && stripCr(lines[endLine + 1]).trim().startsWith('--hash')) {
            endLine += 1;
        }
        const name = extractRequirementName(logical);
        if (name) {
            entries.push({ normalizedName: normalizePackageName(name), startLine, endLine });
        }
        i = endLine + 1;
    }
    return entries;
}

/** Whether `name` is already a declared top-level requirement (PEP 503 match). */
export function isPackageDeclared(content: string, name: string): boolean {
    const norm = normalizePackageName(name);
    return parseRequirements(content).some((e) => e.normalizedName === norm);
}

/**
 * Append `name` as a bare requirement on its own line. No-op if already
 * declared. Guarantees the result ends with a single trailing newline.
 */
export function appendPackage(content: string, name: string): string {
    if (isPackageDeclared(content, name)) {
        return content;
    }
    const needsNewline = content.length > 0 && !content.endsWith('\n');
    return `${content}${needsNewline ? '\n' : ''}${name}\n`;
}

/**
 * Remove every entry matching `name` (full span). No-op if not declared.
 * Untouched lines are preserved exactly.
 */
export function removePackage(content: string, name: string): string {
    const norm = normalizePackageName(name);
    const matches = parseRequirements(content).filter((e) => e.normalizedName === norm);
    if (matches.length === 0) {
        return content;
    }
    const drop = new Set<number>();
    for (const entry of matches) {
        for (let line = entry.startLine; line <= entry.endLine; line += 1) {
            drop.add(line);
        }
    }
    const lines = content.split('\n');
    return lines.filter((_, idx) => !drop.has(idx)).join('\n');
}
