/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Normalize the version an agent passes to `positronPackages.updatePackage`.
 * The agent uses `'latest'` for "the newest available version"; the packages
 * service treats an undefined version the same way, so map it here.
 */
export function normalizeAgentTargetVersion(version: string | undefined): string | undefined {
	return version === 'latest' ? undefined : version;
}
