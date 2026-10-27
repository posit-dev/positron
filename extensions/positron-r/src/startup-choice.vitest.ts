/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as semver from 'semver';
import { choosePinnedR, chooseStartupR, compareRInstallations, createSharedSearch, firstListedR, listedRPath, ListedRPathInputs, PinnedRBuild, PinnedRInputs, RFullSearchTriggers, RStartupCandidate, RStartupInputs, InFlightLookup, ReusableSearch, rVersionsEntryForR, rVersionsMayListR } from './startup-choice';

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
function inputs(overrides: Partial<RStartupInputs<FakeR>> & { triggers?: Partial<RFullSearchTriggers>; current?: FakeR; installs?: FakeR[]; pinned?: FakeR } = {}): RStartupInputs<FakeR> {
	const { triggers, current, installs = [], pinned, ...rest } = overrides;
	return {
		pinnedR: async () => pinned,
		manualStartup: false,
		pinOnly: false,
		looksLikeRProject: async () => true,
		currentR: async () => current,
		fullSearchTriggers: () => ({ overrideListSet: false, rVersionsListsCurrentR: false, modulesConfiguredForR: false, ...triggers }),
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

	describe('a pinned R', () => {
		const pinned = r('4.3.0', { name: 'pinned' });

		it('starts right away in an R project, without searching for R', async () => {
			const currentR = vi.fn(async () => current);
			const fullSearch = vi.fn(async () => [r('4.5.1')]);
			expect({
				choice: await choose(inputs({ pinned, currentR, fullSearch })),
				searches: [currentR.mock.calls.length, fullSearch.mock.calls.length],
			}).toEqual({ choice: { name: 'pinned', startupBehavior: 'immediate' }, searches: [0, 0] });
		});

		it('is looked up while the folder is searched for R files', async () => {
			// The pin lookup finishes only once the folder search has started.
			const looksLikeRProject = vi.fn(async () => true);
			const pinnedR = async () => {
				await vi.waitFor(() => expect(looksLikeRProject).toHaveBeenCalled());
				return pinned;
			};
			expect(await choose(inputs({ pinnedR, looksLikeRProject })))
				.toEqual({ name: 'pinned', startupBehavior: 'immediate' });
		});

		it('passes on a failed lookup, and leaves no failure of the folder search unhandled', async () => {
			const pinnedR = async (): Promise<FakeR | undefined> => { throw new Error('pin lookup failed'); };
			const looksLikeRProject = async (): Promise<boolean> => { throw new Error('folder search failed'); };
			await expect(chooseStartupR(inputs({ pinnedR, looksLikeRProject }))).rejects.toThrow('pin lookup failed');
		});

		it('starts when R is needed outside an R project', async () => {
			expect(await choose(inputs({ current, pinned, looksLikeRProject: async () => false })))
				.toEqual({ name: 'pinned', startupBehavior: 'implicit' });
		});
	});

	describe('with definitionsOnly discovery, where only the pinned R can start', () => {
		const pinned = r('4.3.0', { name: 'pinned' });

		it('starts the pinned R right away in an R project', async () => {
			expect(await choose(inputs({ current, pinned, pinOnly: true })))
				.toEqual({ name: 'pinned', startupBehavior: 'immediate' });
		});

		it('starts the pinned R only when R is needed, in a folder that is not an R project', async () => {
			expect(await choose(inputs({ current, pinned, pinOnly: true, looksLikeRProject: async () => false })))
				.toEqual({ name: 'pinned', startupBehavior: 'implicit' });
		});

		it('starts no R when nothing is pinned, without looking for other Rs', async () => {
			const currentR = vi.fn(async () => current);
			const fullSearch = vi.fn(async () => [r('4.5.1')]);
			expect({
				choice: await choose(inputs({ pinOnly: true, currentR, fullSearch })),
				searches: [currentR.mock.calls.length, fullSearch.mock.calls.length],
			}).toEqual({ choice: undefined, searches: [0, 0] });
		});
	});

	it('returns nothing under manual, without checking the folder', async () => {
		const looksLikeRProject = vi.fn(async () => true);
		expect(await choose(inputs({ current, manualStartup: true, looksLikeRProject }))).toBeUndefined();
		expect(looksLikeRProject).not.toHaveBeenCalled();
	});

	it('returns the pinned R as implicit under manual, without checking the folder', async () => {
		const pinned = r('4.3.0', { name: 'pinned' });
		const looksLikeRProject = vi.fn(async () => true);
		expect(await choose(inputs({ current, pinned, manualStartup: true, looksLikeRProject })))
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

		it.each<keyof RFullSearchTriggers>(['overrideListSet', 'rVersionsListsCurrentR', 'modulesConfiguredForR'])('runs when %s', async (trigger) => {
			expect(await choose(inputs({ current, triggers: { [trigger]: true }, installs: [r('4.5.1')] }))).toEqual(searched);
		});

		it('returns nothing when it runs out of time', async () => {
			expect(await choose(inputs({ current: undefined, fullSearch: async () => undefined }))).toBeUndefined();
		});
	});
});

