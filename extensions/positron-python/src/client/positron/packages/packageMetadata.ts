/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { fetchP3MPackageMetadata } from './p3mSearch';

/**
 * Fetch P3M metadata and outdated-package info in parallel, then merge them
 * into a single map keyed by lowercase package name. Each package manager
 * (pip, uv, ...) provides its own `getOutdatedVersions` callback that returns
 * a map of lowercased package name to the resolver's `latest_version`. The
 * version comparison happens in the tool that owns PEP 440 semantics
 * (`packaging.version` for pip, `pep440_rs` for uv), not in TypeScript.
 *
 * The resolver's `latest_version` overrides P3M's `latestVersion` — pip/uv
 * are the authoritative source because they query the same index used to
 * install, honor any pinned mirror, and reflect what an upgrade would
 * actually fetch. P3M is still useful for license and publication date, and
 * as a fallback when the package is not outdated.
 *
 * If `getOutdatedVersions` rejects, the outdated flag is treated as `false`
 * for every package — a transient network failure leaves the list usable.
 */
export async function fetchMetadataWithOutdated(
    packageNames: string[],
    getOutdatedVersions: (token?: vscode.CancellationToken) => Promise<Map<string, string>>,
    token?: vscode.CancellationToken,
): Promise<Map<string, Partial<positron.LanguageRuntimePackage>>> {
    const [p3mMetadata, outdated] = await Promise.all([
        fetchP3MPackageMetadata(packageNames, token),
        getOutdatedVersions(token).catch(() => new Map<string, string>()),
    ]);

    for (const name of packageNames) {
        const key = name.toLowerCase();
        const existing = p3mMetadata.get(key) ?? {};
        const latestFromResolver = outdated.get(key);
        p3mMetadata.set(key, {
            ...existing,
            outdated: outdated.has(key),
            ...(latestFromResolver ? { latestVersion: latestFromResolver } : {}),
        });
    }

    return p3mMetadata;
}
