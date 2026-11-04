/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { satisfies, validRange } from '../../../base/common/semver/semver.js';

/**
 * Version logic shared by the nightly bootstrap extension scripts
 * (scripts/check-bootstrap-extension-versions.ts and
 * scripts/check-bootstrap-extension-deps.ts). Those scripts are CommonJS and
 * load this module with require(esm), so it must not import from the
 * workbench or use `nls`.
 */

/**
 * Platforms a bootstrap extension must have a build for before the nightly may
 * bump it. BUILD_TARGETS in build/gulpfile.vscode.ts also lists linux-armhf;
 * it is left out so an armhf-only gap does not hold a bump back.
 */
export const POSITRON_TARGET_PLATFORMS: readonly string[] = [
	'win32-x64',
	'win32-arm64',
	'darwin-x64',
	'darwin-arm64',
	'linux-x64',
	'linux-arm64'
];

// Gallery version property keys. Mirrors PropertyType in
// extensionGalleryService.ts, which that module does not export.
const ENGINE_PROPERTY = 'Microsoft.VisualStudio.Code.Engine';
const PRE_RELEASE_PROPERTY = 'Microsoft.VisualStudio.Code.PreRelease';

// SemVer 2.0 precedence. This is the shared contract with semver_key in
// scripts/update-extensions.sh; keep the two in step.
//
// Prerelease identifiers cannot be discarded: p3m serves versions such as
// debugpy's 2024.11.0-dev with "pre_release": false, so they survive the stable
// filter and reach this comparator. Stripping the suffix would make
// 2024.11.0-dev and 2024.11.0 compare equal and let a -dev build win the
// published_at tiebreak and get pinned. Build metadata is ignored per spec, and
// must be stripped before the core is parsed or "3+linux" reads as 0 and
// silently lowers the version.
//
// The core is normalised to a fixed width so 1.2 and 1.2.0 compare equal in
// both implementations rather than differing on array length.
const CORE_SEGMENTS = 4;

export function splitVersion(version: string): { core: number[]; prerelease: string[] } {
	const [core, ...prerelease] = version.split('+')[0].split('-');
	const parts = core.split('.').map(part => Number(part) || 0);
	return {
		core: Array.from({ length: CORE_SEGMENTS }, (_, i) => parts[i] ?? 0),
		prerelease: prerelease.length > 0 ? prerelease.join('-').split('.') : []
	};
}

// Numeric identifiers compare numerically and rank below alphanumeric ones; a
// smaller set of identifiers ranks lower when all preceding ones match.
function comparePrerelease(a: string[], b: string[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const left = a[i];
		const right = b[i];
		if (left === undefined) {
			return -1;
		}
		if (right === undefined) {
			return 1;
		}
		const leftNumeric = /^\d+$/.test(left);
		const rightNumeric = /^\d+$/.test(right);
		if (leftNumeric !== rightNumeric) {
			return leftNumeric ? -1 : 1;
		}
		if (leftNumeric) {
			const diff = Number(left) - Number(right);
			if (diff !== 0) {
				return diff;
			}
		} else if (left !== right) {
			return left < right ? -1 : 1;
		}
	}
	return 0;
}

export function compareSemver(a: string, b: string): number {
	const left = splitVersion(a);
	const right = splitVersion(b);
	for (let i = 0; i < CORE_SEGMENTS; i++) {
		const diff = left.core[i] - right.core[i];
		if (diff !== 0) {
			return diff;
		}
	}
	// A release outranks any prerelease of the same core version.
	if (left.prerelease.length === 0 || right.prerelease.length === 0) {
		return (right.prerelease.length === 0 ? 0 : 1) - (left.prerelease.length === 0 ? 0 : 1);
	}
	return comparePrerelease(left.prerelease, right.prerelease);
}

/**
 * Whether a version string carries no prerelease suffix. p3m's pre-release flag
 * is not trustworthy on its own (debugpy's 2024.11.0-dev is served without
 * it), so callers check both.
 */
export function isStableVersion(version: string): boolean {
	return splitVersion(version).prerelease.length === 0;
}

