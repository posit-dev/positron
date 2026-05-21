/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IRawGalleryExtensionVersion } from '../../common/extensionGalleryService.js';
import { filterLatestExtensionVersionsForTargetPlatformPositron } from '../../common/positronGalleryVersionFilter.js';
import { TargetPlatform } from '../../../extensions/common/extensions.js';

function aExtensionVersion(version: string, targetPlatform?: TargetPlatform): IRawGalleryExtensionVersion {
	return { version, targetPlatform } as IRawGalleryExtensionVersion;
}

function aPreReleaseExtensionVersion(version: string, targetPlatform?: TargetPlatform): IRawGalleryExtensionVersion {
	return {
		version,
		targetPlatform,
		properties: [{ key: 'Microsoft.VisualStudio.Code.PreRelease', value: 'true' }]
	} as IRawGalleryExtensionVersion;
}

describe('filterLatestExtensionVersionsForTargetPlatformPositron', () => {

	it('returns an empty array for empty input', () => {
		const result = filterLatestExtensionVersionsForTargetPlatformPositron([], TargetPlatform.WIN32_X64, [TargetPlatform.WIN32_X64]);
		expect(result).toEqual([]);
	});

	it('returns the single version when only one is provided', () => {
		const v = aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64);
		const result = filterLatestExtensionVersionsForTargetPlatformPositron([v], TargetPlatform.WIN32_X64, [TargetPlatform.WIN32_X64]);
		expect(result).toEqual([v]);
	});

	it('picks the newest version when input is ascending (Open VSX shape)', () => {
		// posit.publisher pre-P3M: gallery returned versions ASC, resolver picked oldest.
		const oldest = aExtensionVersion('1.36.0', TargetPlatform.DARWIN_ARM64);
		const middle = aExtensionVersion('1.37.0', TargetPlatform.DARWIN_ARM64);
		const newest = aExtensionVersion('2.7.0', TargetPlatform.DARWIN_ARM64);

		const result = filterLatestExtensionVersionsForTargetPlatformPositron(
			[oldest, middle, newest],
			TargetPlatform.DARWIN_ARM64,
			[TargetPlatform.DARWIN_ARM64]
		);

		expect(result).toEqual([newest]);
	});

	it('picks the newest version when input is descending (Marketplace shape)', () => {
		const newest = aExtensionVersion('2.7.0', TargetPlatform.WIN32_X64);
		const middle = aExtensionVersion('1.37.0', TargetPlatform.WIN32_X64);
		const oldest = aExtensionVersion('1.36.0', TargetPlatform.WIN32_X64);

		const result = filterLatestExtensionVersionsForTargetPlatformPositron(
			[newest, middle, oldest],
			TargetPlatform.WIN32_X64,
			[TargetPlatform.WIN32_X64]
		);

		expect(result).toEqual([newest]);
	});

	it('includes the highest compatible release and highest compatible pre-release', () => {
		const release = aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64);
		const prerelease = aPreReleaseExtensionVersion('1.1.0', TargetPlatform.WIN32_X64);

		const result = filterLatestExtensionVersionsForTargetPlatformPositron(
			[prerelease, release],
			TargetPlatform.WIN32_X64,
			[TargetPlatform.WIN32_X64]
		);

		expect(result).toContain(release);
		expect(result).toContain(prerelease);
		expect(result).toHaveLength(2);
	});

	it('prefers exact platform match over universal at the same semver', () => {
		const universal = aExtensionVersion('1.0.0');
		const exact = aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64);

		const result = filterLatestExtensionVersionsForTargetPlatformPositron(
			[universal, exact],
			TargetPlatform.WIN32_X64,
			[TargetPlatform.WIN32_X64]
		);

		expect(result).toEqual([exact]);
	});

	it('prefers higher semver universal over lower semver platform-specific', () => {
		const universal = aExtensionVersion('2.0.0');
		const exact = aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64);

		const result = filterLatestExtensionVersionsForTargetPlatformPositron(
			[exact, universal],
			TargetPlatform.WIN32_X64,
			[TargetPlatform.WIN32_X64]
		);

		expect(result).toEqual([universal]);
	});

	it('picks the newest platform-specific when later versions drop universal', () => {
		// An extension may ship a universal VSIX for a while and then transition to per-platform
		// builds. The resolver must pick the newest per-platform version compatible with the
		// target, not regress to the last universal.
		const lastUniversal = aExtensionVersion('2.1.89', TargetPlatform.UNIVERSAL);
		const newerLinux = aExtensionVersion('2.1.90', TargetPlatform.LINUX_X64);
		const newerDarwin = aExtensionVersion('2.1.90', TargetPlatform.DARWIN_X64);
		const newestLinux = aExtensionVersion('2.1.139', TargetPlatform.LINUX_X64);
		const newestDarwin = aExtensionVersion('2.1.139', TargetPlatform.DARWIN_X64);

		const result = filterLatestExtensionVersionsForTargetPlatformPositron(
			[lastUniversal, newerLinux, newerDarwin, newestLinux, newestDarwin],
			TargetPlatform.LINUX_X64,
			[TargetPlatform.LINUX_X64, TargetPlatform.DARWIN_X64]
		);

		expect(result).toContain(newestLinux);
		expect(result).not.toContain(lastUniversal);
		expect(result).not.toContain(newerLinux);
	});

	it('always includes non-compatible platform versions unchanged', () => {
		const compat = aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64);
		const otherPlatform = aExtensionVersion('1.0.0', TargetPlatform.DARWIN_X64);

		const result = filterLatestExtensionVersionsForTargetPlatformPositron(
			[compat, otherPlatform],
			TargetPlatform.WIN32_X64,
			[TargetPlatform.WIN32_X64, TargetPlatform.DARWIN_X64]
		);

		expect(result).toContain(compat);
		expect(result).toContain(otherPlatform);
	});

	it('produces the same result regardless of input order', () => {
		const v1 = aExtensionVersion('1.0.0', TargetPlatform.WIN32_X64);
		const v2 = aExtensionVersion('2.0.0');
		const v3 = aExtensionVersion('2.0.0', TargetPlatform.WIN32_X64);
		const v4 = aPreReleaseExtensionVersion('2.1.0', TargetPlatform.WIN32_X64);
		const v5 = aPreReleaseExtensionVersion('2.1.0');
		const v6 = aExtensionVersion('1.5.0', TargetPlatform.DARWIN_X64); // non-compatible
		const allTargetPlatforms = [TargetPlatform.WIN32_X64, TargetPlatform.DARWIN_X64];

		const ascending = filterLatestExtensionVersionsForTargetPlatformPositron(
			[v1, v6, v2, v3, v5, v4],
			TargetPlatform.WIN32_X64,
			allTargetPlatforms
		);
		const descending = filterLatestExtensionVersionsForTargetPlatformPositron(
			[v4, v5, v3, v2, v6, v1],
			TargetPlatform.WIN32_X64,
			allTargetPlatforms
		);
		const shuffled = filterLatestExtensionVersionsForTargetPlatformPositron(
			[v3, v1, v5, v6, v4, v2],
			TargetPlatform.WIN32_X64,
			allTargetPlatforms
		);

		// Expected pick: 2.0.0 WIN (exact match beats universal at same semver),
		//                2.1.0 WIN (same rule for pre-release),
		//                plus the non-compatible DARWIN entry.
		const expected = new Set([v3, v4, v6]);
		expect(new Set(ascending)).toEqual(expected);
		expect(new Set(descending)).toEqual(expected);
		expect(new Set(shuffled)).toEqual(expected);
	});
});
