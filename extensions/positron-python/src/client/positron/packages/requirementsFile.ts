/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pure helpers for building a pinned requirements file used by the pip and uv
 * environment-workflow update flows. Naming every installed package in a single
 * `install -r` forces the resolver to honor all constraints, so an update that
 * would break the environment fails atomically instead of succeeding silently.
 */

/** Freeze lines that are emitted by some environments but are not installable. */
const JUNK_LINES = new Set(['pkg-resources==0.0.0']);

export interface RequirementEntry {
    /** PEP 503 normalized name (lowercased, separators collapsed). */
    normalizedName: string;
    /** The name token as written in the file, e.g. "Flask". */
    rawName: string;
    /** Extras token without brackets, e.g. "security,socks"; undefined if none. */
    extras?: string;
    /** 0-based index of the entry's first physical line in the split array. */
    startLine: number;
    /** 0-based index of the entry's last physical line (inclusive), spanning `\` continuations. */
    endLine: number;
}

/**
 * Normalize a package name per PEP 503: lowercase and collapse any run of
 * `-`, `_`, or `.` into a single `-`. Used only for matching, not for output.
 */
export function normalizePackageName(name: string): string {
    return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/**
 * Extract the package name from a single `pip freeze` line, or `undefined` if
 * the line is not a plain requirement (blank, comment, option, or editable).
 * Editables (`-e ...`) are intentionally not matched: they are preserved as-is.
 */
export function extractRequirementName(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('-')) {
        return undefined;
    }
    // Leading PEP 508 name token, e.g. "Werkzeug==2.0.3" or "pkg @ file://...".
    const match = trimmed.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)/);
    return match ? match[1] : undefined;
}

/**
 * Build requirements content from `freeze` output and the target packages being
 * updated. Every installed package is named so the resolver honors all
 * constraints, but plain PyPI pins are emitted as **bare names** (no version) so
 * the resolver keeps an already-satisfied package put unless something forces it
 * to move. Origin lines (direct references `name @ ...`, editables `-e ...`) and
 * comments are kept verbatim so local/VCS packages resolve without an index
 * lookup. Each target is pinned to `name==version`; targets absent from the
 * freeze output are appended. Junk and blank lines are dropped. Pass an empty
 * `targets` for Update All (the caller adds `--upgrade`). Ends with a newline.
 */
export function buildRequirementsFile(
    freezeLines: string[],
    targets: Array<{ name: string; version?: string }>,
): string {
    const targetSpecByNormName = new Map<string, string>();
    for (const target of targets) {
        targetSpecByNormName.set(
            normalizePackageName(target.name),
            target.version ? `${target.name}==${target.version}` : target.name,
        );
    }

    const out: string[] = [];
    const used = new Set<string>();

    for (const raw of freezeLines) {
        const line = raw.trimEnd();
        const trimmed = line.trim();
        if (trimmed === '' || JUNK_LINES.has(trimmed)) {
            continue;
        }
        const name = extractRequirementName(line);
        if (name) {
            const norm = normalizePackageName(name);
            const targetSpec = targetSpecByNormName.get(norm);
            if (targetSpec !== undefined) {
                out.push(targetSpec);
                used.add(norm);
                continue;
            }
            // Plain PyPI pin -> bare name. Origin lines (containing `@`) fall
            // through to verbatim so a local/VCS package isn't sent to the index.
            if (!line.includes('@')) {
                out.push(name);
                continue;
            }
        }
        out.push(line);
    }

    for (const [norm, spec] of targetSpecByNormName) {
        if (!used.has(norm)) {
            out.push(spec);
        }
    }

    return out.join('\n') + '\n';
}

/**
 * Parse requirements content into the requirement entries it declares, each
 * with the physical-line span it occupies (so callers can replace or remove a
 * single entry without disturbing the rest of the file). A `\`-continued line
 * (the form `pip freeze --require-hashes` emits) is treated as one entry whose
 * span covers every continued physical line. Comments, blanks, global options
 * (`--index-url` etc.), and editables (`-e ...`) are not entries and are skipped.
 */
