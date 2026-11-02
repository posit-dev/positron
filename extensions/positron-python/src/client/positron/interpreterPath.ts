/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// No `vscode` import here, so this can be tested with Vitest.

import * as path from 'path';

/** A path that starts with a drive letter or with two backslashes (UNC). */
const WINDOWS_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\)/;

/**
 * Whether two interpreter paths name the same file as written. The comparison
 * is lexical, so it does not follow symlinks. Windows paths ignore case and
 * the kind of separator.
 *
 * A copy of core's `isSameInterpreterPath()` in `interpreterDefinitions.ts`,
 * which matches definitions to runtimes. `extensions/interpreterPath-copies.vitest.ts`
 * checks that they agree.
 */
export function isSameInterpreterPath(a: string, b: string): boolean {
    if (WINDOWS_PATH.test(a) || WINDOWS_PATH.test(b)) {
        return path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
    }
    return path.posix.normalize(a) === path.posix.normalize(b);
}

/**
 * The entry of `paths` that names the interpreter at `p`, in the entry's own
 * spelling. Runtime IDs depend on the path, so use this spelling to get the
 * same runtime that the entry creates.
 */
export function findInterpreterPath(paths: Iterable<string>, p: string): string | undefined {
    for (const candidate of paths) {
        if (isSameInterpreterPath(candidate, p)) {
            return candidate;
        }
    }
    return undefined;
}

/** Whether `paths` includes the interpreter at `p`, however either is written. */
export function includesInterpreterPath(paths: Iterable<string>, p: string): boolean {
    return findInterpreterPath(paths, p) !== undefined;
}

/** The first spelling of each interpreter in `paths`, in order. */
export function uniqueInterpreterPaths(paths: readonly string[]): string[] {
    const unique: string[] = [];
    for (const p of paths) {
        if (!includesInterpreterPath(unique, p)) {
            unique.push(p);
        }
    }
    return unique;
}
