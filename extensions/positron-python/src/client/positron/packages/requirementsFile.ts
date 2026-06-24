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
 * Build pinned requirements content from `freeze` output and the set of target
 * packages being updated. Each target's existing line is replaced with
 * `name==version` (or a bare `name` when no version is given); all other lines
 * are preserved verbatim and in order; junk lines are dropped; targets absent
 * from the freeze output are appended. The result ends with a trailing newline.
 */
export function buildPinnedRequirements(
    freezeLines: string[],
    targets: Array<{ name: string; version?: string }>,
): string {
    const targetSpecByNormName = new Map<string, string>();
    for (const target of targets) {
        const spec = target.version ? `${target.name}==${target.version}` : target.name;
        targetSpecByNormName.set(normalizePackageName(target.name), spec);
    }

    const out: string[] = [];
    const used = new Set<string>();

    for (const raw of freezeLines) {
        const line = raw.trimEnd();
        if (line.trim() === '' || JUNK_LINES.has(line.trim())) {
            continue;
        }
        const name = extractRequirementName(line);
        if (name) {
            const norm = normalizePackageName(name);
            const spec = targetSpecByNormName.get(norm);
            if (spec !== undefined) {
                out.push(spec);
                used.add(norm);
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
