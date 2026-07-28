/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as semver from '../../../../base/common/semver/semver.js';

/**
 * Sort version strings in descending order (newest first).
 * Uses semver comparison when possible, falls back to string comparison.
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

/**
 * Pick the version to use when the caller asked for the newest available one.
 *
 * Prefers the newest stable release over a newer prerelease, matching what the
 * package managers install by default: with versions 1.8, 1.9 and 2.0.0rc1,
 * `pip install <name>` installs 1.9, not the release candidate.
 *
 * Backends disagree on ordering -- R returns a single version, PyPI returns
 * ascending order and does not filter prereleases, conda returns newest-first --
 * so the list is sorted here rather than trusted.
 *
 * Falls back to the newest of everything when a package has published only
 * prereleases, so a caller always gets a version if one exists.
 */
export function newestAvailableVersion(versions: string[]): string | undefined {
	const sorted = sortVersionsDescending(versions);
	const stable = sorted.find(version => {
		const parsed = semver.valid(version, true) || semver.coerce(version);
		return parsed ? !semver.prerelease(parsed, true) : true;
	});
	return stable ?? sorted.at(0);
}
