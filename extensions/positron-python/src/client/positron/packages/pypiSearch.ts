/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';

/**
 * Create an AbortSignal from a CancellationToken for use with fetch.
 */
function createAbortSignal(token: vscode.CancellationToken): AbortSignal {
    const controller = new AbortController();
    token.onCancellationRequested(() => controller.abort());
    return controller.signal;
}

/**
 * Search PyPI for packages matching a query.
 */
export async function searchPyPI(
    query: string,
    token: vscode.CancellationToken,
): Promise<positron.LanguageRuntimePackage[]> {
    try {
        const response = await fetch('https://pypi.org/simple/', {
            headers: { Accept: 'application/vnd.pypi.simple.v1+json' },
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

/**
 * Search PyPI for available versions of a specific package.
 */
export async function searchPyPIVersions(
    name: string,
    token: vscode.CancellationToken,
): Promise<string[]> {
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
