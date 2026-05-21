/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { fetchP3MPackageMetadata } from './p3mSearch';

/**
 * Fetch P3M metadata and an outdated-package set in parallel, then merge them
 * into a single map keyed by lowercase package name. Each package manager
 * (pip, uv, ...) provides its own `getOutdatedNames` callback so the version
 * comparison happens in the tool that owns PEP 440 semantics
 * (`packaging.version` for pip, `pep440_rs` for uv), not in TypeScript.
 *
 * If `getOutdatedNames` rejects, the outdated flag is treated as `false` for
 * every package — a transient network failure leaves the list usable.
 */
export async function fetchMetadataWithOutdated(
    packageNames: string[],
    getOutdatedNames: (token?: vscode.CancellationToken) => Promise<Set<string>>,
    token?: vscode.CancellationToken,
): Promise<Map<string, Partial<positron.LanguageRuntimePackage>>> {
    const [p3mMetadata, outdated] = await Promise.all([
        fetchP3MPackageMetadata(packageNames, token),
        getOutdatedNames(token).catch(() => new Set<string>()),
    ]);

    for (const name of packageNames) {
        const key = name.toLowerCase();
        const existing = p3mMetadata.get(key) ?? {};
        p3mMetadata.set(key, { ...existing, outdated: outdated.has(key) });
    }

    return p3mMetadata;
}
