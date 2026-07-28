/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimeMetadata } from './languageRuntimeService.js';

/**
 * A group of runtimes that share a runtimeSource header, in display order.
 */
export interface IRuntimeGroup {
	readonly label: string;
	readonly runtimes: ILanguageRuntimeMetadata[];
}

function isSupported(runtime: ILanguageRuntimeMetadata): boolean {
	return (runtime.extraRuntimeData as { supported?: boolean } | undefined)?.supported ?? true;
}

// Parse a leading integer from a version segment, treating prerelease
// suffixes (`0a5`) and missing segments as 0. `Number` would yield NaN for
// prereleases and poison the comparator (a NaN return breaks Array.sort).
function versionSegment(segment: string | undefined): number {
	const n = parseInt(segment ?? '', 10);
	return Number.isNaN(n) ? 0 : n;
}

function compareVersionDescending(a: ILanguageRuntimeMetadata, b: ILanguageRuntimeMetadata): number {
	if (a.languageVersion && b.languageVersion) {
		const av = a.languageVersion.split('.');
		const bv = b.languageVersion.split('.');
		for (let i = 0; i < 3; i++) {
			const an = versionSegment(av[i]);
			const bn = versionSegment(bv[i]);
			if (an !== bn) {
				return bn - an;
			}
		}
	}
	return a.runtimeName.localeCompare(b.runtimeName);
}

// Tiebreak for two runtimes that have no key-based distinction to make (either
// both lack a runtimeSortKey, or they share the same key): supported before
// unsupported, then version descending, then name.
function compareTiebreak(a: ILanguageRuntimeMetadata, b: ILanguageRuntimeMetadata): number {
	const aSupported = isSupported(a);
	const bSupported = isSupported(b);
	if (aSupported !== bSupported) {
		return aSupported ? -1 : 1;
	}
	return compareVersionDescending(a, b);
}

/**
 * Compare two runtimes: keyed before keyless; ascending sort key; then the
 * {@link compareTiebreak} tiebreak (supported before unsupported, then version
 * descending, then name). The tiebreak also applies keyless-vs-keyless, so
 * languages that never set a sort key (e.g. R) still sort deterministically
 * instead of preserving registration order.
 */
function compareRuntimes(a: ILanguageRuntimeMetadata, b: ILanguageRuntimeMetadata): number {
	const ak = a.runtimeSortKey;
	const bk = b.runtimeSortKey;
	if (ak === undefined && bk === undefined) {
		return compareTiebreak(a, b);
	}
	if (ak === undefined) {
		return 1;
	}
	if (bk === undefined) {
		return -1;
	}
	if (ak !== bk) {
		return ak - bk;
	}
	return compareTiebreak(a, b);
}

/**
 * Order runtimes for display: keyed runtimes sort entirely before keyless ones;
 * within each, {@link compareRuntimes}'s tiebreak (supported, then version
 * descending, then name) determines the order.
 */
export function orderRuntimes(runtimes: readonly ILanguageRuntimeMetadata[]): ILanguageRuntimeMetadata[] {
	return [...runtimes].sort(compareRuntimes);
}

/**
 * Group runtimes by runtimeSource and order both the groups and their members.
 * Groups appear in ascending order of their smallest sort key; members follow
 * {@link compareRuntimes}.
 */
export function groupAndOrderRuntimes(runtimes: readonly ILanguageRuntimeMetadata[]): IRuntimeGroup[] {
	const ordered = orderRuntimes(runtimes);
	const groups = new Map<string, ILanguageRuntimeMetadata[]>();
	for (const runtime of ordered) {
		const existing = groups.get(runtime.runtimeSource);
		if (existing) {
			existing.push(runtime);
		} else {
			groups.set(runtime.runtimeSource, [runtime]);
		}
	}
	return Array.from(groups, ([label, groupRuntimes]) => ({ label, runtimes: groupRuntimes }));
}