export function parseRequirements(content: string): RequirementEntry[] {
    const lines = content.split(/\r?\n/);
    const entries: RequirementEntry[] = [];
    let i = 0;
    while (i < lines.length) {
        const start = i;
        // Consume `\`-continuations so the whole logical line is one entry.
        while (i < lines.length && lines[i].trimEnd().endsWith('\\')) {
            i += 1;
        }
        const end = i; // last physical line of this logical line
        const firstLine = lines[start];
        const rawName = extractRequirementName(firstLine);
        if (rawName) {
            const afterName = firstLine.trim().slice(rawName.length);
            const extrasMatch = afterName.match(/^\[([^\]]*)\]/);
            entries.push({
                normalizedName: normalizePackageName(rawName),
                rawName,
                extras: extrasMatch ? extrasMatch[1].replace(/\s+/g, '') : undefined,
                startLine: start,
                endLine: end,
            });
        }
        i = end + 1;
    }
    return entries;
}

/**
 * Split content into lines, drop the trailing empty element produced by a
 * final newline, and remember whether the file ended with a newline.
 */
function splitLines(content: string): { lines: string[]; trailingNewline: boolean } {
    const trailingNewline = content.endsWith('\n');
    const lines = content.split(/\r?\n/);
    if (trailingNewline && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return { lines, trailingNewline };
}

function joinLines(lines: string[]): string {
    return lines.length === 0 ? '' : lines.join('\n') + '\n';
}

/** Render the spec for a target, preserving extras: `name[extras]==version`. */
function formatSpec(name: string, extras: string | undefined, version?: string): string {
    const base = extras ? `${name}[${extras}]` : name;
    return version ? `${base}==${version}` : base;
}

/** Force the target to `name==version` (or bare `name` if no version),
 *  preserving any declared extras. Replaces the matching entry's span or
 *  appends if absent. Used for the install-with-version and update op copy. */
export function setRequirement(content: string, name: string, version?: string): string {
    const { lines } = splitLines(content);
    const entries = parseRequirements(content);
    const norm = normalizePackageName(name);
    const match = entries.find((e) => e.normalizedName === norm);
    if (match) {
        const spec = formatSpec(name, match.extras, version);
        // Replace the entry's full span (start..end inclusive) with the single spec line.
        lines.splice(match.startLine, match.endLine - match.startLine + 1, spec);
        return joinLines(lines);
    }
    lines.push(formatSpec(name, undefined, version));
    return joinLines(lines);
}

/** Append a bare `name` if not already declared; otherwise return content
 *  unchanged. Used for the no-version install op copy and install write-back. */
export function appendBareIfAbsent(content: string, name: string): string {
    const norm = normalizePackageName(name);
    const already = parseRequirements(content).some((e) => e.normalizedName === norm);
    if (already) {
        return content;
    }
    const { lines } = splitLines(content);
    lines.push(name);
    return joinLines(lines);
}

/** True when the entry's first line pins an exact version, e.g. `name==1.2.3`. */
function isExactPin(firstLine: string, rawName: string): boolean {
    const afterName = firstLine
        .trim()
        .slice(rawName.length)
        .replace(/^\[[^\]]*\]/, '')
        .trimStart();
    return afterName.startsWith('==');
}

/** Write-back for update: if the target is declared as an EXACT pin
 *  (`name==X`), rewrite it to `name==version` (preserving extras); if the
 *  target is undeclared, append it bare; ranges and bare names are left
 *  unchanged. Returns content unchanged when no edit applies. */
export function recordUpdate(content: string, name: string, version: string): string {
    const { lines } = splitLines(content);
    const entries = parseRequirements(content);
    const norm = normalizePackageName(name);
    const match = entries.find((e) => e.normalizedName === norm);
    if (!match) {
        return appendBareIfAbsent(content, name);
    }
    if (!isExactPin(lines[match.startLine], match.rawName)) {
        return content; // range or bare: env still satisfies the declared line
    }
    const spec = formatSpec(match.rawName, match.extras, version);
    lines.splice(match.startLine, match.endLine - match.startLine + 1, spec);
    return joinLines(lines);
}

/** Write-back for uninstall: remove the target's full entry span if declared;
 *  otherwise return content unchanged. */
export function removeRequirement(content: string, name: string): string {
    const { lines } = splitLines(content);
    const entries = parseRequirements(content);
    const norm = normalizePackageName(name);
    const match = entries.find((e) => e.normalizedName === norm);
    if (!match) {
        return content;
    }
    lines.splice(match.startLine, match.endLine - match.startLine + 1);
    return joinLines(lines);
}
