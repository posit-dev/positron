/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure helpers that add or remove a single top-level entry in a
 * `requirements.txt`, leaving every other line byte-for-byte intact. Every edit
 * is annotated so users can see what Positron changed: an added entry becomes
 * `name  # added by Positron`, and a removed entry is replaced by a
 * `# name removed by Positron` comment. Existing pins are never re-versioned.
 */

import { extractRequirementName, normalizePackageName } from './requirementsFile';

const ADDED_COMMENT = '# added by Positron';
const ADDED_PATTERN = /\s#\s*added by Positron\s*$/;
const REMOVED_PATTERN = /^#\s*(?<name>[A-Za-z0-9][A-Za-z0-9._-]*)\s+removed by Positron\s*$/;

/** A named top-level requirement and the line span it occupies (0-based, inclusive). */
interface RequirementEntry {
    name: string;
    startLine: number;
    endLine: number;
}

/** Strip a single trailing CR so CRLF files parse the same as LF files. */
function stripCr(line: string): string {
    return line.replace(/\r$/, '');
}

/**
 * Parse the named top-level requirements out of `lines`. Blank lines, comments,
 * and option/editable lines (`-r`, `-e`, `--index-url`, ...) are not entries.
 * Each entry's span covers trailing `\`-continuation lines and any following
 * per-requirement `--hash` option lines, so removal takes the whole logical
 * requirement with it.
 */
function parseRequirements(lines: string[]): RequirementEntry[] {
    const entries: RequirementEntry[] = [];
    let i = 0;
    while (i < lines.length) {
        const name = extractRequirementName(stripCr(lines[i]));
        if (!name) {
            i += 1;
            continue;
        }
        let endLine = i;
        while (endLine + 1 < lines.length && stripCr(lines[endLine]).trimEnd().endsWith('\\')) {
            endLine += 1;
        }
        while (endLine + 1 < lines.length && lines[endLine + 1].trim().startsWith('--hash')) {
            endLine += 1;
        }
        entries.push({ name, startLine: i, endLine });
        i = endLine + 1;
    }
    return entries;
}

/** The normalized package name of a `# name removed by Positron` line, if it is one. */
function removedPackageName(line: string): string | undefined {
    const name = stripCr(line).trim().match(REMOVED_PATTERN)?.groups?.name;
    return name ? normalizePackageName(name) : undefined;
}

function findEntries(lines: string[], name: string): RequirementEntry[] {
    const normalized = normalizePackageName(name);
    return parseRequirements(lines).filter((entry) => normalizePackageName(entry.name) === normalized);
}

/**
 * Declare `name` as a bare requirement annotated `# added by Positron`. If a
 * `# name removed by Positron` line exists, it is replaced in place so an
 * uninstall/reinstall round trip doesn't leave a stale comment behind. Returns
 * `content` unchanged if `name` is already declared.
 */
export function addRequirement(content: string, name: string): string {
    const lines = content.split('\n');
    if (findEntries(lines, name).length > 0) {
        return content;
    }
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const added = `${name}  ${ADDED_COMMENT}`;

    const normalized = normalizePackageName(name);
    const removedLine = lines.findIndex((line) => removedPackageName(line) === normalized);
    if (removedLine !== -1) {
        lines[removedLine] = lines[removedLine].endsWith('\r') ? `${added}\r` : added;
        return lines.join('\n');
    }

    const separator = content.length > 0 && !content.endsWith('\n') ? eol : '';
    return `${content}${separator}${added}${eol}`;
}

/**
 * Remove every entry declaring `name` (full span). The first removed entry is
 * replaced by a `# name removed by Positron` line, unless Positron added it in
 * the first place, in which case it is deleted outright. Returns `content`
 * unchanged if `name` is not declared.
 */
export function removeRequirement(content: string, name: string): string {
    const lines = content.split('\n');
    const entries = findEntries(lines, name);
    if (entries.length === 0) {
        return content;
    }
    const cr = content.includes('\r\n') ? '\r' : '';

    const output: string[] = [];
    let next = 0;
    let commented = false;
    for (const entry of entries) {
        output.push(...lines.slice(next, entry.startLine));
        const addedByPositron =
            entry.startLine === entry.endLine && ADDED_PATTERN.test(stripCr(lines[entry.startLine]));
        if (!addedByPositron && !commented) {
            output.push(`# ${entry.name} removed by Positron${cr}`);
            commented = true;
        }
        next = entry.endLine + 1;
    }
    output.push(...lines.slice(next));
    return output.join('\n');
}
