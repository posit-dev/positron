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

/**
 * Cap on the number of search results returned. A broad query (e.g. "a")
 * matches a large fraction of PyPI's ~800k projects; returning them all would
 * build and serialize a huge array for results no one will scroll. The exact
 * match is preserved regardless of where it falls (see searchPyPI).
 */
const PYPI_MAX_RESULTS = 100;

interface PyPIIndex {
    /** Project names as published, for display. */
    names: string[];
    /** names[i] pre-lowercased, so matching doesn't re-allocate on every query. */
    lower: string[];
}

interface PyPIIndexCache extends PyPIIndex {
    fetchedAt: number;
}

/** Cached index of every project on PyPI, populated lazily on first search. */
let pypiIndexCache: PyPIIndexCache | undefined;

/** Dedupes concurrent index fetches so debounced keystrokes share one download. */
let pypiIndexInFlight: Promise<PyPIIndex> | undefined;

/**
 * Download the full PyPI simple index (every project name) and cache it.
 *
 * Intentionally not tied to a per-query cancellation token: the download is a
 * shared, cacheable resource, so a superseded query shouldn't abort a fetch the
 * next query is about to reuse. Even an abandoned first search usefully warms
 * the cache.
 */
async function fetchPyPIIndex(): Promise<PyPIIndex> {
    const response = await fetch('https://pypi.org/simple/', {
        headers: { Accept: 'application/vnd.pypi.simple.v1+json' },
    });
    const json = (await response.json()) as {
        projects: { name: string }[];
    };
    const names = json.projects.map((x) => x.name);
    const lower = names.map((name) => name.toLowerCase());
    pypiIndexCache = { names, lower, fetchedAt: Date.now() };
    return { names, lower };
}

/**
 * Return the cached PyPI project index, refetching if missing or stale.
 */
