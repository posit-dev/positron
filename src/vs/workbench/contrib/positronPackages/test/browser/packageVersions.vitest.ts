/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { newestAvailableVersion, sortVersionsDescending } from '../../browser/packageVersions.js';

describe('sortVersionsDescending', () => {
	it('sorts newest first, using semver rather than string ordering', () => {
		expect(sortVersionsDescending(['1.1.2', '1.1.10', '1.1.4'])).toEqual(['1.1.10', '1.1.4', '1.1.2']);
	});

	it('sorts two-component versions numerically', () => {
		expect(sortVersionsDescending(['2.0', '2.1', '2.10'])).toEqual(['2.10', '2.1', '2.0']);
	});

	it('ranks a prerelease below the matching stable release', () => {
		expect(sortVersionsDescending(['1.26.4', '2.0.0rc1', '2.0.0'])).toEqual(['2.0.0', '2.0.0rc1', '1.26.4']);
	});

	it('handles the single-version and empty lists that R returns', () => {
		expect({ single: sortVersionsDescending(['1.1.4']), empty: sortVersionsDescending([]) })
			.toEqual({ single: ['1.1.4'], empty: [] });
	});

	it('falls back to string comparison when neither version parses', () => {
		expect(sortVersionsDescending(['alpha', 'beta'])).toEqual(['beta', 'alpha']);
	});

	it('does not mutate its input', () => {
		const versions = ['1.0.0', '2.0.0'];
		sortVersionsDescending(versions);
		expect(versions).toEqual(['1.0.0', '2.0.0']);
	});

	// Versions that differ only by a suffix semver.coerce drops compare equal, so
	// the backend's own ordering decides. Pinned as current behavior, not as the
	// ideal: R patch levels are moot because R returns a single version, and PyPI
	// post-releases are rare.
	it('cannot separate versions that differ only by a coerce-dropped suffix', () => {
		expect({
			rPatchLevel: sortVersionsDescending(['1.0-3', '1.0-10']),
			pypiPostRelease: sortVersionsDescending(['1.0', '1.0.post1']),
		}).toEqual({
			rPatchLevel: ['1.0-3', '1.0-10'],
			pypiPostRelease: ['1.0', '1.0.post1'],
		});
	});
});

describe('newestAvailableVersion', () => {
	it('prefers the newest stable release over a newer prerelease', () => {
		// What `pip install <name>` would resolve to for this version list.
		expect(newestAvailableVersion(['1.8', '1.9', '2.0.0rc1'])).toBe('1.9');
	});

	it('picks the newest version when all of them are stable', () => {
		expect(newestAvailableVersion(['1.1.2', '1.1.10', '1.1.4'])).toBe('1.1.10');
	});

	it('takes PyPI ascending order into account', () => {
		expect(newestAvailableVersion(['1.26.4', '2.0.0', '2.1.3'])).toBe('2.1.3');
	});

	it('falls back to the newest prerelease when a package has only prereleases', () => {
		expect(newestAvailableVersion(['1.0.0rc1', '1.0.0rc2'])).toBe('1.0.0rc2');
	});

	// semver alone does not catch these: `semver.valid` rejects two-component
	// versions and `semver.coerce` then drops the suffix, so `1.0a2` would read
	// as the stable `1.0.0` and be installed over the older stable release.
	it('skips every prerelease spelling in favor of an older stable release', () => {
		expect({
			threeComponentRc: newestAvailableVersion(['1.9', '2.0.0rc1']),
			threeComponentAlpha: newestAvailableVersion(['1.9.0', '2.0.0a2']),
			threeComponentBeta: newestAvailableVersion(['1.9.0', '2.0.0b1']),
			twoComponentAlpha: newestAvailableVersion(['0.9', '1.0a2']),
			twoComponentBeta: newestAvailableVersion(['1.9', '2.0b1']),
			dottedDev: newestAvailableVersion(['0.9.0', '1.0.0.dev1']),
			runTogetherDev: newestAvailableVersion(['0.9.0', '1.0.0dev1']),
			semverDotted: newestAvailableVersion(['1.9.0', '2.0.0-rc.1']),
			spelledAlpha: newestAvailableVersion(['1.9.0', '3.0.0alpha1']),
			pep440C: newestAvailableVersion(['0.9', '1.0c1']),
		}).toEqual({
			threeComponentRc: '1.9',
			threeComponentAlpha: '1.9.0',
			threeComponentBeta: '1.9.0',
			twoComponentAlpha: '0.9',
			twoComponentBeta: '1.9',
			dottedDev: '0.9.0',
			runTogetherDev: '0.9.0',
			semverDotted: '1.9.0',
			spelledAlpha: '1.9.0',
			pep440C: '0.9',
		});
	});

	// A post-release is newer than the release it follows, and R's patch level is
	// not a prerelease at all, so neither may be skipped.
	it('does not mistake post-releases or R patch levels for prereleases', () => {
		expect({
			postRelease: newestAvailableVersion(['1.0.post1']),
			rPatchLevel: newestAvailableVersion(['1.0-3']),
			calendarVersion: newestAvailableVersion(['2024.1.1']),
		}).toEqual({
			postRelease: '1.0.post1',
			rPatchLevel: '1.0-3',
			calendarVersion: '2024.1.1',
		});
	});

	// conda's letter-suffixed builds have no trailing digits, so the suffix check
	// passes them through, but semver reads `1.1.1c` as the prerelease `1.1.1-c`
	// and it loses to plain `1.1.1`. Rare and low-stakes: the fallback still
	// returns it when it is the only version.
	it('prefers a plain release over a conda letter-suffixed build', () => {
		expect({
			alongsidePlain: newestAvailableVersion(['1.1.1', '1.1.1c']),
			onItsOwn: newestAvailableVersion(['1.1.1c']),
		}).toEqual({
			alongsidePlain: '1.1.1',
			onItsOwn: '1.1.1c',
		});
	});

	it('returns the only version R reports', () => {
		expect(newestAvailableVersion(['1.1.4'])).toBe('1.1.4');
	});

	it('returns undefined when no versions are available', () => {
		expect(newestAvailableVersion([])).toBeUndefined();
	});
});
