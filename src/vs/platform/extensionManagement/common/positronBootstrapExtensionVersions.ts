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
const POSITRON_ENGINE_PROPERTY = 'Positron.Engine';

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
 * filtered already.
 */
export function selectLatestVersion<T extends { readonly version: string }>(candidates: readonly T[]): T | undefined {
	return candidates.slice().sort((a, b) => compareSemver(b.version, a.version))[0];
}

// The shape positronExtensionValidator.ts accepts for engines.positron: an
// optional "^" or ">=" before major.minor.patch, where a segment may be "x".
// Leading zeros (2026.04.1) are allowed, so this is not plain semver.
const POSITRON_RANGE = /^(?:\^|>=)?(?<major>\d+|x)\.(?<minor>\d+|x)\.(?<patch>\d+|x)(?:-.*)?$/;

function parsePositronVersion(version: string): (number | 'x')[] | undefined {
	const match = version.trim().match(POSITRON_RANGE);
	if (!match?.groups) {
		return undefined;
	}
	return [match.groups.major, match.groups.minor, match.groups.patch].map(part => part === 'x' ? 'x' : Number(part));
}

/**
 * Whether `positronVersion` meets a Positron.Engine range, with the semantics
 * of isValidPositronExtensionVersion in positronExtensionValidator.ts: "^" and
 * ">=" both mean at least that version, a bare version must match exactly, and
 * "x" matches any value. Returns undefined when either string does not parse,
 * which Positron treats as incompatible.
 */
export function satisfiesPositronEngine(positronVersion: string, range: string): boolean | undefined {
	if (range === '*') {
		return true;
	}
	const required = parsePositronVersion(range);
	const current = parsePositronVersion(positronVersion);
	if (!required || !current) {
		return undefined;
	}
	const atLeast = /^(\^|>=)/.test(range.trim());
	for (let i = 0; i < 3; i++) {
		const want = required[i];
		const have = current[i];
		if (want === 'x' || have === want) {
			continue;
		}
		return atLeast && typeof have === 'number' && have > want;
	}
	return true;
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

/**
 * The versions a bootstrap extension's engine ranges are matched against:
 * `vscode` is the VS Code version Positron reports to extensions (the root
 * package.json version), `positron` is product.json's positronVersion.
 */
export interface IEngineVersions {
	readonly vscode: string;
	readonly positron: string;
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
	positronEngine: string;
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
			group = { version: entry.version, platforms: new Set(), engine: '', positronEngine: '', preRelease: false };
			byVersion.set(entry.version, group);
		}
		group.platforms.add(entry.targetPlatform || 'universal');
		group.engine ||= getProperty(entry, ENGINE_PROPERTY) ?? '';
		group.positronEngine ||= getProperty(entry, POSITRON_ENGINE_PROPERTY) ?? '';
		group.preRelease ||= getProperty(entry, PRE_RELEASE_PROPERTY) === 'true';
	}
	return Array.from(byVersion.values());
}

/**
 * Decides whether the nightly may bump a bootstrap extension, from the raw
 * gallery version list. Of the stable versions whose VS Code and Positron
 * engine ranges `engines` satisfies, the newest one with a build for every
 * required platform that is newer than the pin is a `bump`; newer versions
 * skipped over for a missing platform are reported as warnings. When no newer
 * version is complete the newest one is a `hold`, and when nothing is newer
 * than the pin the result is `current`.
 */
export function checkBootstrapExtensionVersion(
	id: string,
	pinned: string,
	versions: readonly IGalleryVersion[],
	engines: IEngineVersions,
	requiredPlatforms: readonly string[] = POSITRON_TARGET_PLATFORMS
): IBootstrapVersionCheck {
	const warnings: string[] = [];
	const candidates = groupByVersion(versions).filter(v => {
		if (v.preRelease || !isStableVersion(v.version)) {
			return false;
		}
		if (v.engine && v.engine !== '*') {
			if (!validRange(v.engine)) {
				warnings.push(`${id} ${v.version}: VS Code engine range "${v.engine}" is not valid, skipped`);
				return false;
			}
			if (!satisfies(engines.vscode, v.engine)) {
				return false;
			}
		}
		if (v.positronEngine) {
			const ok = satisfiesPositronEngine(engines.positron, v.positronEngine);
			if (ok === undefined) {
				warnings.push(`${id} ${v.version}: Positron engine range "${v.positronEngine}" is not valid, skipped`);
			}
			return ok === true;
		}
		return true;
	}).sort((a, b) => compareSemver(b.version, a.version));
	const newest = candidates[0];
	if (!newest) {
		warnings.push(`${id}: no stable version on the gallery is compatible with VS Code engine ${engines.vscode} and Positron ${engines.positron}`);
		return { result: { id, pinned, latest: pinned, decision: 'current' }, warnings };
	}
	const newer = candidates.filter(v => compareSemver(v.version, pinned) > 0);
	if (newer.length === 0) {
		return { result: { id, pinned, latest: newest.version, decision: 'current' }, warnings };
	}
	const missingPlatforms = (v: IPublishedVersion) => v.platforms.has('universal')
		? []
		: requiredPlatforms.filter(platform => !v.platforms.has(platform));
	const describeMissing = (missing: string[]) => missing.map(platform => `no ${platform} build`).join(', ');
	const skipped: string[] = [];
	for (const candidate of newer) {
		const missing = missingPlatforms(candidate);
		if (missing.length === 0) {
			warnings.push(...skipped);
			return { result: { id, pinned, latest: candidate.version, decision: 'bump' }, warnings };
		}
		skipped.push(`${id} ${candidate.version}: ${describeMissing(missing)}, skipped`);
	}
	return { result: { id, pinned, latest: newest.version, decision: 'hold', reason: describeMissing(missingPlatforms(newest)) }, warnings };
}