describe('rVersionsMayListR', () => {
	const current = '/opt/R/4.4/bin/R';

	it.each([
		{ name: 'an entry for another R', entries: [{ path: '/opt/R/4.3' }], expected: false },
		{ name: 'an entry for the current R', entries: [{ path: '/opt/R/4.3' }, { path: '/opt/R/4.4' }], expected: true },
		{ name: 'an entry for the current R through a symlink', entries: [{ path: '/opt/R/current' }], expected: false },
		{ name: 'an entry with only a module', entries: [{ module: 'R/4.4' }], expected: true },
		{ name: 'no entries', entries: [], expected: false },
	])('is $expected for $name', ({ entries, expected }) => {
		expect(rVersionsMayListR(entries, current)).toBe(expected);
	});
});

describe('rVersionsEntryForR', () => {
	const pinned = '/opt/R/4.4/bin/R';
	const links: Record<string, string> = { '/opt/R/current/bin/R': pinned };
	const isSameFile = (path1: string, path2: string) => (links[path1] ?? path1) === (links[path2] ?? path2);

	interface Entry {
		readonly path?: string;
		readonly module?: string;
		readonly label?: string;
	}

	it.each<{ name: string; entries: Entry[]; expected: Entry | undefined }>([
		{ name: 'the entry whose Path is the R\'s home', entries: [{ path: '/opt/R/4.3' }, { path: '/opt/R/4.4', label: 'R 4.4' }], expected: { path: '/opt/R/4.4', label: 'R 4.4' } },
		{ name: 'an entry whose Path links to the R\'s home', entries: [{ path: '/opt/R/current', label: 'Current R' }], expected: { path: '/opt/R/current', label: 'Current R' } },
		{ name: 'nothing for an entry with only a module', entries: [{ module: 'R/4.4' }], expected: undefined },
		{ name: 'nothing for an entry for another R', entries: [{ path: '/opt/R/4.3' }], expected: undefined },
	])('finds $name', ({ entries, expected }) => {
		expect(rVersionsEntryForR(entries, pinned, isSameFile)).toEqual(expected);
	});
});