/**
 * The highest candidate by semver precedence. Candidates are expected to be
 * filtered already; `tieBreak` orders exact semver ties.
 */
export function selectLatestVersion<T extends { readonly version: string }>(
	candidates: readonly T[],
	tieBreak: (a: T, b: T) => number = () => 0
): T | undefined {
	return candidates
		.slice()
		.sort((a, b) => compareSemver(b.version, a.version) || tieBreak(a, b))[0];
}

/**
 * One entry of `versions[]` in a gallery extensionquery response. A
 * platform-specific extension has one entry per version per platform.
 */
export interface IGalleryVersion {
	readonly version: string;
	readonly targetPlatform?: string;
	readonly properties?: readonly { readonly key: string; readonly value: string }[];
}

export type BootstrapVersionDecision = 'current' | 'bump' | 'hold';

export interface IBootstrapVersionResult {
	readonly id: string;
	readonly pinned: string;
	readonly latest: string;
	readonly decision: BootstrapVersionDecision;
	readonly reason?: string;
}

export interface IBootstrapVersionCheck {
	readonly result: IBootstrapVersionResult;
	readonly warnings: string[];
}

interface IPublishedVersion {
	readonly version: string;
	readonly platforms: Set<string>;
	engine: string;
	preRelease: boolean;
}

function getProperty(entry: IGalleryVersion, key: string): string | undefined {
	return entry.properties?.find(p => p.key === key)?.value;
}

function groupByVersion(versions: readonly IGalleryVersion[]): IPublishedVersion[] {
	const byVersion = new Map<string, IPublishedVersion>();
	for (const entry of versions) {
		if (typeof entry.version !== 'string' || entry.version.length === 0) {
			continue;
		}
		let group = byVersion.get(entry.version);
		if (!group) {
			group = { version: entry.version, platforms: new Set(), engine: '', preRelease: false };
			byVersion.set(entry.version, group);
		}
		group.platforms.add(entry.targetPlatform || 'universal');
		group.engine ||= getProperty(entry, ENGINE_PROPERTY) ?? '';
		group.preRelease ||= getProperty(entry, PRE_RELEASE_PROPERTY) === 'true';
	}
	return Array.from(byVersion.values());
}

/**
 * Decides whether the nightly may bump a bootstrap extension, from the raw
 * gallery version list: the newest stable version whose engine range
 * `engineVersion` satisfies is a `bump` when it has a build for every required
 * platform, a `hold` when some are missing, and `current` when it is not
 * newer than the pin.
 */
export function checkBootstrapExtensionVersion(
	id: string,
	pinned: string,
	versions: readonly IGalleryVersion[],
	engineVersion: string,
	requiredPlatforms: readonly string[] = POSITRON_TARGET_PLATFORMS
): IBootstrapVersionCheck {
	const warnings: string[] = [];
	const candidates = groupByVersion(versions).filter(v => {
		if (v.preRelease || !isStableVersion(v.version)) {
			return false;
		}
		if (!v.engine || v.engine === '*') {
			return true;
		}
		if (!validRange(v.engine)) {
			warnings.push(`${id} ${v.version}: engine range "${v.engine}" is not valid, skipped`);
			return false;
		}
		return satisfies(engineVersion, v.engine);
	});
	const latest = selectLatestVersion(candidates);
	if (!latest) {
		warnings.push(`${id}: no stable version on the gallery is compatible with engine ${engineVersion}`);
		return { result: { id, pinned, latest: pinned, decision: 'current' }, warnings };
	}
	if (compareSemver(latest.version, pinned) <= 0) {
		return { result: { id, pinned, latest: latest.version, decision: 'current' }, warnings };
	}
	const missing = latest.platforms.has('universal')
		? []
		: requiredPlatforms.filter(platform => !latest.platforms.has(platform));
	if (missing.length > 0) {
		const reason = missing.map(platform => `no ${platform} build`).join(', ');
		return { result: { id, pinned, latest: latest.version, decision: 'hold', reason }, warnings };
	}
	return { result: { id, pinned, latest: latest.version, decision: 'bump' }, warnings };
}
