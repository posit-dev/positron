/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';

const DEFAULT_P3M_URL = 'https://packagemanager.posit.co';
const PYPI_REPO = 'pypi';
const SEARCH_LIMIT = 100;

function getP3MBaseUrl(): string {
    const config = vscode.workspace.getConfiguration('positron.python');
    return config.get<string>('packageManagerUrl', DEFAULT_P3M_URL);
}

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

interface P3MPackageListItem {
    name: string;
    version: string;
    summary?: string;
}

interface P3MPackageDetail {
    name: string;
    info?: {
        version?: string;
        summary?: string;
    };
    releases?: Record<string, unknown[]>;
}

/**
 * Search P3M for Python packages matching a query.
 * Falls back to PyPI Simple API if P3M is unavailable.
 */
export async function searchP3M(
    query: string,
    token?: vscode.CancellationToken,
): Promise<positron.LanguageRuntimePackage[]> {
    try {
        return await searchP3MApi(query, token);
    } catch (e) {
        if (e instanceof vscode.CancellationError) {
            throw e;
        }
        return searchPyPIFallback(query, token);
    }
}

async function searchP3MApi(
    query: string,
    token?: vscode.CancellationToken,
): Promise<positron.LanguageRuntimePackage[]> {
    const baseUrl = getP3MBaseUrl();
    const params = new URLSearchParams({
        name_like: query,
        _limit: String(SEARCH_LIMIT),
    });
    const url = baseUrl + '/__api__/repos/' + PYPI_REPO + '/packages?' + params.toString();

    const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: createAbortSignal(token),
    });

    if (!response.ok) {
        throw new Error('P3M search failed: ' + response.status);
    }

    const packages = (await response.json()) as P3MPackageListItem[];

    return packages.map((pkg) => ({
        id: pkg.name,
        name: pkg.name,
        displayName: pkg.name,
        version: pkg.version ?? '0',
    }));
}

/**
 * Search P3M for available versions of a specific Python package.
 * Falls back to PyPI Simple API if P3M is unavailable.
 */
export async function searchP3MVersions(
    name: string,
    token?: vscode.CancellationToken,
): Promise<string[]> {
    try {
        return await searchP3MVersionsApi(name, token);
    } catch (e) {
        if (e instanceof vscode.CancellationError) {
            throw e;
        }
        return searchPyPIVersionsFallback(name, token);
    }
}

async function searchP3MVersionsApi(
    name: string,
    token?: vscode.CancellationToken,
): Promise<string[]> {
    const baseUrl = getP3MBaseUrl();
    const url = baseUrl + '/__api__/repos/' + PYPI_REPO + '/packages/' + encodeURIComponent(name);

    const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: createAbortSignal(token),
    });

    if (!response.ok) {
        throw new Error('P3M version lookup failed: ' + response.status);
    }

    const pkg = (await response.json()) as P3MPackageDetail;

    if (pkg.releases) {
        return Object.keys(pkg.releases);
    }

    const version = pkg.info?.version;
    return version ? [version] : [];
}

// PyPI Simple API fallbacks

async function searchPyPIFallback(
    query: string,
    token?: vscode.CancellationToken,
): Promise<positron.LanguageRuntimePackage[]> {
    try {
        const response = await fetch('https://pypi.org/simple/', {
            headers: {
                Accept: 'application/vnd.pypi.simple.v1+json',
            },
            signal: createAbortSignal(token),
        });
        const json = (await response.json()) as {
            projects: { name: string }[];
        };

        return json.projects
            .map((x) => x.name)
            .filter((x) => x.includes(query))
            .map((x) => ({
                id: x,
                name: x,
                displayName: x,
                version: '0',
            }));
    } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
            throw new vscode.CancellationError();
        }
        throw e;
    }
}

async function searchPyPIVersionsFallback(
    name: string,
    token?: vscode.CancellationToken,
): Promise<string[]> {
    try {
        const response = await fetch(
            'https://pypi.org/simple/' + name + '/',
            {
                headers: {
                    Accept: 'application/vnd.pypi.simple.v1+json',
                },
                signal: createAbortSignal(token),
            },
        );
        const json = (await response.json()) as { versions: string[] };
        return json.versions;
    } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
            throw new vscode.CancellationError();
        }
        throw e;
    }
}
