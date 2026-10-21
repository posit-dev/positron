/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as semver from 'semver';
import { chooseStartupR, compareRInstallations, createSharedSearch, RFullSearchTriggers, RStartupCandidate, RStartupInputs, ReusableSearch } from './startup-choice';

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
		manualStartup: false,
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

	it('returns nothing under manual, without checking the folder', async () => {
		const looksLikeRProject = vi.fn(async () => true);
		expect(await choose(inputs({ current, manualStartup: true, looksLikeRProject }))).toBeUndefined();
		expect(looksLikeRProject).not.toHaveBeenCalled();
	});

	it('returns the pinned R as implicit under manual', async () => {
		const pinned = r('4.3.0', { name: 'pinned' });
		expect(await choose(inputs({ current, pinned, manualStartup: true })))
			.toEqual({ name: 'pinned', startupBehavior: 'implicit' });
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

describe('ReusableSearch', () => {
	let now: number;
	let search: ReusableSearch<string>;

	beforeEach(() => {
		now = 0;
		search = new ReusableSearch<string>(60_000, () => now);
	});

	it('hands the held result to the next search once', async () => {
		await search.hold(Promise.resolve('found'));
		expect(await search.take()).toBe('found');
		expect(search.take()).toBeUndefined();
	});

	it('hands out a search that is still running, however long it has run', async () => {
		let finish!: (value: string) => void;
		search.hold(new Promise(resolve => finish = resolve));
		now = 60_001;
		const taken = search.take();
		finish('found');
		expect(await taken).toBe('found');
	});

	it('does not hand out a result that finished too long ago', async () => {
		await search.hold(Promise.resolve('found'));
		now = 60_001;
		expect(search.take()).toBeUndefined();
	});

	it('does not hand out a search that failed', async () => {
		await expect(search.hold(Promise.reject(new Error('failed')))).rejects.toThrow('failed');
		expect(search.take()).toBeUndefined();
	});

	it('keeps a newer search when an older one fails', async () => {
		let fail!: (error: Error) => void;
		const older = search.hold(new Promise((_, reject) => fail = reject));
		search.hold(Promise.resolve('newer'));
		fail(new Error('failed'));
		await expect(older).rejects.toThrow('failed');
		expect(await search.take()).toBe('newer');
	});
});

describe('createSharedSearch', () => {
	/** A shared search whose search returns how many times it has run. */
	function countingSharedSearch() {
		let runs = 0;
		const shared = createSharedSearch(async () => ++runs, 60_000);
		return { shared, runs: () => runs };
	}

	it('lets the interpreter search reuse the recommendation\'s search', async () => {
		const { shared, runs } = countingSharedSearch();
		const recommendation = await shared.forRecommendation();
		const discovery = await shared.forDiscovery();
		expect({ recommendation, discovery, runs: runs() }).toEqual({ recommendation: 1, discovery: 1, runs: 1 });
	});

	it('searches again for a second interpreter search', async () => {
		const { shared, runs } = countingSharedSearch();
		await shared.forRecommendation();
		await shared.forDiscovery();
		const second = await shared.forDiscovery();
		expect({ second, runs: runs() }).toEqual({ second: 2, runs: 2 });
	});

	it('searches when the recommendation did not', async () => {
		const { shared, runs } = countingSharedSearch();
		const discovery = await shared.forDiscovery();
		expect({ discovery, runs: runs() }).toEqual({ discovery: 1, runs: 1 });
	});
});
