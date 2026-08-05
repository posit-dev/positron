/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as semver from '../../../../base/common/semver/semver.js';

/**
 * Sort version strings in descending order (newest first).
 * Uses semver comparison when possible, falls back to string comparison.
 *
 * This only orders the version quick-pick, where the user reads the whole list
 * and picks from it. Nothing here decides which version to install: that answer
 * comes from the session, through `resolveInstallVersion`, because only the tool
 * doing the installing knows its own rules about version numbers.
 *
 * `semver.coerce` truncates anything past three segments, so versions that
 * differ only after that point can land in either order.
 */
export function sortVersionsDescending(versions: string[]): string[] {
	return [...versions].sort((a, b) => {
		const aSemver = semver.valid(a, true) ? a : semver.coerce(a);
		const bSemver = semver.valid(b, true) ? b : semver.coerce(b);

		if (aSemver && bSemver) {
			return semver.rcompare(aSemver, bSemver, true);
		}

		// Fall back to simple string comparison
		return a < b ? 1 : a > b ? -1 : 0;
	});
}
