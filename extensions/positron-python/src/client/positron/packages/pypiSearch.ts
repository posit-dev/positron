/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';

/**
 * Create an AbortSignal from a CancellationToken for use with fetch.
 */
function createAbortSignal(token?: vscode.CancellationToken): AbortSignal | undefined {
    if (!token) {
        return undefined;
    }
    const controller = new AbortController();
    token.onCancellationRequested(() => controller.abort());
    return controller.signal;
}

/**
 * How long the cached PyPI project index stays fresh before it is refetched.
 * The simple index is multiple MB and changes slowly, so an hour is plenty;
 * within a session a user almost never needs newly published packages to
 * appear mid-search.
 */
const PYPI_INDEX_TTL_MS = 60 * 60 * 1000;

interface PyPIIndexCache {
    names: string[];
    fetchedAt: number;
}

/** Cached list of every project name on PyPI, populated lazily on first search. */
let pypiIndexCache: PyPIIndexCache | undefined;

/** Dedupes concurrent index fetches so debounced keystrokes share one download. */
let pypiIndexInFlight: Promise<string[]> | undefined;

/**
 * Download the full PyPI simple index (every project name) and cache it.
 *
 * Intentionally not tied to a per-query cancellation token: the download is a
 * shared, cacheable resource, so a superseded query shouldn't abort a fetch the
 * next query is about to reuse. Even an abandoned first search usefully warms
 * the cache.
 */
async function fetchPyPIIndex(): Promise<string[]> {
    const response = await fetch('https://pypi.org/simple/', {
        headers: { Accept: 'application/vnd.pypi.simple.v1+json' },
    });
    const json = (await response.json()) as {
        projects: { name: string }[];
    };
    const names = json.projects.map((x) => x.name);
    pypiIndexCache = { names, fetchedAt: Date.now() };
    return names;
}

/**
 * Return the cached PyPI project index, refetching if missing or stale.
 */
async function getPyPIIndex(): Promise<string[]> {
    if (pypiIndexCache && Date.now() - pypiIndexCache.fetchedAt < PYPI_INDEX_TTL_MS) {
        return pypiIndexCache.names;
    }
    if (!pypiIndexInFlight) {
        pypiIndexInFlight = fetchPyPIIndex().finally(() => {
            pypiIndexInFlight = undefined;
        });
    }
    return pypiIndexInFlight;
}

/**
 * Clear the cached PyPI index. Intended for unit tests, which share the
 * module-level cache across cases and need a clean slate per test.
 */
export function resetPyPIIndexCacheForTests(): void {
    pypiIndexCache = undefined;
    pypiIndexInFlight = undefined;
}

/**
 * Search PyPI for packages matching a query.
 *
 * Backed by a per-session, TTL'd cache of the full simple index so live
 * (debounced) search filters locally instead of re-downloading multiple MB on
 * every keystroke.
 */
export async function searchPyPI(
    query: string,
    token?: vscode.CancellationToken,
): Promise<positron.LanguageRuntimePackage[]> {
    try {
        const names = await getPyPIIndex();
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
        const normalized = query.toLowerCase();
        return names
            .filter((name) => name.toLowerCase().includes(normalized))
            .map((name) => ({
                id: name,
                name,
                displayName: name,
                version: '0',
            }));
    } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
            throw new vscode.CancellationError();
        }
        throw e;
    }
}

/**
 * Search PyPI for available versions of a specific package.
 */
export async function searchPyPIVersions(name: string, token?: vscode.CancellationToken): Promise<string[]> {
    try {
        const response = await fetch(`https://pypi.org/simple/${name}/`, {
            headers: { Accept: 'application/vnd.pypi.simple.v1+json' },
            signal: createAbortSignal(token),
        });
        const json = (await response.json()) as { versions: string[] };
        return json.versions;
    } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
            throw new vscode.CancellationError();
        }
        throw e;
    }
}
