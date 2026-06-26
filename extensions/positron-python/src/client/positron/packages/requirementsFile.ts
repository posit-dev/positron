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

/**
 * Normalize a package name per PEP 503: lowercase and collapse any run of
 * `-`, `_`, or `.` into a single `-`. Used only for matching, not for output.
 */
export function normalizePackageName(name: string): string {
    return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/**
 * Build requirements content from installed package names and the target
 * packages being updated.
 *
 * `installedNames` is a list of plain package names (e.g. from
 * `getPackagesInstalled` via the kernel). Every installed package is emitted so
 * the resolver honors all constraints:
 * - If the package matches a target (compared via normalized PEP 503 name), it
 *   is pinned to the target spec (`name==version`, or bare `name` if the target
 *   has no version).
 * - Otherwise it is emitted as a bare name so the resolver keeps it put unless
 *   forced to move.
 *
 * Any target not present among the installed names is appended. Blank/whitespace
 * entries are skipped defensively. Pass an empty `targets` for Update All (the
 * caller adds `--upgrade`). Ends with a trailing newline.
 */
export function buildRequirementsFile(
    installedNames: string[],
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

    for (const raw of installedNames) {
        const name = raw.trim();
        if (name === '') {
            continue;
        }
        const norm = normalizePackageName(name);
        const targetSpec = targetSpecByNormName.get(norm);
        if (targetSpec !== undefined) {
            out.push(targetSpec);
            used.add(norm);
        } else {
            out.push(name);
        }
    }

    for (const [norm, spec] of targetSpecByNormName) {
        if (!used.has(norm)) {
            out.push(spec);
        }
    }

    return out.join('\n') + '\n';
}
