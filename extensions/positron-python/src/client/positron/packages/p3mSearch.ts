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

export { DEFAULT_P3M_URL };
