/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../../base/common/cancellation.js';
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
});