async function getPyPIIndex(): Promise<PyPIIndex> {
    if (pypiIndexCache && Date.now() - pypiIndexCache.fetchedAt < PYPI_INDEX_TTL_MS) {
        return pypiIndexCache;
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
        const { names, lower } = await getPyPIIndex();
        if (token?.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
        const normalized = query.toLowerCase();

        // The simple index is unranked (roughly alphabetical), so rank matches
        // ourselves: names that start with the query come before names that
        // merely contain it. Each bucket keeps index order and is capped, so a
        // broad query stays bounded. The exact match is tracked separately and
        // forced in below in case it falls outside the cap.
        const prefixMatches: string[] = [];
        const containsMatches: string[] = [];
        let exactName: string | undefined;
        for (let i = 0; i < lower.length; i++) {
            const name = lower[i];
            if (name === normalized) {
                exactName = names[i];
            }
            if (name.startsWith(normalized)) {
                if (prefixMatches.length < PYPI_MAX_RESULTS) {
                    prefixMatches.push(names[i]);
                }
            } else if (name.includes(normalized)) {
                if (containsMatches.length < PYPI_MAX_RESULTS) {
                    containsMatches.push(names[i]);
                }
            }
            // Prefix matches alone fill the cap and the exact match is captured;
            // nothing later can change the top-capped, prefix-first view.
            if (prefixMatches.length >= PYPI_MAX_RESULTS && exactName !== undefined) {
                break;
            }
        }

        let results = prefixMatches;
        if (results.length < PYPI_MAX_RESULTS) {
            results = results.concat(containsMatches).slice(0, PYPI_MAX_RESULTS);
        }
        // The exact match always starts with the query, so it belongs in
        // prefixMatches; if it was pushed out by the cap, force it into the last
        // slot so the core layer can still hoist it to the top.
        if (exactName !== undefined && !results.includes(exactName)) {
            results[results.length - 1] = exactName;
        }

        return results.map((name) => ({
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
 * A single distribution file as reported by the PyPI simple API. Both
 * `Requires-Python` and yank status live on the file, not the version.
 */
interface PyPIFile {
    filename: string;
    'requires-python'?: string | null;
    yanked?: boolean | string;
}

/** Per-version view aggregated from a package's files. */
interface VersionFile {
    /** The file's Requires-Python specifier, or null when unconstrained. */
    spec: string | null;
    /** Whether this file is yanked (true, or a string reason, both mean yanked). */
    yanked: boolean;
}

/**
 * Map each file to its version by matching against the authoritative `versions`
 * list. We look for the version as a delimited token (`-{version}` followed by a
 * separator or end) and prefer the longest match, so `pkg-1.0.1.tar.gz` maps to
 * `1.0.1` rather than `1.0`. Files that match no known version are dropped (they
 * cannot affect filtering, which keeps us conservative).
 */
function aggregateFilesByVersion(versions: string[], files: PyPIFile[]): Map<string, VersionFile[]> {
    const longestFirst = [...versions].sort((a, b) => b.length - a.length);
    const byVersion = new Map<string, VersionFile[]>();
    for (const file of files) {
        const lower = file.filename.toLowerCase();
        let matched: string | undefined;
        for (const version of longestFirst) {
            const token = `-${version.toLowerCase()}`;
            const idx = lower.indexOf(token);
            if (idx === -1) {
                continue;
            }
            // The character after the version must be a boundary so that, e.g.,
            // `-1.0` does not match inside `-1.05`.
            // Only `-`, `.`, `+`, or end-of-string count as version boundaries; any
            // other character (notably a digit) is not a boundary, so a short version
            // like `1` cannot spuriously match inside a longer token like `-12.0`.
            // Note: bare numeric-only versions (e.g. "1") are a known minor limitation.
            const after = lower[idx + token.length];
            if (after === undefined || after === '-' || after === '.' || after === '+') {
                matched = version;
                break;
            }
        }
        if (matched === undefined) {
            continue;
        }
        const spec = file['requires-python'] || null;
        const yanked = file.yanked !== undefined && file.yanked !== false;
        const list = byVersion.get(matched) ?? [];
        list.push({ spec, yanked });
        byVersion.set(matched, list);
    }
    return byVersion;
}

/**
 * Search PyPI for available versions of a specific package, filtered to those
 * installable on the active interpreter.
 *
 * Versions are dropped when every file is yanked, or (when `resolveSpecs` is
 * provided) when no non-yanked file's Requires-Python admits the interpreter.
 * Filtering is conservative: any uncertainty (no file data, no resolver, a
 * resolver failure, an unmatched filename) keeps the version visible. The
 * returned list preserves PyPI's original ordering.
 *
 * @param name The package name.
 * @param resolveSpecs Resolves distinct Requires-Python specifiers to whether
 *   the active interpreter satisfies each. When omitted, Requires-Python is not
 *   applied (yank filtering still is).
 * @param token Optional cancellation token.
 */
export async function searchPyPIVersions(
    name: string,
    resolveSpecs?: (specs: string[]) => Promise<Record<string, boolean>>,
    token?: vscode.CancellationToken,
): Promise<string[]> {
    try {
        const response = await fetch(`https://pypi.org/simple/${name}/`, {
            headers: { Accept: 'application/vnd.pypi.simple.v1+json' },
            signal: createAbortSignal(token),
        });
        const json = (await response.json()) as { versions?: string[]; files?: PyPIFile[] };
        const versions = json.versions ?? [];
        const files = json.files ?? [];

        // Without file data there is nothing to filter on; return as-is.
        if (files.length === 0) {
            return versions;
        }

        const byVersion = aggregateFilesByVersion(versions, files);

        // Resolve Requires-Python for the distinct specifiers, best-effort. A
        // resolver failure degrades to yank-only filtering rather than breaking
        // the picker.
        let specResults: Record<string, boolean> | undefined;
        if (resolveSpecs) {
            const distinctSpecs = [
                ...new Set(
                    [...byVersion.values()]
                        .flat()
                        .map((f) => f.spec)
                        .filter((s): s is string => s !== null),
                ),
            ];
            if (distinctSpecs.length === 0) {
                specResults = {};
            } else {
                try {
                    specResults = await resolveSpecs(distinctSpecs);
                } catch {
                    specResults = undefined;
                }
            }
        }

        return versions.filter((version) => {
            const versionFiles = byVersion.get(version);
            if (!versionFiles || versionFiles.length === 0) {
                // No matched files -> keep (conservative).
                return true;
            }
            return versionFiles.some((file) => {
                if (file.yanked) {
                    return false;
                }
                if (!specResults) {
                    // Requires-Python not applied; a non-yanked file is enough.
                    return true;
                }
                return file.spec === null || specResults[file.spec] === true;
            });
        });
    } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
            throw new vscode.CancellationError();
        }
        throw e;
    }
}
