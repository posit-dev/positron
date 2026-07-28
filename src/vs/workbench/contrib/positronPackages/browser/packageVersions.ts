/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as semver from '../../../../base/common/semver/semver.js';

/**
 * Sort version strings in descending order (newest first).
 * Uses semver comparison when possible, falls back to string comparison.
 *
 * This drives the version quick-pick, where the user picks from the whole list,
 * so its ordering is deliberately left as-is. `newestAvailableVersion` does not
 * use it: choosing a version automatically needs the more precise comparison
 * below, because `semver.coerce` truncates anything past three segments.
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
 * Split a version into the parts that decide which of two versions is newer: a
 * PEP 440 epoch, and the numeric groups that follow it.
 *
 * Every numeric group is kept, however many there are, so four-segment versions
 * (`1.2.3.4`) and R patch levels (`1.0-3`) compare on their real values rather
 * than being truncated to three segments. Digits inside a suffix count too,
 * which is what orders `1.0.post1` above `1.0` and `1.0.0rc2` above `1.0.0rc1`.
 */
function releaseKey(version: string): { epoch: number; segments: number[] } {
	const trimmed = version.trim();
	const epochSeparator = trimmed.indexOf('!');
	const epoch = epochSeparator === -1 ? 0 : Number(trimmed.slice(0, epochSeparator)) || 0;
	const release = epochSeparator === -1 ? trimmed : trimmed.slice(epochSeparator + 1);
	const segments = (release.match(/\d+/g) ?? []).map(Number);
	return { epoch, segments };
}

/**
 * Compare two versions, newest first. A higher epoch always wins; otherwise the
 * numeric groups are compared in order, treating a missing group as zero so
 * `1.2` and `1.2.0` are equal. Versions with no digits at all fall back to
 * string comparison.
 */
function compareVersionsDescending(a: string, b: string): number {
	const aKey = releaseKey(a);
	const bKey = releaseKey(b);
	if (aKey.epoch !== bKey.epoch) {
		return bKey.epoch - aKey.epoch;
	}
	const length = Math.max(aKey.segments.length, bKey.segments.length);
	for (let i = 0; i < length; i++) {
		const aSegment = aKey.segments[i] ?? 0;
		const bSegment = bKey.segments[i] ?? 0;
		if (aSegment !== bSegment) {
			return bSegment - aSegment;
		}
	}
	return a < b ? 1 : a > b ? -1 : 0;
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
	const sorted = [...versions].sort(compareVersionsDescending);
	return sorted.find(version => !isPrerelease(version)) ?? sorted.at(0);
}
