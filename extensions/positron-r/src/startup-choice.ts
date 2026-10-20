/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// No `vscode` import here, so these functions can be unit tested with Vitest.

import * as semver from 'semver';

/**
 * The parts of an R installation that decide which R starts.
 */
export interface RStartupCandidate {
	readonly usable: boolean;
	readonly current: boolean;
	readonly semVersion: semver.SemVer;
	readonly arch: string;
}

/**
 * The order R installations are listed in: the current R first, then by
 * version, highest first. Two installations with the same version list arm64
 * before x86_64.
 */
export function compareRInstallations(a: RStartupCandidate, b: RStartupCandidate): number {
	if (a.current || b.current) {
		return Number(b.current) - Number(a.current);
	}
	// 'arm64' sorts before 'x86_64'
	return semver.compare(b.semVersion, a.semVersion) || a.arch.localeCompare(b.arch);
}

/**
 * Whether R starts as soon as the folder opens (`immediate`), or only when R is
 * needed (`implicit`). The same strings as `positron.LanguageRuntimeStartupBehavior`.
 */
export type RStartupBehavior = 'immediate' | 'implicit';

/**
 * The R that R's recommendation picks for the open folder, and when it starts.
 */
export interface RStartupChoice<T> {
	readonly installation: T;
	readonly startupBehavior: RStartupBehavior;
}

/**
 * Settings and files that can make the full R search pick a different R than
 * the current R. When any is set, the quick path can't be used.
 */
export interface RFullSearchTriggers {
	/** `positron.r.interpreters.override` lists paths, so the search ignores the current R. */
	readonly overrideListSet: boolean;
	/** An r-versions file exists. It can change how the current R starts. */
	readonly rVersionsFileExists: boolean;
	/** Environment modules are set up for R. Those Rs are only found by running module commands. */
	readonly modulesConfiguredForR: boolean;
}

/**
 * What R's recommendation needs to know. Each lookup runs only when the
 * decision needs it, so a pinned R never searches for R files, and the full
 * search runs only when the quick path can't answer.
 */
export interface RStartupInputs<T extends RStartupCandidate> {
	/** The R from `positron.r.interpreters.default`, if that path exists. */
	readonly pinned: T | undefined;
	/** Whether the open folder has R files, or is empty and you use RStudio. */
	looksLikeRProject(): Promise<boolean>;
	/** The current R, built the way the search builds it, or undefined if there is none. */
	currentR(): Promise<T | undefined>;
	fullSearchTriggers(): RFullSearchTriggers;
	/** Every R the full search finds, usable or not. */
	fullSearch(): Promise<T[]>;
}

/**
 * Picks the R that R's recommendation returns for the open folder, and when it
 * starts.
 *
 * - A pinned R is returned as `implicit`.
 * - Otherwise, in a folder that looks like an R project, the R the search
 *   lists first is returned as `immediate`.
 * - Otherwise nothing is returned.
 */
export async function chooseStartupR<T extends RStartupCandidate>(inputs: RStartupInputs<T>): Promise<RStartupChoice<T> | undefined> {
	if (inputs.pinned) {
		return { installation: inputs.pinned, startupBehavior: 'implicit' };
	}
	if (!(await inputs.looksLikeRProject())) {
		return undefined;
	}
	const installation = await pickStartupR(inputs);
	return installation ? { installation, startupBehavior: 'immediate' } : undefined;
}

/**
 * Picks the same R the search lists first: the current R if it's usable,
 * otherwise the highest usable version.
 *
 * Every other R sorts after the current R, so when the current R is usable the
 * full search can't change the answer, and is skipped. Listing conda and pixi
 * environments doesn't matter for the same reason. The full search still runs
 * when one of `fullSearchTriggers()` is set, or when there's no usable current R.
 */
export async function pickStartupR<T extends RStartupCandidate>(
	inputs: Pick<RStartupInputs<T>, 'currentR' | 'fullSearchTriggers' | 'fullSearch'>
): Promise<T | undefined> {
	const triggers = inputs.fullSearchTriggers();
	if (!triggers.overrideListSet && !triggers.rVersionsFileExists && !triggers.modulesConfiguredForR) {
		const current = await inputs.currentR();
		if (current?.usable) {
			return current;
		}
	}
	const installs = (await inputs.fullSearch())
		.filter(inst => inst.usable)
		.sort(compareRInstallations);
	return installs[0];
}
