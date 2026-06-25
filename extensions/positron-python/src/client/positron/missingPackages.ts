/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { IPackageManager, PackageSession } from './packages/types';

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
 * and relative imports are ignored.
 */
export function parsePythonImports(code: string): string[] {
    const modules = new Set<string>();
    for (const line of code.split(/\r?\n/)) {
        const match = IMPORT_REGEX.exec(line);
        if (!match?.groups) {
            continue;
        }
        if (match.groups.fromImport !== undefined) {
            modules.add(topLevelModule(match.groups.fromImport));
        } else if (match.groups.importImport !== undefined) {
            for (const part of match.groups.importImport.split(',')) {
                // Strip a trailing `as alias` and any submodule path.
                const name = part.trim().split(/\s+as\s+/)[0].trim();
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
 * Resolves a missing import name to an installable distribution name by querying
 * the package repository for an exact (canonicalized) name match. Returns
 * undefined when no installable distribution matches, so we never offer a
 * package we cannot install.
 */
async function resolveInstallName(
    module: string,
    packageManager: IPackageManager,
    token?: vscode.CancellationToken,
): Promise<string | undefined> {
    let matches: positron.LanguageRuntimePackage[];
    try {
        matches = await packageManager.searchPackages(module, token);
    } catch {
        return undefined;
    }
    const canonical = canonicalizeName(module);
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