describe('choosePinnedR', () => {
	/** Where the packager metadata came from. */
	interface FakePackager {
		readonly from: 'pixi' | 'r-versions';
	}

	/** The build, plus whether the R installed from it is usable. */
	interface FakePinnedR extends PinnedRBuild<FakePackager> {
		readonly usable: boolean;
	}

	/**
	 * Inputs for a pin at `/opt/R/4.4/bin/R` that exists, isn't the current R,
	 * and is usable. `/usr/local/bin/R` is a link to the current R,
	 * `/usr/local/bin/R-4.4` is a link to `/opt/R/4.4/bin/R`, and
	 * `/usr/local/bin/R-pixi` is a link into a pixi environment.
	 */
	function pinnedInputs(overrides: Partial<PinnedRInputs<FakePinnedR, FakePackager>> & { usable?: boolean } = {}): PinnedRInputs<FakePinnedR, FakePackager> {
		const { usable = true, ...rest } = overrides;
		const links: Record<string, string> = {
			'/usr/local/bin/R': '/Library/Frameworks/R.framework/Versions/4.5/Resources/bin/R',
			'/usr/local/bin/R-4.4': '/opt/R/4.4/bin/R',
			'/usr/local/bin/R-pixi': '/work/project/.pixi/envs/default/bin/R',
		};
		return {
			definitionsOnly: false,
			pinnedPath: '/opt/R/4.4/bin/R',
			isDefined: () => false,
			exists: () => true,
			currentRPath: async () => '/Library/Frameworks/R.framework/Versions/4.5/Resources/bin/R',
			isSameFile: (path1, path2) => (links[path1] ?? path1) === (links[path2] ?? path2),
			followLink: path => links[path] ?? path,
			packagerMetadataForPath: path => path.includes('/.pixi/') ? { from: 'pixi' } : undefined,
			listedRBinary: path => path,
			rVersionsMetadataForPath: async () => undefined,
			install: build => ({ ...build, usable }),
			...rest,
		};
	}

	it('builds the pinned R from its own path', async () => {
		expect(await choosePinnedR(pinnedInputs())).toEqual({
			binpath: '/opt/R/4.4/bin/R',
			current: false,
			packagerMetadata: undefined,
			usable: true,
		});
	});

	it('builds a pin that links to the current R from the current R\'s path', async () => {
		expect(await choosePinnedR(pinnedInputs({ pinnedPath: '/usr/local/bin/R' }))).toEqual({
			binpath: '/Library/Frameworks/R.framework/Versions/4.5/Resources/bin/R',
			current: true,
			packagerMetadata: undefined,
			usable: true,
		});
	});

	it('builds a pin that links to another R from the file the link leads to', async () => {
		expect(await choosePinnedR(pinnedInputs({ pinnedPath: '/usr/local/bin/R-4.4' }))).toEqual({
			binpath: '/opt/R/4.4/bin/R',
			current: false,
			packagerMetadata: undefined,
			usable: true,
		});
	});

	it('builds a pixi pin from the path as written, since discovery lists pixi Rs that way', async () => {
		const followLink = vi.fn((path: string) => `/resolved${path}`);
		const pinnedPath = '/work/project/.pixi/envs/default/bin/R';
		expect({
			binpath: (await choosePinnedR(pinnedInputs({ pinnedPath, followLink })))?.binpath,
			followed: followLink.mock.calls.length,
		}).toEqual({ binpath: pinnedPath, followed: 0 });
	});

	it('keeps a pixi path\'s packager metadata, without reading the r-versions file', async () => {
		const rVersionsMetadataForPath = vi.fn(async (): Promise<FakePackager | undefined> => ({ from: 'r-versions' }));
		const pinnedPath = '/work/project/.pixi/envs/default/bin/R';
		expect({
			packagerMetadata: (await choosePinnedR(pinnedInputs({ pinnedPath, rVersionsMetadataForPath })))?.packagerMetadata,
			rVersionsRead: rVersionsMetadataForPath.mock.calls.length,
		}).toEqual({ packagerMetadata: { from: 'pixi' }, rVersionsRead: 0 });
	});

	it('builds a pin that links into a pixi environment from the file the link leads to, with that environment', async () => {
		expect(await choosePinnedR(pinnedInputs({ pinnedPath: '/usr/local/bin/R-pixi' }))).toEqual({
			binpath: '/work/project/.pixi/envs/default/bin/R',
			current: false,
			packagerMetadata: { from: 'pixi' },
			usable: true,
		});
	});

	it('builds a pin from the R binary discovery lists for it, such as `bin\\x64\\R.exe` on Windows', async () => {
		expect((await choosePinnedR(pinnedInputs({
			pinnedPath: 'C:\\R\\R-4.4.1\\bin\\R.exe',
			listedRBinary: path => path.replace('\\bin\\R.exe', '\\bin\\x64\\R.exe'),
		})))?.binpath).toBe('C:\\R\\R-4.4.1\\bin\\x64\\R.exe');
	});

	it('keeps the setup of the r-versions entry that lists the pinned R', async () => {
		const rVersionsMetadataForPath = async (path: string): Promise<FakePackager | undefined> =>
			path === '/opt/R/4.4/bin/R' ? { from: 'r-versions' } : undefined;
		expect((await choosePinnedR(pinnedInputs({ rVersionsMetadataForPath })))?.packagerMetadata).toEqual({ from: 'r-versions' });
	});

	it('returns nothing without looking for R when no pin is set', async () => {
		const exists = vi.fn(() => true);
		expect(await choosePinnedR(pinnedInputs({ pinnedPath: undefined, exists }))).toBeUndefined();
		expect(exists).not.toHaveBeenCalled();
	});

	it('returns nothing when the pinned path does not exist', async () => {
		expect(await choosePinnedR(pinnedInputs({ exists: () => false }))).toBeUndefined();
	});

	it('returns nothing when the pinned R is not usable', async () => {
		expect(await choosePinnedR(pinnedInputs({ usable: false }))).toBeUndefined();
	});

	describe('when discovery is limited to interpreters.definitions', () => {
		it('returns nothing when the pinned path is not one of the definitions', async () => {
			expect(await choosePinnedR(pinnedInputs({ definitionsOnly: true }))).toBeUndefined();
		});

		it('returns the pinned R when the pinned path is one of the definitions', async () => {
			expect(await choosePinnedR(pinnedInputs({ definitionsOnly: true, isDefined: path => path === '/opt/R/4.4/bin/R' }))).toEqual({
				binpath: '/opt/R/4.4/bin/R',
				current: false,
				packagerMetadata: undefined,
				usable: true,
			});
		});

		it('keeps a defined pin\'s path as written when it links to another R, since definitions match on the exact path', async () => {
			expect((await choosePinnedR(pinnedInputs({ definitionsOnly: true, pinnedPath: '/usr/local/bin/R-4.4', isDefined: path => path === '/usr/local/bin/R-4.4' })))?.binpath)
				.toBe('/usr/local/bin/R-4.4');
		});

		it('keeps a defined pin\'s path as written when it links to the current R, since definitions match on the exact path', async () => {
			expect(await choosePinnedR(pinnedInputs({ definitionsOnly: true, pinnedPath: '/usr/local/bin/R', isDefined: path => path === '/usr/local/bin/R' }))).toEqual({
				binpath: '/usr/local/bin/R',
				current: true,
				packagerMetadata: undefined,
				usable: true,
			});
		});
	});
});

