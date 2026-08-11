/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as semver from '../../../../base/common/semver/semver.js';

/**
 * Sort version strings in descending order (newest first).
 * Uses semver comparison when possible, falls back to string comparison.
 *
 * This only orders the version quick-pick, where the user picks from the whole
 * list and can see what they chose. Nothing reads the first entry as "the
 * newest version": the runtime answers that, via `latestVersion`.
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
