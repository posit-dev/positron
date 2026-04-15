/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';

const DEFAULT_P3M_URL = 'https://packagemanager.posit.co';
const SEARCH_LIMIT = 50;

function createAbortSignal(
    token?: vscode.CancellationToken,
): AbortSignal | undefined {
    if (!token) {
        return undefined;
    }
    const controller = new AbortController();
    token.onCancellationRequested(() => controller.abort());
    return controller.signal;
}

interface P3MPackageSearchResult {
    name: string;
    version: string;
    info: {
        name: string;
        summary: string | null;
    };
}

interface P3MPackageDetail {
    name: string;
    version: string;
    releases: Record<string, unknown[]>;
    info: {
        summary: string | null;
        license: string | null;
        project_urls: Record<string, string> | null;
    };
}

/**
 * Search P3M for packages matching a query.
 */
export async function searchP3M(
    query: string,
    baseUrl: string = DEFAULT_P3M_URL,
    token?: vscode.CancellationToken,
): Promise<positron.LanguageRuntimePackage[]> {
    const url = `${baseUrl}/__api__/repos/pypi/packages`
        + `?name_like=${encodeURIComponent(query)}`
        + `&exact_first=true`
        + `&_limit=${SEARCH_LIMIT}`;

    try {
        const response = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: createAbortSignal(token),
        });

        if (!response.ok) {
            throw new Error(
                `P3M search failed: ${response.status} ${response.statusText}`
            );
        }

        const results = (await response.json()) as P3MPackageSearchResult[];

        return results.map((pkg) => ({
            id: pkg.name,
            name: pkg.name,
            displayName: pkg.name,
            version: pkg.version,
            description: pkg.info?.summary ?? undefined,
        }));
    } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
            throw new vscode.CancellationError();
        }
        throw e;
    }
}

/**
 * Search P3M for available versions of a specific package.
 */
export async function searchP3MVersions(
    name: string,
    baseUrl: string = DEFAULT_P3M_URL,
    token?: vscode.CancellationToken,
): Promise<string[]> {
    const url =
        `${baseUrl}/__api__/repos/pypi/packages/${encodeURIComponent(name)}`;

    try {
        const response = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: createAbortSignal(token),
        });

        if (!response.ok) {
            throw new Error(
                `P3M version lookup failed: ${response.status} ${response.statusText}`
            );
        }

        const detail = (await response.json()) as P3MPackageDetail;
        return Object.keys(detail.releases);
    } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
            throw new vscode.CancellationError();
        }
        throw e;
    }
}

const MAX_CONCURRENCY = 10;

// Module-level cache: string = description, null = not found on P3M
const descriptionCache = new Map<string, string | null>();

export function clearDescriptionCache(): void {
    descriptionCache.clear();
}

/**
 * Fetch descriptions for a list of package names from P3M.
 * Uses a module-level cache to avoid redundant requests. Null entries in
 * the cache represent packages confirmed absent from P3M (negative cache).
 * Uncached names are fetched with a concurrency limit of 10.
 * Returns a map of package name to description for packages that have one.
 */
export async function fetchP3MDescriptions(
    names: string[],
    baseUrl: string = DEFAULT_P3M_URL,
    token?: vscode.CancellationToken,
): Promise<Map<string, string>> {
    const results = new Map<string, string>();

    // Collect cached hits and identify uncached names
    const uncached: string[] = [];
    for (const name of names) {
        if (descriptionCache.has(name)) {
            const cached = descriptionCache.get(name);
            if (cached !== null) {
                results.set(name, cached!);
            }
            // null = negative cache, skip silently
        } else {
            uncached.push(name);
        }
    }

    if (uncached.length === 0 || token?.isCancellationRequested) {
        return results;
    }

    // Fetch uncached names with concurrency limit
    const signal = createAbortSignal(token);
    let active = 0;
    let index = 0;

    await new Promise<void>((resolve) => {
        const next = () => {
            while (active < MAX_CONCURRENCY && index < uncached.length) {
                if (token?.isCancellationRequested) {
                    if (active === 0) { resolve(); }
                    return;
                }
                const name = uncached[index++];
                active++;
                fetchOne(name, baseUrl, signal).then(
                    (desc) => {
                        if (desc !== undefined) {
                            descriptionCache.set(name, desc);
                            results.set(name, desc);
                        } else {
                            descriptionCache.set(name, null);
                        }
                        active--;
                        if (index >= uncached.length && active === 0) {
                            resolve();
                        } else {
                            next();
                        }
                    },
                );
            }
            if (index >= uncached.length && active === 0) {
                resolve();
            }
        };
        next();
    });

    return results;
}

async function fetchOne(
    name: string,
    baseUrl: string,
    signal?: AbortSignal,
): Promise<string | undefined> {
    try {
        const url = `${baseUrl}/__api__/repos/pypi/packages`
            + `?name=${encodeURIComponent(name)}&_limit=1`;
        const response = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal,
        });
        if (!response.ok) {
            return undefined;
        }
        const data = (await response.json()) as P3MPackageSearchResult[];
        if (data.length > 0 && data[0].info?.summary) {
            return data[0].info.summary;
        }
        return undefined;
    } catch {
        return undefined;
    }
}

export { DEFAULT_P3M_URL };
