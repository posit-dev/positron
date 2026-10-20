/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as semver from 'semver';
import { chooseStartupR, compareRInstallations, RFullSearchTriggers, RStartupCandidate, RStartupInputs } from './startup-choice';

interface FakeR extends RStartupCandidate {
	readonly name: string;
}

/** Builds a usable, non-current R. The name is the version, plus the arch when it isn't arm64. */
function r(version: string, overrides: Partial<Omit<FakeR, 'semVersion'>> = {}): FakeR {
	const arch = overrides.arch ?? 'arm64';
	return {
		name: arch === 'arm64' ? version : `${version} ${arch}`,
		usable: true,
		current: false,
		arch,
		...overrides,
		semVersion: new semver.SemVer(version),
	};
}

describe('compareRInstallations', () => {
	function sortedNames(installs: FakeR[]): string[] {
		return [...installs].sort(compareRInstallations).map(inst => inst.name);
	}

	it('lists the current R first, then the highest version', () => {
		const installs = [r('4.3.0'), r('4.5.1'), r('4.4.1', { name: 'current', current: true })];
		expect(sortedNames(installs)).toEqual(['current', '4.5.1', '4.3.0']);
	});

	it('lists arm64 before x86_64 for the same version', () => {
		const installs = [r('4.4.1', { arch: 'x86_64' }), r('4.4.1')];
		expect(sortedNames(installs)).toEqual(['4.4.1', '4.4.1 x86_64']);
	});
});

/** Inputs for a folder with R files, no pin, and nothing that forces the full search. */
function inputs(overrides: Partial<RStartupInputs<FakeR>> & { triggers?: Partial<RFullSearchTriggers>; current?: FakeR; installs?: FakeR[] } = {}): RStartupInputs<FakeR> {
	const { triggers, current, installs = [], ...rest } = overrides;
	return {
		pinned: undefined,
		looksLikeRProject: async () => true,
		currentR: async () => current,
		fullSearchTriggers: () => ({ overrideListSet: false, rVersionsFileExists: false, modulesConfiguredForR: false, ...triggers }),
		fullSearch: async () => installs,
		...rest,
	};
}

/** The chosen R's name and startup behavior, or undefined. */
async function choose(startupInputs: RStartupInputs<FakeR>) {
	const choice = await chooseStartupR(startupInputs);
	return choice && { name: choice.installation.name, startupBehavior: choice.startupBehavior };
}

describe('chooseStartupR', () => {
	const current = r('4.4.1', { name: 'current', current: true });

	it('returns the current R to start right away in an R project', async () => {
		expect(await choose(inputs({ current, installs: [current, r('4.5.1')] })))
			.toEqual({ name: 'current', startupBehavior: 'immediate' });
	});

	it('returns the highest version when there is no current R', async () => {
		expect(await choose(inputs({ installs: [r('4.3.0'), r('4.5.1'), r('4.4.1')] })))
			.toEqual({ name: '4.5.1', startupBehavior: 'immediate' });
	});

	it('returns arm64 over x86_64 when two installs have the same version', async () => {
		expect(await choose(inputs({ installs: [r('4.5.1', { arch: 'x86_64' }), r('4.5.1')] })))
			.toEqual({ name: '4.5.1', startupBehavior: 'immediate' });
	});

	it('returns nothing outside an R project', async () => {
		expect(await choose(inputs({ current, looksLikeRProject: async () => false }))).toBeUndefined();
	});

	it('returns nothing when no R is usable', async () => {
		const unusable = r('4.5.1', { usable: false });
		expect(await choose(inputs({ current: { ...current, usable: false }, installs: [unusable] }))).toBeUndefined();
	});

	it('returns the pinned R as implicit, even outside an R project', async () => {
		const looksLikeRProject = vi.fn(async () => false);
		const pinned = r('4.3.0', { name: 'pinned' });
		expect(await choose(inputs({ current, pinned, looksLikeRProject })))
			.toEqual({ name: 'pinned', startupBehavior: 'implicit' });
		expect(looksLikeRProject).not.toHaveBeenCalled();
	});

	// The full search here finds 4.5.1 and not the current R, so the result shows whether it ran.
	describe('the full search', () => {
		const searched = { name: '4.5.1', startupBehavior: 'immediate' };

		it('is skipped when the current R is usable', async () => {
			const fullSearch = vi.fn(async () => [r('4.5.1')]);
			expect(await choose(inputs({ current, fullSearch }))).toEqual({ name: 'current', startupBehavior: 'immediate' });
			expect(fullSearch).not.toHaveBeenCalled();
		});

		it('runs when there is no current R', async () => {
			expect(await choose(inputs({ current: undefined, installs: [r('4.5.1')] }))).toEqual(searched);
		});

		it('runs when the current R is not usable', async () => {
			const unusableCurrent = { ...current, usable: false };
			expect(await choose(inputs({ current: unusableCurrent, installs: [unusableCurrent, r('4.5.1')] }))).toEqual(searched);
		});

		it.each<keyof RFullSearchTriggers>(['overrideListSet', 'rVersionsFileExists', 'modulesConfiguredForR'])('runs when %s', async (trigger) => {
			expect(await choose(inputs({ current, triggers: { [trigger]: true }, installs: [r('4.5.1')] }))).toEqual(searched);
		});
	});
});
