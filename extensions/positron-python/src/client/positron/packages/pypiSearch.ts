/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';

/**
 * Search PyPI for packages matching a query.
 */
export async function searchPyPI(query: string): Promise<positron.LanguageRuntimePackage[]> {
    const response = await fetch('https://pypi.org/simple/', {
        headers: { Accept: 'application/vnd.pypi.simple.v1+json' },
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
}

/**
 * Search PyPI for available versions of a specific package.
 */
export async function searchPyPIVersions(name: string): Promise<string[]> {
    const response = await fetch(`https://pypi.org/simple/${name}/`, {
        headers: { Accept: 'application/vnd.pypi.simple.v1+json' },
    });
    const json = (await response.json()) as { versions: string[] };
    return json.versions;
}
