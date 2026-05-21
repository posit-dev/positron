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
 * the first compatible entry it encounters. P3M (Positron's default gallery) honors that
 * assumption on both `/vscode/gallery/extensionquery` and `/vscode/gallery/{publisher}/{name}/latest`,
 * so the default install path is correct without this filter.
 *
 * Open VSX, which Positron also supports as a configurable gallery, does not. Despite the name,
 * Open VSX's `/vscode/gallery/{publisher}/{name}/latest` returns every version of the extension
 * in ascending semver order with per-platform variants interleaved. When Positron's resolver
 * consumes that response, the upstream filter picks the OLDEST compatible version instead of
 * the newest (issue #12619). Reproducible as of May 2026 with a single curl against open-vsx.org.
 *
 * (P3M previously had a related ASC-ordering bug on these endpoints, fixed server-side in PPM
 * hotfix 2026.04.2, rstudio/package-manager#17916. Keeping this filter order-invariant also
 * guards against future regressions on either backend.)
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
