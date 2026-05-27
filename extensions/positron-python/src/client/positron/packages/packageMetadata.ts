/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { traceWarn } from '../../logging';

/**
 * Ask the resolver (pip, uv, ...) which packages are outdated and return
 * `latestVersion` for each, keyed by lowercase package name. Each package
 * manager provides its own `getOutdatedVersions` callback that returns a
 * map of lowercased package name to the resolver's `latest_version`. The
 * version comparison happens in the tool that owns PEP 440 semantics
 * (`packaging.version` for pip, `pep440_rs` for uv), not in TypeScript.
 *
 * If `getOutdatedVersions` rejects, the outdated flag is treated as `false`
 * for every package — a transient network failure leaves the list usable.
 */
export async function fetchMetadataWithOutdated(
    packageNames: string[],
    getOutdatedVersions: (token?: vscode.CancellationToken) => Promise<Map<string, string>>,
    token?: vscode.CancellationToken,
): Promise<Map<string, Partial<positron.LanguageRuntimePackage>>> {
    const outdated = await getOutdatedVersions(token).catch((err) => {
        traceWarn(`Failed to fetch outdated package versions: ${err}`);
        return new Map<string, string>();
    });

    const metadata = new Map<string, Partial<positron.LanguageRuntimePackage>>();
    for (const name of packageNames) {
        const key = name.toLowerCase();
        const latestFromResolver = outdated.get(key);
        metadata.set(key, {
            outdated: outdated.has(key),
            ...(latestFromResolver ? { latestVersion: latestFromResolver } : {}),
        });
    }

    return metadata;
}
