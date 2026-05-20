/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as semver from '../../../base/common/semver/semver.js';
import { TargetPlatform } from '../../extensions/common/extensions.js';
import { isTargetPlatformCompatible, toTargetPlatform } from './extensionManagement.js';
import { IRawGalleryExtensionVersion } from './extensionGalleryService.js';

const PRE_RELEASE_PROPERTY = 'Microsoft.VisualStudio.Code.PreRelease';

function getTargetPlatformForExtensionVersion(version: IRawGalleryExtensionVersion): TargetPlatform {
	return version.targetPlatform ? toTargetPlatform(version.targetPlatform) : TargetPlatform.UNDEFINED;
}

function isPreReleaseVersion(version: IRawGalleryExtensionVersion): boolean {
	const value = version.properties?.find(p => p.key === PRE_RELEASE_PROPERTY)?.value;
	return value === 'true';
}

/**
 * Positron replacement for the upstream `filterLatestExtensionVersionsForTargetPlatform`.
 *
 * The upstream implementation assumes the input is sorted by version descending and picks
 * the first compatible entry it encounters. That assumption holds for the Microsoft Marketplace
 * but not for Open VSX or Posit Public Package Manager (P3M), which have historically returned
 * versions in ascending order. When the assumption is violated, the resolver picks the OLDEST
 * compatible version instead of the newest (issue #12619).
 *
 * This implementation is order-invariant: the result is the same regardless of how the input
 * array is ordered. The returned list contains:
 *
 * 1. All versions that are NOT compatible with the target platform (preserved for downstream
 *    consumers that compute supported-platform metadata).
 * 2. At most one compatible release version: the highest semver. If two compatible releases share
 *    the same version, the one whose target platform exactly matches `targetPlatform` is preferred
 *    over a universal/undefined entry.
 * 3. At most one compatible pre-release version, selected by the same rule.
 *
 * @param versions - Array of extension versions in any order
 * @param targetPlatform - The target platform to filter for (e.g., LINUX_X64, WIN32_X64)
 * @param allTargetPlatforms - All target platforms the extension supports
 * @returns Filtered array of versions relevant for the target platform
 */
export function filterLatestExtensionVersionsForTargetPlatformPositron(versions: IRawGalleryExtensionVersion[], targetPlatform: TargetPlatform, allTargetPlatforms: TargetPlatform[]): IRawGalleryExtensionVersion[] {
	const latestVersions: IRawGalleryExtensionVersion[] = [];
	let bestRelease: IRawGalleryExtensionVersion | undefined;
	let bestPreRelease: IRawGalleryExtensionVersion | undefined;

	const isBetter = (candidate: IRawGalleryExtensionVersion, current: IRawGalleryExtensionVersion): boolean => {
		if (semver.gt(candidate.version, current.version)) {
			return true;
		}
		if (semver.gt(current.version, candidate.version)) {
			return false;
		}
		const candidateExactMatch = getTargetPlatformForExtensionVersion(candidate) === targetPlatform;
		const currentExactMatch = getTargetPlatformForExtensionVersion(current) === targetPlatform;
		return candidateExactMatch && !currentExactMatch;
	};

	for (const version of versions) {
		const versionTargetPlatform = getTargetPlatformForExtensionVersion(version);
		const isCompatibleWithTargetPlatform = isTargetPlatformCompatible(versionTargetPlatform, allTargetPlatforms, targetPlatform);

		if (!isCompatibleWithTargetPlatform) {
			latestVersions.push(version);
			continue;
		}

		if (isPreReleaseVersion(version)) {
			if (!bestPreRelease || isBetter(version, bestPreRelease)) {
				bestPreRelease = version;
			}
		} else {
			if (!bestRelease || isBetter(version, bestRelease)) {
				bestRelease = version;
			}
		}
	}

	if (bestRelease) {
		latestVersions.push(bestRelease);
	}
	if (bestPreRelease) {
		latestVersions.push(bestPreRelease);
	}

	return latestVersions;
}
