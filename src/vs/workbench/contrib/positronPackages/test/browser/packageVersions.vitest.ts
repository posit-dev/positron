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

	it('returns the only version R reports', () => {
		expect(newestAvailableVersion(['1.1.4'])).toBe('1.1.4');
	});

	it('returns undefined when no versions are available', () => {
		expect(newestAvailableVersion([])).toBeUndefined();
	});
});