describe('listedRPath', () => {
	/** Where the packager metadata came from. */
	interface FakePackager {
		readonly from: 'conda';
	}

	/**
	 * `/usr/local/bin/R` is a link to the current R, `/usr/local/bin/R-conda`
	 * is a link into a conda environment, and on Windows `bin\R.exe` is
	 * listed as `bin\x64\R.exe`.
	 */
	const links: Record<string, string> = {
		'/usr/local/bin/R': '/opt/R/4.5/bin/R',
		'/usr/local/bin/R-conda': '/home/me/miniconda3/envs/r44/bin/R',
	};
	const inputs: ListedRPathInputs<FakePackager> = {
		isSameFile: (path1, path2) => (links[path1] ?? path1) === (links[path2] ?? path2),
		followLink: path => links[path] ?? path,
		packagerMetadataForPath: path => path.includes('/miniconda3/') ? { from: 'conda' } : undefined,
		listedRBinary: path => path.replace('\\bin\\R.exe', '\\bin\\x64\\R.exe'),
	};

	it('lists each R that you add by path where discovery lists it', () => {
		const listed = (userPath: string) => listedRPath(userPath, '/opt/R/4.5/bin/R', inputs);
		expect({
			plain: listed('/opt/R/4.4/bin/R'),
			linkToCurrent: listed('/usr/local/bin/R'),
			conda: listed('/home/me/miniconda3/envs/r44/bin/R'),
			linkIntoConda: listed('/usr/local/bin/R-conda'),
			windows: listed('C:\\R\\R-4.4.1\\bin\\R.exe'),
		}).toEqual({
			plain: { binpath: '/opt/R/4.4/bin/R', current: false, condaOrPixi: undefined },
			linkToCurrent: { binpath: '/opt/R/4.5/bin/R', current: true, condaOrPixi: undefined },
			conda: { binpath: '/home/me/miniconda3/envs/r44/bin/R', current: false, condaOrPixi: { from: 'conda' } },
			linkIntoConda: { binpath: '/home/me/miniconda3/envs/r44/bin/R', current: false, condaOrPixi: { from: 'conda' } },
			windows: { binpath: 'C:\\R\\R-4.4.1\\bin\\x64\\R.exe', current: false, condaOrPixi: undefined },
		});
	});

	it('does not treat an R as the current R when there is none', () => {
		expect(listedRPath('/usr/local/bin/R', undefined, inputs).current).toBe(false);
	});
});

describe('firstListedR', () => {
	it('picks the usable current R, otherwise the highest usable version', () => {
		const current = r('4.4.1', { name: 'current', current: true });
		const picked = [
			firstListedR([r('4.3.0'), r('4.5.1'), current]),
			firstListedR([r('4.3.0'), r('4.5.1'), { ...current, usable: false }]),
			firstListedR([r('4.5.1', { usable: false })]),
		];
		expect(picked.map(inst => inst?.name)).toEqual(['current', '4.5.1', undefined]);
	});
});

