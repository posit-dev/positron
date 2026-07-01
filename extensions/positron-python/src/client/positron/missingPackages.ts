/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { IPackageManager, PackageSession } from './packages/types';
import { IMPORT_TO_DISTRIBUTION } from './pythonImportAliases';

/**
 * Matches a single Python `import` or `from ... import` statement, capturing the
 * imported module list (`importImport`) or the source module (`fromImport`).
 * Leading whitespace is allowed so imports nested in functions or `try` blocks
 * are still seen. Relative imports (`from . import x`) are intentionally not
 * matched: they reference local modules, not installable packages.
 */
const IMPORT_REGEX =
    /^\s*(?:from\s+(?<fromImport>[A-Za-z_]\w*)(?:\.\w+)*\s+import\s+|import\s+(?<importImport>[A-Za-z_]\w*(?:\.\w+)*(?:\s*,\s*[A-Za-z_]\w*(?:\.\w+)*)*))/;

/**
 * Extracts the set of top-level module names referenced by `import` /
 * `from ... import` statements in the given Python source. Submodule access
 * (`import foo.bar`) collapses to the top-level package (`foo`); `as` aliases
 * and relative imports are ignored. Statements separated by semicolons on a
 * single line (`import pandas; import numpy`) are each considered.
 */
export function parsePythonImports(code: string): string[] {
    const modules = new Set<string>();
    // Split on both newlines and semicolons so compound one-line statements
    // (`import pandas; import numpy`) surface every imported module.
    for (const line of code.split(/\r?\n|;/)) {
        const match = IMPORT_REGEX.exec(line);
        if (!match?.groups) {
            continue;
        }
        if (match.groups.fromImport !== undefined) {
            modules.add(topLevelModule(match.groups.fromImport));
        } else if (match.groups.importImport !== undefined) {
            for (const part of match.groups.importImport.split(',')) {
                // Strip a trailing `as alias` and any submodule path.
                const name = part
                    .trim()
                    .split(/\s+as\s+/)[0]
                    .trim();
                if (name) {
                    modules.add(topLevelModule(name));
                }
            }
        }
    }
    return [...modules];
}

/** Returns the top-level package of a possibly-dotted module path. */
function topLevelModule(module: string): string {
    return module.split('.')[0];
}

/** PEP 503 canonicalization: lowercase and collapse runs of `-_.` to a dash. */
function canonicalizeName(name: string): string {
    return name.replace(/[-_.]+/g, '-').toLowerCase();
}

/**
 * Analyzes Python code and returns the packages it references that are not
 * importable in this session AND that resolve to an installable distribution.
 *
 * The "is it importable here?" question is answered by the kernel (which knows
 * the live import system). For each genuinely-missing import we then consult the
 * package repository to recover an installable distribution name; imports that
 * do not resolve to an installable distribution are never offered.
 */
export async function listMissingPythonPackages(
    session: PackageSession,
    packageManager: IPackageManager,
    target: positron.RuntimeMissingPackagesTarget,
    token?: vscode.CancellationToken,
): Promise<positron.RuntimeMissingPackage[]> {
    const code = await resolveCode(target);
    if (!code) {
        return [];
    }

    const modules = parsePythonImports(code);
    if (modules.length === 0) {
        return [];
    }

    // Ask the kernel which of these modules cannot be imported in this session.
    const missing = (await session.callMethod('getMissingImports', modules)) as string[];
    if (!Array.isArray(missing) || missing.length === 0) {
        return [];
    }

    const result: positron.RuntimeMissingPackage[] = [];
    const seen = new Set<string>();
    for (const module of missing) {
        if (token?.isCancellationRequested) {
            break;
        }
        const installName = await resolveInstallName(module, packageManager, token);
        if (installName) {
            const canonical = canonicalizeName(installName);
            if (!seen.has(canonical)) {
                seen.add(canonical);
                result.push({
                    name: installName,
                    referencedName: canonicalizeName(module) !== canonical ? module : undefined,
                });
            }
        }
    }
    return result;
}

/**
 * Resolves a missing import name to an installable distribution name. Tries each
 * candidate distribution name in turn (a curated alias for the import, then the
 * import name itself) and returns the first one the package repository confirms
 * by an exact, canonicalized name match. Returns undefined when none resolve, so
 * we never offer a package we cannot install.
 *
 * The alias is tried first so a well-known mismatch (`cv2` -> `opencv-python`)
 * resolves to its canonical distribution even when a same-named shim also exists.
 */
async function resolveInstallName(
    module: string,
    packageManager: IPackageManager,
    token?: vscode.CancellationToken,
): Promise<string | undefined> {
    for (const candidate of candidateDistributions(module)) {
        if (token?.isCancellationRequested) {
            return undefined;
        }
        const resolved = await searchExact(candidate, packageManager, token);
        if (resolved) {
            return resolved;
        }
    }
    return undefined;
}

/**
 * Candidate distribution names to try for an import name: the curated alias (if
 * any) first, then the import name itself.
 */
function candidateDistributions(module: string): string[] {
    const alias = IMPORT_TO_DISTRIBUTION[module];
    return alias ? [alias, module] : [module];
}

/**
 * Returns the repository's exact (canonicalized) name match for a query, or
 * undefined. A search failure (e.g. a transient network error) is treated as no
 * match so we never offer a package we could not install.
 */
async function searchExact(
    query: string,
    packageManager: IPackageManager,
    token?: vscode.CancellationToken,
): Promise<string | undefined> {
    let matches: positron.LanguageRuntimePackage[];
    try {
        matches = await packageManager.searchPackages(query, token);
    } catch {
        return undefined;
    }
    const canonical = canonicalizeName(query);
    const exact = matches.find((pkg) => canonicalizeName(pkg.name) === canonical);
    return exact?.name;
}

/** Reads the code to analyze from the target's inline code or file URI. */
async function resolveCode(target: positron.RuntimeMissingPackagesTarget): Promise<string | undefined> {
    if (target.code !== undefined) {
        return target.code;
    }
    if (target.uri) {
        try {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(target.uri));
            return document.getText();
        } catch {
            return undefined;
        }
    }
    return undefined;
}
