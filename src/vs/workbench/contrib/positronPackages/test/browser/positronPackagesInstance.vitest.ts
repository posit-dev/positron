/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { ILanguageRuntimeMetadata, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimePackage, ILanguageRuntimePackageManager, ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ICachedPackageMetadata, PackageMetadataCache } from '../../browser/packageMetadataCache.js';
import { PositronPackagesInstance } from '../../browser/positronPackagesInstance.js';

const HOUR_MS = 60 * 60 * 1000;
const RUNTIME_ID = 'py-3.11';

const pkg = (name: string, version: string): ILanguageRuntimePackage => ({
	id: name,
	name,
	displayName: name,
	version,
});

describe('PositronPackagesInstance disk-cache integration', () => {

	ensureNoLeakedDisposables();

	let disposables: DisposableStore;
	let storage: InMemoryStorageService;
	let cache: PackageMetadataCache;

	let getPackages: ReturnType<typeof vi.fn<ILanguageRuntimePackageManager['getPackages']>>;
	let getPackageMetadata: ReturnType<typeof vi.fn<NonNullable<ILanguageRuntimePackageManager['getPackageMetadata']>>>;
	let session: ILanguageRuntimeSession;

	beforeEach(() => {
		disposables = new DisposableStore();
		storage = disposables.add(new InMemoryStorageService());
		cache = new PackageMetadataCache(storage, new NullLogService(), new TestConfigurationService());

		getPackages = vi.fn(async () => [pkg('numpy', '1.26.0'), pkg('pandas', '2.0.0')]);
		getPackageMetadata = vi.fn(async () => new Map<string, Partial<ILanguageRuntimePackage>>([
			['numpy', { outdated: true, latestVersion: '2.1.0' }],
			['pandas', { outdated: true, latestVersion: '2.2.0' }],
		]));

		const packageManager = stubInterface<ILanguageRuntimePackageManager>({
			getPackages,
			getPackageMetadata,
			installPackages: async () => undefined,
			uninstallPackages: async () => undefined,
			updatePackages: async () => undefined,
			updateAllPackages: async () => undefined,
		});

		// Uninitialized state so attachRuntime() doesn't auto-trigger a refresh;
		// tests drive refresh explicitly to keep async ordering predictable.
		const runtimeStateEmitter = disposables.add(new Emitter<RuntimeState>());
		session = stubInterface<ILanguageRuntimeSession>({
			sessionId: 'session-1',
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ runtimeId: RUNTIME_ID }),
			getRuntimeState: () => RuntimeState.Uninitialized,
			onDidChangeRuntimeState: runtimeStateEmitter.event,
			getPackageManager: () => packageManager,
		});
	});

	afterEach(() => {
		disposables.dispose();
	});

	function makeInstance(): PositronPackagesInstance {
		return disposables.add(new PositronPackagesInstance(session, new NullLogService(), cache));
	}

	/** Seed the on-disk cache with an entry fetched `ageMs` ago. */
	function seed(packages: Record<string, ICachedPackageMetadata>, ageMs: number): void {
		cache.upsert(RUNTIME_ID, packages, Date.now() - ageMs);
	}

	/** Waits for `onDidRefreshPackagesInstance` to fire `count` times. */
	function waitForEvents<T>(event: Event<T>, count: number): Promise<T[]> {
		const fires: T[] = [];
		return new Promise<T[]>((resolve) => {
			const disp = event((value) => {
				fires.push(value);
				if (fires.length >= count) {
					disp.dispose();
					resolve(fires);
				}
			});
			disposables.add(disp);
		});
	}

	it('renders a fresh, fully-covered entry and makes no network call', async () => {
		seed({
			numpy: { version: '1.26.0', outdated: true, latestVersion: '2.0.0' },
			pandas: { version: '2.0.0', outdated: false },
		}, 1 * HOUR_MS);

		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 1);
		await instance.refreshPackages();
		const [stage1] = await fires;

		expect(stage1.find(p => p.name === 'numpy')?.latestVersion).toBe('2.0.0');
		// Give a microtask for any (incorrectly scheduled) Stage 2 to run.
		await new Promise(resolve => setTimeout(resolve, 10));
		expect(getPackageMetadata).not.toHaveBeenCalled();
	});

	it('forces a live refetch on a fresh, fully-covered entry when forceMetadata is set', async () => {
		// Mirror of the "makes no network call" test above: same fresh, fully-
		// covered entry, but forceMetadata flips it from re-rendering cache to a
		// live refetch. The cache flags numpy as outdated; the repository has
		// since caught up, so the live fetch reports it current.
		seed({
			numpy: { version: '1.26.0', outdated: true, latestVersion: '2.0.0' },
			pandas: { version: '2.0.0', outdated: false },
		}, 1 * HOUR_MS);
		getPackageMetadata.mockResolvedValue(new Map<string, Partial<ILanguageRuntimePackage>>([
			['numpy', { outdated: false }],
			['pandas', { outdated: false }],
		]));

		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages(CancellationToken.None, true /* forceMetadata */);
		const [, stage2] = await fires;

		// The forced Stage 2 refetches every package (not just uncached ones, as
		// a non-forced refresh of a fresh entry would) and clears the stale flag.
		expect(getPackageMetadata).toHaveBeenCalledWith(['numpy', 'pandas'], expect.anything());
		expect(stage2.find(p => p.name === 'numpy')?.outdated).toBe(false);
	});

	it('renders a stale entry then refetches every package', async () => {
		seed({ numpy: { version: '1.26.0', outdated: true, latestVersion: '2.0.0' } }, 25 * HOUR_MS);

		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		const [stage1, stage2] = await fires;

		expect(stage1.find(p => p.name === 'numpy')?.latestVersion).toBe('2.0.0');
		expect(stage2.find(p => p.name === 'numpy')?.latestVersion).toBe('2.1.0');
		// Stale entry forces a refetch for every installed package, not just uncached ones.
		expect(getPackageMetadata).toHaveBeenCalledWith(['numpy', 'pandas'], expect.anything());
	});

	it('ignores a cached entry whose installed version no longer matches, and refetches just that package', async () => {
		seed({
			numpy: { version: '1.0.0', outdated: true, latestVersion: '1.5.0' }, // installed is 1.26.0 now
			pandas: { version: '2.0.0', outdated: false },
		}, 1 * HOUR_MS);

		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		const [stage1] = await fires;

		// The stale-version numpy entry is dropped, not shown.
		expect(stage1.find(p => p.name === 'numpy')?.latestVersion).toBeUndefined();
		// Only numpy lacks a fresh hit, so only numpy is refetched despite the entry being fresh.
		expect(getPackageMetadata).toHaveBeenCalledWith(['numpy'], expect.anything());
	});

	it('runs a normal Stage 2 on a cold start with no cached entry', async () => {
		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		const [stage1, stage2] = await fires;

		expect(stage1.find(p => p.name === 'numpy')?.latestVersion).toBeUndefined();
		expect(stage2.find(p => p.name === 'numpy')?.latestVersion).toBe('2.1.0');
		expect(getPackageMetadata).toHaveBeenCalled();
	});

	it('persists the merged metadata to disk after a successful Stage 2', async () => {
		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		await fires;

		expect(cache.get(RUNTIME_ID)?.packages).toEqual({
			numpy: { version: '1.26.0', outdated: true, latestVersion: '2.1.0' },
			pandas: { version: '2.0.0', outdated: true, latestVersion: '2.2.0' },
		});
	});

	it('leaves the on-disk entry intact when Stage 2 returns an empty map', async () => {
		seed({ numpy: { version: '1.26.0', outdated: true, latestVersion: 'pre-existing' } }, 25 * HOUR_MS);
		getPackageMetadata.mockResolvedValue(new Map());

		const instance = makeInstance();
		await instance.refreshPackages();
		// Wait long enough for any disk write that should NOT happen.
		await new Promise(resolve => setTimeout(resolve, 20));

		expect(cache.get(RUNTIME_ID)?.packages.numpy).toEqual({ version: '1.26.0', outdated: true, latestVersion: 'pre-existing' });
	});

	it('evicts uninstalled packages from disk', async () => {
		seed({
			numpy: { version: '1.26.0', outdated: true, latestVersion: '2.0.0' },
			pandas: { version: '2.0.0', outdated: false },
		}, 1 * HOUR_MS);

		// After uninstall the kernel no longer lists numpy.
		getPackages.mockResolvedValue([pkg('pandas', '2.0.0')]);

		const instance = makeInstance();
		await instance.uninstallPackages(['numpy'], CancellationToken.None);

		expect(Object.keys(cache.get(RUNTIME_ID)?.packages ?? {})).toEqual(['pandas']);
	});

	it('persists fresh metadata after updateAll evicts every entry and refetches', async () => {
		seed({
			numpy: { version: '1.26.0', outdated: true, latestVersion: '2.0.0' },
			pandas: { version: '2.0.0', outdated: true, latestVersion: '2.1.0' },
		}, 1 * HOUR_MS);

		const instance = makeInstance();
		await instance.refreshPackages();

		const stage2 = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.updateAllPackages(CancellationToken.None);
		await stage2;

		expect(cache.get(RUNTIME_ID)?.packages).toEqual({
			numpy: { version: '1.26.0', outdated: true, latestVersion: '2.1.0' },
			pandas: { version: '2.0.0', outdated: true, latestVersion: '2.2.0' },
		});
	});

	it('fires onDidChangePackages with the requested names after install', async () => {
		const instance = makeInstance();
		const fired = waitForEvents(instance.onDidChangePackages, 1);
		await instance.installPackages([{ name: 'requests' }], CancellationToken.None);

		expect(await fired).toEqual([['requests']]);
	});

	it('fires onDidChangePackages with the requested names after update', async () => {
		const instance = makeInstance();
		const fired = waitForEvents(instance.onDidChangePackages, 1);
		await instance.updatePackages([{ name: 'numpy' }], CancellationToken.None);

		expect(await fired).toEqual([['numpy']]);
	});

	it('fires onDidChangePackages with only the version-changed packages after updateAll', async () => {
		const instance = makeInstance();
		// Seed the pre-update snapshot (numpy 1.26.0, pandas 2.0.0).
		await instance.refreshPackages();

		// After update-all the kernel reports a new numpy but an unchanged pandas.
		getPackages.mockResolvedValue([pkg('numpy', '2.1.0'), pkg('pandas', '2.0.0')]);

		const fired = waitForEvents(instance.onDidChangePackages, 1);
		await instance.updateAllPackages(CancellationToken.None);

		expect(await fired).toEqual([['numpy']]);
	});

	describe('resolveLatestVersion', () => {
		it('returns the version the package manager reports as latest', async () => {
			const instance = makeInstance();
			await instance.refreshPackages();

			expect(await instance.resolveLatestVersion('numpy', CancellationToken.None)).toBe('2.1.0');
		});

		it('populates the installed list first when nothing has been refreshed yet', async () => {
			// An agent can reach this before the pane has ever been shown. Without
			// the installed version there is nothing to anchor a metadata entry to,
			// so the answer would be undefined.
			const instance = makeInstance();

			expect(await instance.resolveLatestVersion('numpy', CancellationToken.None)).toBe('2.1.0');
			expect(getPackages).toHaveBeenCalled();
		});

		it('matches the package name case-insensitively', async () => {
			getPackages.mockResolvedValue([pkg('PyYAML', '6.0.1')]);
			getPackageMetadata.mockResolvedValue(new Map<string, Partial<ILanguageRuntimePackage>>([
				['pyyaml', { outdated: true, latestVersion: '6.0.2' }],
			]));
			const instance = makeInstance();

			expect(await instance.resolveLatestVersion('pyyaml', CancellationToken.None)).toBe('6.0.2');
		});

		it('refetches rather than trusting a fresh cache entry', async () => {
			// "The latest version" has to be answered against the repository as it
			// is now, so the freshness window must not short-circuit the fetch.
			// Every installed package is seeded fresh, which is what would let an
			// unforced fetch skip the network entirely. The cache says 2.0.0; the
			// repository has since published 2.1.0.
			seed({
				numpy: { version: '1.26.0', outdated: true, latestVersion: '2.0.0' },
				pandas: { version: '2.0.0', outdated: false },
			}, 1 * HOUR_MS);
			// No refreshPackages() first: its background stage-2 fetch would
			// overwrite the seeded entry and this would pass either way.
			const instance = makeInstance();

			expect(await instance.resolveLatestVersion('numpy', CancellationToken.None)).toBe('2.1.0');
			expect(getPackageMetadata).toHaveBeenCalled();
		});

		it('returns undefined when the runtime reports nothing newer', async () => {
			getPackageMetadata.mockResolvedValue(new Map<string, Partial<ILanguageRuntimePackage>>([
				['numpy', { outdated: false }],
			]));
			const instance = makeInstance();

			expect(await instance.resolveLatestVersion('numpy', CancellationToken.None)).toBeUndefined();
		});

		it('returns undefined for a package that is not installed', async () => {
			const instance = makeInstance();

			expect(await instance.resolveLatestVersion('scipy', CancellationToken.None)).toBeUndefined();
		});

		it('returns undefined when the package manager does not report metadata', async () => {
			const packageManager = stubInterface<ILanguageRuntimePackageManager>({
				getPackages,
				getPackageMetadata: undefined,
			});
			session = stubInterface<ILanguageRuntimeSession>({
				sessionId: 'session-1',
				runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ runtimeId: RUNTIME_ID }),
				getRuntimeState: () => RuntimeState.Uninitialized,
				onDidChangeRuntimeState: Event.None,
				getPackageManager: () => packageManager,
			});
			const instance = makeInstance();

			expect(await instance.resolveLatestVersion('numpy', CancellationToken.None)).toBeUndefined();
			expect(getPackages).not.toHaveBeenCalled();
		});
	});

	describe('getPackagesSnapshot', () => {
		it('populates the list and awaits outdated state when nothing has been refreshed yet', async () => {
			// What an agent hits: the pane was never opened, so nothing attached the
			// runtime or ran a refresh. A snapshot that reported the empty list, or
			// returned before the background metadata fetch landed, would read as an
			// environment with no packages and nothing to update.
			const instance = makeInstance();

			const snapshot = await instance.getPackagesSnapshot();

			expect(snapshot).toEqual({
				metadataStatus: 'fresh',
				packages: [
					{ ...pkg('numpy', '1.26.0'), outdated: true, latestVersion: '2.1.0' },
					{ ...pkg('pandas', '2.0.0'), outdated: true, latestVersion: '2.2.0' },
				],
			});
		});

		it('re-reads the installed list on every call, so a package installed outside Positron appears', async () => {
			const instance = makeInstance();
			await instance.getPackagesSnapshot();

			// pip install requests in the console: no Positron code path saw it.
			getPackages.mockResolvedValue([pkg('numpy', '1.26.0'), pkg('pandas', '2.0.0'), pkg('requests', '2.32.0')]);

			const snapshot = await instance.getPackagesSnapshot();

			expect(snapshot.packages.map(p => p.name)).toEqual(['numpy', 'pandas', 'requests']);
		});

		it('serves a fresh cache without going to the repository', async () => {
			seed({
				numpy: { version: '1.26.0', outdated: true, latestVersion: '2.0.0' },
				pandas: { version: '2.0.0', outdated: false },
			}, 1 * HOUR_MS);
			const instance = makeInstance();

			const snapshot = await instance.getPackagesSnapshot();

			// Same freshness window the pane honors, so an agent and the pane agree
			// on what is outdated rather than each showing its own answer.
			expect(snapshot.metadataStatus).toBe('cached');
			expect(getPackageMetadata).not.toHaveBeenCalled();
		});

		it('returns the packages with timed-out when outdated state takes too long', async () => {
			getPackageMetadata.mockImplementation(() => new Promise(() => { /* never settles */ }));
			const instance = makeInstance();

			const snapshot = await instance.getPackagesSnapshot(CancellationToken.None, { metadataTimeoutMs: 10 });

			// The list is the valuable half; a hung repository must not cost the
			// caller the packages themselves.
			expect(snapshot.metadataStatus).toBe('timed-out');
			expect(snapshot.packages.map(p => p.name)).toEqual(['numpy', 'pandas']);
		});

		it('reports fetch-failed and keeps cached outdated state when the repository query errors', async () => {
			// Fresh cache covers numpy; pandas has no entry, so the snapshot
			// gap-fills -- and the repository is unreachable.
			seed({ numpy: { version: '1.26.0', outdated: true, latestVersion: '2.0.0' } }, 1 * HOUR_MS);
			getPackageMetadata.mockRejectedValue(new Error('CRAN unreachable'));
			const instance = makeInstance();

			const snapshot = await instance.getPackagesSnapshot();

			// The failure is labelled rather than passed off as 'fresh', and it
			// doesn't cost the caller what the cache already knew.
			expect(snapshot.metadataStatus).toBe('fetch-failed');
			expect(snapshot.packages.find(p => p.name === 'numpy')?.latestVersion).toBe('2.0.0');
		});

		it('joins a user-forced refresh in flight instead of cancelling it', async () => {
			// The fresh-but-stale cache is what makes the bug bite: a snapshot
			// that cancels the forced recompute finds every package covered by
			// the cache and issues no replacement query, so the refresh the
			// user asked for silently vanishes.
			seed({
				numpy: { version: '1.26.0', outdated: false },
				pandas: { version: '2.0.0', outdated: false },
			}, 1 * HOUR_MS);
			let releaseForcedFetch: () => void = () => { };
			getPackageMetadata.mockImplementationOnce(() => new Promise(resolve => {
				releaseForcedFetch = () => resolve(new Map<string, Partial<ILanguageRuntimePackage>>([
					['numpy', { outdated: true, latestVersion: '2.1.0' }],
					['pandas', { outdated: true, latestVersion: '2.2.0' }],
				]));
			}));
			const instance = makeInstance();

			// User hits Refresh Packages; its forced metadata recompute is
			// still in flight when the snapshot arrives.
			await instance.refreshPackages(CancellationToken.None, true /* forceMetadata */);
			const snapshotPromise = instance.getPackagesSnapshot();
			releaseForcedFetch();
			const snapshot = await snapshotPromise;

			// One repository query: the forced one, joined -- neither cancelled
			// nor duplicated. Its recompute is what the snapshot reports.
			expect(getPackageMetadata).toHaveBeenCalledTimes(1);
			expect(snapshot.metadataStatus).toBe('cached');
			expect(snapshot.packages.map(p => [p.name, p.outdated])).toEqual([['numpy', true], ['pandas', true]]);
		});

		it('reports timed-out when a hung refresh outlives the budget, leaving the refresh running', async () => {
			let releaseForcedFetch: () => void = () => { };
			getPackageMetadata.mockImplementationOnce(() => new Promise(resolve => {
				releaseForcedFetch = () => resolve(new Map<string, Partial<ILanguageRuntimePackage>>([
					['numpy', { outdated: true, latestVersion: '2.1.0' }],
				]));
			}));
			const instance = makeInstance();
			await instance.refreshPackages(CancellationToken.None, true /* forceMetadata */);

			const snapshot = await instance.getPackagesSnapshot(CancellationToken.None, { metadataTimeoutMs: 10 });

			expect(snapshot.metadataStatus).toBe('timed-out');

			// The refresh was not ours to cancel: released after the snapshot
			// gave up on it, its result still lands for the pane.
			releaseForcedFetch();
			await new Promise(resolve => setTimeout(resolve, 0));
			expect(instance.packages.find(p => p.name === 'numpy')?.outdated).toBe(true);
		});

		it('reports unsupported when the manager answers that it has no metadata', async () => {
			getPackageMetadata.mockResolvedValue(undefined);
			const instance = makeInstance();

			const snapshot = await instance.getPackagesSnapshot();

			// Undefined is the manager's "no metadata support" answer; the list
			// is still worth returning.
			expect(snapshot.metadataStatus).toBe('unsupported');
			expect(snapshot.packages.map(p => p.name)).toEqual(['numpy', 'pandas']);
		});

		it('propagates a caller cancellation instead of labelling it fetch-failed', async () => {
			const source = new CancellationTokenSource();
			getPackageMetadata.mockImplementation((_names, token) => new Promise((_, reject) => {
				if (token) {
					disposables.add(token.onCancellationRequested(() => reject(new CancellationError())));
				}
			}));
			const instance = makeInstance();

			const promise = instance.getPackagesSnapshot(source.token);
			// Let the snapshot reach the metadata stage, then cancel.
			await new Promise(resolve => setTimeout(resolve, 0));
			source.cancel();

			await expect(promise).rejects.toThrow('Canceled');
		});

		it('fails rather than hanging when the package list itself never arrives', async () => {
			getPackages.mockImplementation(() => new Promise(() => { /* never settles */ }));
			const instance = makeInstance();

			await expect(instance.getPackagesSnapshot(CancellationToken.None, { listTimeoutMs: 10 }))
				.rejects.toThrow('Timed out reading the installed packages.');
		});

		it('reports unsupported for a runtime that does not manage packages', async () => {
			session = stubInterface<ILanguageRuntimeSession>({
				sessionId: 'session-1',
				runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ runtimeId: RUNTIME_ID }),
				getRuntimeState: () => RuntimeState.Uninitialized,
				onDidChangeRuntimeState: Event.None,
				getPackageManager: undefined,
			});
			const instance = makeInstance();

			expect(await instance.getPackagesSnapshot()).toEqual({ packages: [], metadataStatus: 'unsupported' });
		});
	});
});