describe('InFlightLookup', () => {
	/** A lookup that counts its runs and finishes when the test says so. */
	function lookup() {
		const runs: Array<(value: string) => void> = [];
		const fails: Array<(err: Error) => void> = [];
		const run = vi.fn(() => new Promise<string>((resolve, reject) => {
			runs.push(resolve);
			fails.push(reject);
		}));
		return { run, finish: (i: number, value: string) => runs[i](value), fail: (i: number, err: Error) => fails[i](err) };
	}

	it('shares one run between callers that ask for the same key while it runs', async () => {
		const shared = new InFlightLookup<string, string>();
		const { run, finish } = lookup();
		const first = shared.run('/opt/R/4.4/bin/R', run);
		const second = shared.run('/opt/R/4.4/bin/R', run);
		finish(0, 'R 4.4');
		expect({ results: await Promise.all([first, second]), runs: run.mock.calls.length }).toEqual({ results: ['R 4.4', 'R 4.4'], runs: 1 });
	});

	it('runs again once the earlier run finished, so a result is never reused', async () => {
		const shared = new InFlightLookup<string, string>();
		const { run, finish } = lookup();
		const first = shared.run('/opt/R/4.4/bin/R', run);
		finish(0, 'R 4.4');
		await first;
		const second = shared.run('/opt/R/4.4/bin/R', run);
		finish(1, 'R 4.4 upgraded');
		expect({ result: await second, runs: run.mock.calls.length }).toEqual({ result: 'R 4.4 upgraded', runs: 2 });
	});

	it('runs the lookup for an unset key, such as no pin, when nothing is running', async () => {
		const shared = new InFlightLookup<string | undefined, string | undefined>();
		const run = vi.fn(async () => undefined);
		expect({ result: await shared.run(undefined, run), runs: run.mock.calls.length }).toEqual({ result: undefined, runs: 1 });
	});

	it('runs separately for a different key, such as a changed setting', async () => {
		const shared = new InFlightLookup<string | undefined, string>();
		const { run, finish } = lookup();
		const first = shared.run('/opt/R/4.4/bin/R', run);
		const second = shared.run('/opt/R/4.5/bin/R', run);
		finish(0, 'R 4.4');
		finish(1, 'R 4.5');
		expect({ results: await Promise.all([first, second]), runs: run.mock.calls.length }).toEqual({ results: ['R 4.4', 'R 4.5'], runs: 2 });
	});

	it('passes a failed run to every caller, and runs again next time', async () => {
		const shared = new InFlightLookup<string, string>();
		const { run, finish, fail } = lookup();
		const first = shared.run('/opt/R/4.4/bin/R', run);
		const second = shared.run('/opt/R/4.4/bin/R', run);
		fail(0, new Error('lookup failed'));
		await expect(first).rejects.toThrow('lookup failed');
		await expect(second).rejects.toThrow('lookup failed');
		const third = shared.run('/opt/R/4.4/bin/R', run);
		finish(1, 'R 4.4');
		expect({ result: await third, runs: run.mock.calls.length }).toEqual({ result: 'R 4.4', runs: 2 });
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
	const timeoutMs = 3000;

	afterEach(() => {
		vi.useRealTimers();
	});

	/** A shared search whose search returns how many times it has run. */
	function countingSharedSearch() {
		let runs = 0;
		const shared = createSharedSearch(async () => ++runs, 60_000);
		return { shared, runs: () => runs };
	}

	it('lets the interpreter search reuse the recommendation\'s search', async () => {
		const { shared, runs } = countingSharedSearch();
		const recommendation = await shared.forRecommendation(timeoutMs);
		const discovery = await shared.forDiscovery();
		expect({ recommendation, discovery, runs: runs() }).toEqual({ recommendation: 1, discovery: 1, runs: 1 });
	});

	it('searches again for a second interpreter search', async () => {
		const { shared, runs } = countingSharedSearch();
		await shared.forRecommendation(timeoutMs);
		await shared.forDiscovery();
		const second = await shared.forDiscovery();
		expect({ second, runs: runs() }).toEqual({ second: 2, runs: 2 });
	});

	it('searches when the recommendation did not', async () => {
		const { shared, runs } = countingSharedSearch();
		const discovery = await shared.forDiscovery();
		expect({ discovery, runs: runs() }).toEqual({ discovery: 1, runs: 1 });
	});

	it('stops waiting for the recommendation\'s search after the timeout, and the interpreter search still reuses it', async () => {
		vi.useFakeTimers();
		let finish!: (value: string) => void;
		const search = vi.fn(() => new Promise<string>(resolve => finish = resolve));
		const shared = createSharedSearch(search, 60_000);

		const recommendation = shared.forRecommendation(timeoutMs);
		await vi.advanceTimersByTimeAsync(timeoutMs);
		const discovery = shared.forDiscovery();
		finish('found');

		expect({ recommendation: await recommendation, discovery: await discovery, runs: search.mock.calls.length })
			.toEqual({ recommendation: undefined, discovery: 'found', runs: 1 });
	});
});
