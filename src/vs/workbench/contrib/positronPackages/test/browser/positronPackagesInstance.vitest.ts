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
import { IPackageVulnerabilityResult, PackageVulnerabilityLookup } from '../../browser/packageVulnerabilityLookup.js';
import { PositronPackagesInstance } from '../../browser/positronPackagesInstance.js';

const HOUR_MS = 60 * 60 * 1000;
const RUNTIME_ID = 'py-3.11';

const ADVISORY = {
	id: 'CVE-2018-6594',
	osvId: 'GHSA-6528-wvf6-f6qg',
	score: 8.7,
	scoreVersion: 'v4' as const,
};

const SOURCE = { host: 'ppm.example.com', fetchedAt: 1_700_000_000_000 };

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
	let getVulnerabilities: ReturnType<typeof vi.fn<PackageVulnerabilityLookup['getVulnerabilities']>>;
	let vulnerabilityLookup: PackageVulnerabilityLookup;
	let repositoryRequest: ReturnType<typeof vi.fn<NonNullable<ILanguageRuntimePackageManager['repositoryRequest']>>>;
	let packageManager: ILanguageRuntimePackageManager;
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
		// No advisory data by default; the vulnerability tests opt in.
		getVulnerabilities = vi.fn(async () => undefined);
		vulnerabilityLookup = stubInterface<PackageVulnerabilityLookup>({ getVulnerabilities });

		repositoryRequest = vi.fn(async () => ({ status: 200, body: '' }));
		packageManager = stubInterface<ILanguageRuntimePackageManager>({
			getPackages,
			getPackageMetadata,
			packageRepositoryUrl: async () => 'https://ppm.example.com/pypi/latest/simple',
			repositoryRequest,
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
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ runtimeId: RUNTIME_ID, languageId: 'python' }),
			getRuntimeState: () => RuntimeState.Uninitialized,
			onDidChangeRuntimeState: runtimeStateEmitter.event,
			getPackageManager: () => packageManager,
		});
	});

	afterEach(() => {
		disposables.dispose();
	});

	function makeInstance(): PositronPackagesInstance {
		return disposables.add(new PositronPackagesInstance(session, new NullLogService(), cache, vulnerabilityLookup));
	}

	/** Seed the on-disk cache with an entry fetched `ageMs` ago. */
	function seed(packages: Record<string, ICachedPackageMetadata>, ageMs: number, source?: typeof SOURCE): void {
		cache.upsert(RUNTIME_ID, packages, { vulnerabilitySource: source, now: Date.now() - ageMs });
	}

	/** A lookup result carrying `advisories` for the named packages. */
	function lookupResult(advisories: Array<[string, typeof ADVISORY[] | []]>): IPackageVulnerabilityResult {
		return { source: SOURCE, vulnerabilities: new Map(advisories) };
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

	it('merges both sources into one entry, and persists the advisory source', async () => {
		// numpy is vulnerable; pandas is affirmatively clean ([]); a package the
		// repository doesn't know at its installed version is absent from the
		// map and stays undefined.
		getVulnerabilities.mockResolvedValue(lookupResult([['numpy', [ADVISORY]], ['pandas', []]]));

		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		const [stage1, stage2] = await fires;

		// Stage 1 has no advisory data yet (cold cache).
		expect(stage1.find(p => p.name === 'numpy')?.vulnerabilities).toBeUndefined();
		// Stage 2 merges outdated state (from the runtime) and advisories (from
		// the lookup) into the same exposed package.
		expect(stage2.find(p => p.name === 'numpy')).toMatchObject({
			outdated: true,
			latestVersion: '2.1.0',
			vulnerabilities: [ADVISORY],
		});
		expect(stage2.find(p => p.name === 'pandas')?.vulnerabilities).toEqual([]);
		// The advisories and the instance that served them both persist.
		expect(cache.get(RUNTIME_ID)?.packages.numpy?.vulnerabilities).toEqual([ADVISORY]);
		expect(cache.get(RUNTIME_ID)?.vulnerabilitySource).toEqual(SOURCE);
		expect(instance.vulnerabilitySource).toEqual(SOURCE);
	});

	it('passes installed versions to the lookup and repository access from the runtime', async () => {
		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		await fires;

		expect(getVulnerabilities).toHaveBeenCalledWith(
			'python',
			expect.anything(),
			[{ name: 'numpy', version: '1.26.0' }, { name: 'pandas', version: '2.0.0' }],
			expect.anything(),
		);
		// The access the lookup was handed defers to the runtime's own hooks --
		// its host is the only one that can reach the repository.
		const access = getVulnerabilities.mock.calls[0][1];
		expect(await access.resolveUrl(CancellationToken.None)).toBe('https://ppm.example.com/pypi/latest/simple');
		expect(await access.request({ url: 'https://ppm.example.com/__api__/status' }, CancellationToken.None))
			.toEqual({ status: 200, body: '' });
		// And invokes it as a method on the package manager. The main-thread
		// adapter reads `this._proxy`, so a call that drops the receiver throws
		// at runtime while still satisfying the types.
		expect(repositoryRequest.mock.contexts[0]).toBe(packageManager);
	});

	it('skips the advisory lookup when the runtime cannot carry a repository request', async () => {
		// Without the runtime's host there is no way to reach a Package Manager
		// API: the renderer's own fetch is blocked by CORS.
		const packageManager = stubInterface<ILanguageRuntimePackageManager>({
			getPackages,
			getPackageMetadata,
			repositoryRequest: undefined,
		});
		session = stubInterface<ILanguageRuntimeSession>({
			sessionId: 'session-1',
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ runtimeId: RUNTIME_ID, languageId: 'python' }),
			getRuntimeState: () => RuntimeState.Uninitialized,
			onDidChangeRuntimeState: Event.None,
			getPackageManager: () => packageManager,
		});

		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		const [, stage2] = await fires;

		expect(getVulnerabilities).not.toHaveBeenCalled();
		// The outdated state still lands.
		expect(stage2.find(p => p.name === 'numpy')?.latestVersion).toBe('2.1.0');
	});

	it('keeps outdated state when the vulnerability lookup fails', async () => {
		// The two sources are independent: a failing advisory lookup must not
		// cost the pane what it mostly renders.
		getVulnerabilities.mockRejectedValue(new Error('ppm unreachable'));

		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		const [, stage2] = await fires;

		expect(stage2.find(p => p.name === 'numpy')).toMatchObject({ outdated: true, latestVersion: '2.1.0' });
		expect(stage2.find(p => p.name === 'numpy')?.vulnerabilities).toBeUndefined();
	});

	it('keeps advisories when the runtime metadata fetch fails', async () => {
		getPackageMetadata.mockRejectedValue(new Error('resolver offline'));
		getVulnerabilities.mockResolvedValue(lookupResult([['numpy', [ADVISORY]]]));

		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		const [, stage2] = await fires;

		expect(stage2.find(p => p.name === 'numpy')?.vulnerabilities).toEqual([ADVISORY]);
	});

	it('keeps cached advisories for the same version when a later lookup returns nothing', async () => {
		// A failed lookup is not evidence that the package became clean.
		seed({ numpy: { version: '1.26.0', outdated: true, vulnerabilities: [ADVISORY] } }, 25 * HOUR_MS, SOURCE);

		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		const [, stage2] = await fires;

		expect(stage2.find(p => p.name === 'numpy')?.vulnerabilities).toEqual([ADVISORY]);
	});

	it('replaces cached advisories when a later lookup reports the version clean', async () => {
		// A successful lookup is authoritative, including the empty case.
		seed({ numpy: { version: '1.26.0', outdated: true, vulnerabilities: [ADVISORY] } }, 25 * HOUR_MS, SOURCE);
		getVulnerabilities.mockResolvedValue(lookupResult([['numpy', []]]));

		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		const [, stage2] = await fires;

		expect(stage2.find(p => p.name === 'numpy')?.vulnerabilities).toEqual([]);
	});

	it('runs Stage 2 for advisories even when the runtime reports no metadata', async () => {
		const packageManager = stubInterface<ILanguageRuntimePackageManager>({
			getPackages,
			getPackageMetadata: undefined,
			packageRepositoryUrl: async () => 'https://ppm.example.com/pypi/latest/simple',
			repositoryRequest: async () => ({ status: 200, body: '' }),
		});
		session = stubInterface<ILanguageRuntimeSession>({
			sessionId: 'session-1',
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ runtimeId: RUNTIME_ID, languageId: 'python' }),
			getRuntimeState: () => RuntimeState.Uninitialized,
			onDidChangeRuntimeState: Event.None,
			getPackageManager: () => packageManager,
		});
		getVulnerabilities.mockResolvedValue(lookupResult([['numpy', [ADVISORY]]]));

		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		const [, stage2] = await fires;

		expect(stage2.find(p => p.name === 'numpy')?.vulnerabilities).toEqual([ADVISORY]);
	});

	it('refetches every package on refreshPackageMetadata, ignoring the freshness window', async () => {
		// What a settings change relies on: cached entries are still fresh but
		// carry no advisories, so nothing would appear without a forced refetch.
		seed({
			numpy: { version: '1.26.0', outdated: true, latestVersion: '2.0.0' },
			pandas: { version: '2.0.0', outdated: false },
		}, 1 * HOUR_MS);

		const instance = makeInstance();
		await instance.refreshPackages();
		getVulnerabilities.mockResolvedValue(lookupResult([['numpy', [ADVISORY]]]));

		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 1);
		instance.refreshPackageMetadata();
		const [refreshed] = await fires;

		expect(refreshed.find(p => p.name === 'numpy')?.vulnerabilities).toEqual([ADVISORY]);
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
});
