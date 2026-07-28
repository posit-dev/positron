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
 * Prerelease and development suffixes, as PEP 440 and semver spell them:
 * `2.0.0rc1`, `1.0a2`, `2.0.0-rc.1`, `1.0.0.dev1`, `3.0.0alpha1`.
 *
 * A trailing digit group is required, which is what keeps three things that only
 * look similar out: conda's letter-suffixed builds (`1.1.1c`), R's patch levels
 * (`1.0-3`), and PEP 440 post-releases (`1.0.post1`, which is *newer* than
 * `1.0`, not a prerelease).
 */
const PRERELEASE_SUFFIX = /[-_.]?(?:a|b|c|rc|alpha|beta|pre|preview|dev)[-_.]?\d+$/i;

/**
 * Whether a version string names a prerelease.
 *
 * The string is tested directly as well as through semver, because semver alone
 * is not enough: `semver.valid` rejects two-component versions like `1.0a2` and
 * `2.0b1`, and `semver.coerce` then drops the suffix, so they would read as the
 * stable `1.0.0` and `2.0.0`.
 */
function isPrerelease(version: string): boolean {
	const trimmed = version.trim();
	if (PRERELEASE_SUFFIX.test(trimmed)) {
		return true;
	}
	const parsed = semver.valid(trimmed, true) || semver.coerce(trimmed);
	return parsed ? !!semver.prerelease(parsed, true) : false;
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
	return sorted.find(version => !isPrerelease(version)) ?? sorted.at(0);
}
