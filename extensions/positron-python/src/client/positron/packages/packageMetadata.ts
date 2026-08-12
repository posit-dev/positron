/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { traceWarn } from '../../logging';

/**
 * Ask the resolver (pip, uv, ...) which packages are outdated and return
 * `latestVersion` for each, keyed by lowercase package name, plus known
 * security advisories from the optional `getVulnerabilities` callback. Each
 * package manager provides its own `getOutdatedVersions` callback that
 * returns a map of lowercased package name to the resolver's
 * `latest_version`. The version comparison happens in the tool that owns
 * PEP 440 semantics (`packaging.version` for pip, `pep440_rs` for uv), not
 * in TypeScript.
 *
 * If `getOutdatedVersions` rejects, the outdated flag is treated as `false`
 * for every package — a transient network failure leaves the list usable.
 * A package absent from the vulnerabilities map is *unknown* to the
 * repository at its installed version (or no PPM is configured); its
 * `vulnerabilities` field stays undefined rather than claiming it's clean.
 */
export async function fetchMetadataWithOutdated(
	packages: positron.PackageSpec[],
	getOutdatedVersions: (token?: vscode.CancellationToken) => Promise<Map<string, string>>,
	getVulnerabilities?: (
		token?: vscode.CancellationToken,
	) => Promise<Map<string, positron.PackageVulnerability[]> | undefined>,
	token?: vscode.CancellationToken,
): Promise<Map<string, Partial<positron.LanguageRuntimePackage>>> {
	const [outdated, vulnerabilities] = await Promise.all([
		getOutdatedVersions(token).catch((err) => {
			traceWarn(`Failed to fetch outdated package versions: ${err}`);
			return new Map<string, string>();
		}),
		getVulnerabilities ? getVulnerabilities(token) : Promise.resolve(undefined),
	]);

	const metadata = new Map<string, Partial<positron.LanguageRuntimePackage>>();
	for (const pkg of packages) {
		const key = pkg.name.toLowerCase();
		const latestFromResolver = outdated.get(key);
		const packageVulnerabilities = vulnerabilities?.get(key);
		metadata.set(key, {
			outdated: outdated.has(key),
			...(latestFromResolver ? { latestVersion: latestFromResolver } : {}),
			...(packageVulnerabilities ? { vulnerabilities: packageVulnerabilities } : {}),
		});
	}

	return metadata;
}
