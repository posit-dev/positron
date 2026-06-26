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
 * Build requirements content from the installed-package list and the target
 * packages being updated. Every installed package is named so the resolver
 * honors all constraints, but plain PyPI pins are emitted as **bare names**
 * (no version) so the resolver keeps an already-satisfied package put unless
 * something forces it to move. Each target is pinned to `name==version`;
 * targets absent from the installed list are appended. Junk and blank lines
 * are dropped. Pass an empty `targets` for Update All (the caller adds
 * `--upgrade`). Ends with a newline.
 */
export function buildRequirementsFile(
    installedLines: string[],
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

    for (const raw of installedLines) {
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
