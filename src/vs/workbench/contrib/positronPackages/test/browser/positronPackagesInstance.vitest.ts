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
		vulnerabilityLookup = stubInterface<PackageVulnerabilityLookup>({ getVulnerabilities, enabled: true });

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

	/**
	 * A lookup result carrying `advisories` for the named packages. `queried`
	 * defaults to those same names; pass it explicitly to model a partial
	 * lookup that never reached some of the packages it was given.
	 */
	function lookupResult(
		advisories: Array<[string, typeof ADVISORY[] | []]>,
		queried: string[] = advisories.map(([name]) => name),
	): IPackageVulnerabilityResult {
		return { source: SOURCE, vulnerabilities: new Map(advisories), queried: new Set(queried) };
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
		// Fully covered means both sources answered: outdated state is present
		// and an advisory lookup answered (vulnerabilitiesCheckedAt), even if
		// it reported nothing.
		seed({
			numpy: { version: '1.26.0', outdated: true, latestVersion: '2.0.0', vulnerabilitiesCheckedAt: SOURCE.fetchedAt },
			pandas: { version: '2.0.0', outdated: false, vulnerabilitiesCheckedAt: SOURCE.fetchedAt },
		}, 1 * HOUR_MS);

		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 1);
		await instance.refreshPackages();
		const [stage1] = await fires;

		expect(stage1.find(p => p.name === 'numpy')?.latestVersion).toBe('2.0.0');
		// Give a microtask for any (incorrectly scheduled) Stage 2 to run.
		await new Promise(resolve => setTimeout(resolve, 10));
		expect(getPackageMetadata).not.toHaveBeenCalled();
		expect(getVulnerabilities).not.toHaveBeenCalled();
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
			pandas: { version: '2.0.0', outdated: false, vulnerabilitiesCheckedAt: SOURCE.fetchedAt },
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

	it('serves a second session of the same interpreter from the shared cache without refetching metadata', async () => {
		// Both sources answer fully in the first session's round, so every entry
		// is covered: outdated state plus an advisory answer for each package.
		getVulnerabilities.mockResolvedValue(lookupResult([['numpy', [ADVISORY]], ['pandas', []]]));

		const first = makeInstance();
		const firstFires = waitForEvents(first.onDidRefreshPackagesInstance, 2);
		await first.refreshPackages();
		await firstFires;

		// A second console for the same interpreter: a new session id but the same
		// runtime id and the same shared cache (the packages service threads one
		// cache into every instance). The per-console cost #12994 worries about
		// is the repository round trip; the kernel-side list stays per-session.
		const session2 = stubInterface<ILanguageRuntimeSession>({
			sessionId: 'session-2',
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ runtimeId: RUNTIME_ID, languageId: 'python' }),
			getRuntimeState: () => RuntimeState.Uninitialized,
			onDidChangeRuntimeState: Event.None,
			getPackageManager: () => packageManager,
		});
		const second = disposables.add(new PositronPackagesInstance(session2, new NullLogService(), cache, vulnerabilityLookup));
		const secondFires = waitForEvents(second.onDidRefreshPackagesInstance, 2);
		await second.refreshPackages();
		const [stage1] = await secondFires;

		// Give a microtask for any (incorrectly issued) refetch to run.
		await new Promise(resolve => setTimeout(resolve, 10));

		// The kernel list is read once per session; the metadata round trips
		// happened once per interpreter.
		expect(getPackages).toHaveBeenCalledTimes(2);
		expect(getPackageMetadata).toHaveBeenCalledTimes(1);
		expect(getVulnerabilities).toHaveBeenCalledTimes(1);
		// And the second console renders the shared metadata immediately, in its
		// very first (Stage 1) push.
		expect(stage1.find(p => p.name === 'numpy')).toMatchObject({
			outdated: true,
			latestVersion: '2.1.0',
			vulnerabilities: [ADVISORY],
		});
	});

	it('fetches metadata for a large library in one batched call per source', async () => {
		// #12994 scale: thousands of installed packages. The instance must hand
		// each source the whole list at once -- one kernel metadata call and one
		// lookup invocation -- rather than degrading to per-package calls.
		const largeLibrary = Array.from({ length: 5000 }, (_, i) => pkg(`pkg-${i}`, '1.0.0'));
		getPackages.mockResolvedValue(largeLibrary);
		getPackageMetadata.mockImplementation(async (names) =>
			new Map(names.map((name): [string, Partial<ILanguageRuntimePackage>] => [name, { outdated: true, latestVersion: '2.0.0' }])));
		getVulnerabilities.mockResolvedValue(lookupResult(largeLibrary.map((p): [string, []] => [p.name, []])));

		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		const [, stage2] = await fires;

		expect(getPackageMetadata).toHaveBeenCalledTimes(1);
		expect(getPackageMetadata.mock.calls[0][0]).toHaveLength(5000);
		expect(getVulnerabilities).toHaveBeenCalledTimes(1);
		expect(getVulnerabilities.mock.calls[0][2]).toHaveLength(5000);
		// The merge covers the whole library, first row to last...
		expect(stage2[4999]).toMatchObject({ name: 'pkg-4999', outdated: true, latestVersion: '2.0.0', vulnerabilities: [] });
		// ...and the whole set persists, so the next session starts warm.
		expect(Object.keys(cache.get(RUNTIME_ID)?.packages ?? {})).toHaveLength(5000);
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

	it('keeps cached advisories for packages a partial lookup never reached', async () => {
		// A failed chunk (or a spent budget) leaves its packages unqueried.
		// Silence about a package nobody asked about is not an all-clear.
		seed({
			numpy: { version: '1.26.0', outdated: true, vulnerabilities: [ADVISORY] },
			pandas: { version: '2.0.0', outdated: true, vulnerabilities: [ADVISORY] },
		}, 25 * HOUR_MS, SOURCE);
		getVulnerabilities.mockResolvedValue(lookupResult([['pandas', []]], ['pandas']));

		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		const [, stage2] = await fires;

		expect(stage2.find(p => p.name === 'numpy')?.vulnerabilities).toEqual([ADVISORY]);
		expect(stage2.find(p => p.name === 'pandas')?.vulnerabilities).toEqual([]);
	});

	it('retries outdated state after a round where only the advisory lookup answered', async () => {
		// The advisory entries written by that round must not make the packages
		// look fresh, or the update indicator stays missing until the freshness
		// window ages out.
		getPackageMetadata.mockRejectedValueOnce(new Error('pip list --outdated failed'));
		getVulnerabilities.mockResolvedValue(lookupResult([['numpy', [ADVISORY]], ['pandas', []]]));

		const instance = makeInstance();
		const first = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		await first;

		const second = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		const [, stage2] = await second;

		expect(getPackageMetadata).toHaveBeenCalledTimes(2);
		expect(stage2.find(p => p.name === 'numpy')).toMatchObject({ outdated: true, latestVersion: '2.1.0' });
	});

	it('retries advisories after a round where the lookup failed, without redoing the outdated fetch', async () => {
		// A transient advisory failure must not count as fresh: without the
		// per-package answered marker, the entry written by the round where
		// only the runtime metadata landed would suppress the lookup until the
		// freshness window aged out (24h by default, surviving restarts).
		getVulnerabilities.mockResolvedValueOnce(undefined);

		const instance = makeInstance();
		const first = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		await first;

		getVulnerabilities.mockResolvedValue(lookupResult([['numpy', [ADVISORY]], ['pandas', []]]));
		const second = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		const [, stage2] = await second;

		// The advisory lookup is retried for the packages it never answered
		// for, but the outdated state the runtime already reported is not
		// refetched along with it.
		expect(getVulnerabilities).toHaveBeenCalledTimes(2);
		expect(getVulnerabilities.mock.calls[1][2]).toEqual([
			{ name: 'numpy', version: '1.26.0' },
			{ name: 'pandas', version: '2.0.0' },
		]);
		expect(getPackageMetadata).toHaveBeenCalledTimes(1);
		expect(stage2.find(p => p.name === 'numpy')).toMatchObject({
			outdated: true,
			latestVersion: '2.1.0',
			vulnerabilities: [ADVISORY],
		});
	});

	it('does not retry advisories once a lookup answered, even with none to report', async () => {
		getVulnerabilities.mockResolvedValue(lookupResult([['numpy', []], ['pandas', []]]));

		const instance = makeInstance();
		const first = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		await first;

		await instance.refreshPackages();
		await new Promise(resolve => setTimeout(resolve, 10));

		expect(getVulnerabilities).toHaveBeenCalledTimes(1);
	});

	it('skips the advisory lookup when the feature is disabled', async () => {
		vulnerabilityLookup = stubInterface<PackageVulnerabilityLookup>({ getVulnerabilities, enabled: false });

		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		const [, stage2] = await fires;

		expect(getVulnerabilities).not.toHaveBeenCalled();
		// The outdated state still lands.
		expect(stage2.find(p => p.name === 'numpy')?.latestVersion).toBe('2.1.0');
	});

	it('describes the library copy the pane shows when a package is installed twice', async () => {
		// R installs the same package into several library paths, and the pane
		// shows the first (library search order). The single cache entry has to
		// describe that copy: anchored to the last copy's version instead, the
		// version-match guard threw the metadata away, leaving no update
		// indicator and no advisories on exactly the packages that live in two
		// libraries -- which for CRAN is the base and recommended ones.
		getPackages.mockResolvedValue([
			{ ...pkg('Matrix', '1.6-1'), id: 'Matrix-project' },
			{ ...pkg('Matrix', '1.6-0'), id: 'Matrix-system' },
			pkg('jsonlite', '1.8.0'),
		]);
		getPackageMetadata.mockResolvedValue(new Map<string, Partial<ILanguageRuntimePackage>>([
			['matrix', { outdated: true, latestVersion: '1.7-0' }],
		]));
		getVulnerabilities.mockResolvedValue(lookupResult([['matrix', [ADVISORY]]]));

		const instance = makeInstance();
		const fires = waitForEvents(instance.onDidRefreshPackagesInstance, 2);
		await instance.refreshPackages();
		const [, stage2] = await fires;

		expect(stage2.find(p => p.id === 'Matrix-project')).toMatchObject({
			outdated: true,
			latestVersion: '1.7-0',
			vulnerabilities: [ADVISORY],
		});
		// The shadowed copy isn't asked about at all: two answers keyed to one
		// cache slot would let the version the pane doesn't show win.
		expect(getVulnerabilities.mock.calls[0][2]).toEqual([
			{ name: 'Matrix', version: '1.6-1' },
			{ name: 'jsonlite', version: '1.8.0' },
		]);
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
			numpy: { version: '1.26.0', outdated: true, latestVersion: '2.0.0', vulnerabilitiesCheckedAt: SOURCE.fetchedAt },
			pandas: { version: '2.0.0', outdated: false, vulnerabilitiesCheckedAt: SOURCE.fetchedAt },
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

	describe('clearMetadata', () => {
		it('drops cached state in memory and on disk, leaving the next read cold', async () => {
			// Both packages covered by a fresh entry, so the snapshot below
			// reports the cache without fetching anything.
			seed({
				numpy: {
					version: '1.26.0',
					outdated: true,
					latestVersion: '2.0.0',
					vulnerabilities: [ADVISORY],
					vulnerabilitiesCheckedAt: Date.now(),
				},
				pandas: { version: '2.0.0', outdated: false, vulnerabilities: [], vulnerabilitiesCheckedAt: Date.now() },
			}, 0, SOURCE);
			const instance = makeInstance();
			await instance.getPackagesSnapshot();
			// The warm state this is about to undo.
			expect(instance.vulnerabilitySource).toEqual(SOURCE);
			expect(instance.packages.find(p => p.name === 'numpy')?.vulnerabilities).toEqual([ADVISORY]);

			instance.clearMetadata();

			// Nothing left in memory, on disk, or attributed to a source.
			expect(instance.packages.map(p => [p.outdated, p.latestVersion, p.vulnerabilities]))
				.toEqual([[undefined, undefined, undefined], [undefined, undefined, undefined]]);
			expect(instance.vulnerabilitySource).toBeUndefined();
			expect(cache.get(RUNTIME_ID)).toBeUndefined();

			// The point of the whole exercise: the next read behaves like a cold
			// start, going back out for advisories instead of reporting the
			// cache it just dropped.
			// Both installed packages are asked about and answered for -- pandas
			// is known to the repository and clean -- so this is a full answer.
			getVulnerabilities.mockResolvedValue(lookupResult([['numpy', [ADVISORY]], ['pandas', []]]));
			const snapshot = await instance.getPackagesSnapshot();
			expect(getVulnerabilities).toHaveBeenCalledTimes(1);
			expect(snapshot.vulnerabilityStatus).toBe('fresh');
		});

		it('cancels a fetch in flight so it cannot refill what was cleared', async () => {
			// Without the cancel, the clear looks like it worked and then
			// silently undoes itself when the fetch lands a moment later.
			let releaseFetch: () => void = () => { };
			getPackageMetadata.mockImplementationOnce(() => new Promise(resolve => {
				releaseFetch = () => resolve(new Map<string, Partial<ILanguageRuntimePackage>>([
					['numpy', { outdated: true, latestVersion: '2.1.0' }],
				]));
			}));
			const instance = makeInstance();
			// refreshPackages leaves its metadata fetch running in the background.
			await instance.refreshPackages();

			instance.clearMetadata();
			releaseFetch();
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(instance.packages.find(p => p.name === 'numpy')?.outdated).toBeUndefined();
			expect(cache.get(RUNTIME_ID)).toBeUndefined();
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
				// Nothing was cached, so the advisories were gap-filled too --
				// the default lookup answers undefined, hence 'unavailable'.
				vulnerabilityStatus: 'unavailable',
				vulnerabilitySource: undefined,
				packages: [
					{ ...pkg('numpy', '1.26.0'), outdated: true, latestVersion: '2.1.0' },
					{ ...pkg('pandas', '2.0.0'), outdated: true, latestVersion: '2.2.0' },
				],
			});
			// The caller never has to ask twice: a cold cache is filled here.
			expect(getVulnerabilities).toHaveBeenCalledTimes(1);
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
			// Neither stage got to run: the wait this caller was willing to make
			// was spent joining someone else's fetch, so the advisories are
			// timed-out too rather than reported as a lookup that answered. The
			// one call is the joined refresh's own, not a second lookup issued
			// by the snapshot.
			expect(snapshot.vulnerabilityStatus).toBe('timed-out');
			expect(getVulnerabilities).toHaveBeenCalledTimes(1);

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

			expect(await instance.getPackagesSnapshot()).toEqual({
				packages: [],
				metadataStatus: 'unsupported',
				vulnerabilityStatus: 'cached',
				vulnerabilitySource: undefined,
			});
		});

		it('still reports advisories for a runtime that has no outdated state to give', async () => {
			// The two sources are independent: advisories are Positron's own
			// lookup and don't go through getPackageMetadata. Answering
			// 'unsupported' and stopping there -- as this did before the stages
			// were split -- would leave every runtime without metadata support
			// silently advisory-free in the payload an agent reads.
			const packageManager = stubInterface<ILanguageRuntimePackageManager>({
				getPackages,
				getPackageMetadata: undefined,
				packageRepositoryUrl: async () => 'https://ppm.example.com/pypi/latest/simple',
				repositoryRequest,
			});
			session = stubInterface<ILanguageRuntimeSession>({
				sessionId: 'session-1',
				runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ runtimeId: RUNTIME_ID, languageId: 'python' }),
				getRuntimeState: () => RuntimeState.Uninitialized,
				onDidChangeRuntimeState: Event.None,
				getPackageManager: () => packageManager,
			});
			getVulnerabilities.mockResolvedValue(lookupResult([['numpy', [ADVISORY]], ['pandas', []]]));
			const instance = makeInstance();

			const snapshot = await instance.getPackagesSnapshot();

			expect(snapshot.metadataStatus).toBe('unsupported');
			expect(snapshot.vulnerabilityStatus).toBe('fresh');
			expect(snapshot.vulnerabilitySource).toEqual(SOURCE);
			expect(snapshot.packages.map(p => [p.name, p.outdated, p.vulnerabilities])).toEqual([
				['numpy', undefined, [ADVISORY]],
				['pandas', undefined, []],
			]);
		});

		it('reports unsupported rather than fresh for an empty library with no metadata support', async () => {
			// Nothing installed is current on both counts, but the outdated
			// half is still unsupported: labelling it 'fresh' would tell a
			// caller this runtime reports outdated state when it never can.
			getPackages.mockResolvedValue([]);
			const packageManager = stubInterface<ILanguageRuntimePackageManager>({
				getPackages,
				getPackageMetadata: undefined,
				packageRepositoryUrl: async () => 'https://ppm.example.com/pypi/latest/simple',
				repositoryRequest,
			});
			session = stubInterface<ILanguageRuntimeSession>({
				sessionId: 'session-1',
				runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ runtimeId: RUNTIME_ID, languageId: 'python' }),
				getRuntimeState: () => RuntimeState.Uninitialized,
				onDidChangeRuntimeState: Event.None,
				getPackageManager: () => packageManager,
			});
			const instance = makeInstance();

			expect(await instance.getPackagesSnapshot()).toEqual({
				packages: [],
				metadataStatus: 'unsupported',
				vulnerabilityStatus: 'fresh',
				vulnerabilitySource: undefined,
			});
			expect(getVulnerabilities).not.toHaveBeenCalled();
		});

		it('looks advisories up for a cold cache, asking about the versions actually installed', async () => {
			getVulnerabilities.mockResolvedValue(lookupResult([['numpy', [ADVISORY]], ['pandas', []]]));
			const instance = makeInstance();

			const snapshot = await instance.getPackagesSnapshot();

			expect(snapshot.vulnerabilityStatus).toBe('fresh');
			expect(snapshot.vulnerabilitySource).toEqual(SOURCE);
			expect(snapshot.packages.map(p => [p.name, p.vulnerabilities])).toEqual([
				['numpy', [ADVISORY]],
				// Asked about and reported clean: an empty array, not undefined.
				['pandas', []],
			]);
			// Advisories are version-specific, and the names go out as the
			// session reported them -- a repository asked about 'numpy' has not
			// been asked about 'Numpy'.
			expect(getVulnerabilities.mock.calls[0][2]).toEqual([
				{ name: 'numpy', version: '1.26.0' },
				{ name: 'pandas', version: '2.0.0' },
			]);
		});

		it('reports unavailable when the lookup produces nothing', async () => {
			// The lookup swallows its own transport failures, so this covers
			// both "no Package Manager serves advisories here" and "the lookup
			// failed" -- neither of which another round trip would fix.
			getVulnerabilities.mockResolvedValue(undefined);
			const instance = makeInstance();

			const snapshot = await instance.getPackagesSnapshot();

			expect(snapshot.vulnerabilityStatus).toBe('unavailable');
			// The outdated half still answered: one source failing must not
			// cost the caller the other.
			expect(snapshot.metadataStatus).toBe('fresh');
		});

		it('reports unavailable when the runtime cannot carry a repository request', async () => {
			// The renderer can't reach a Package Manager API itself, so without
			// this hook no advisory lookup is possible at all.
			packageManager = stubInterface<ILanguageRuntimePackageManager>({
				getPackages,
				getPackageMetadata,
				repositoryRequest: undefined,
				installPackages: async () => undefined,
				uninstallPackages: async () => undefined,
				updatePackages: async () => undefined,
				updateAllPackages: async () => undefined,
			});
			const instance = makeInstance();

			const snapshot = await instance.getPackagesSnapshot();

			expect(snapshot.vulnerabilityStatus).toBe('unavailable');
			expect(getVulnerabilities).not.toHaveBeenCalled();
		});

		it('bounds the lookup rather than waiting out its own 90s budget', async () => {
			getVulnerabilities.mockImplementation(() => new Promise(() => { /* never settles */ }));
			const instance = makeInstance();

			const snapshot = await instance.getPackagesSnapshot(CancellationToken.None, { vulnerabilityTimeoutMs: 10 });

			// The packages and their outdated state are the valuable part; a
			// hung advisory lookup must not cost the caller either.
			expect(snapshot.vulnerabilityStatus).toBe('timed-out');
			expect(snapshot.metadataStatus).toBe('fresh');
			expect(snapshot.packages.map(p => p.name)).toEqual(['numpy', 'pandas']);
		});

		it('reports disabled without looking anything up when advisories are turned off', async () => {
			vulnerabilityLookup = stubInterface<PackageVulnerabilityLookup>({ getVulnerabilities, enabled: false });
			// Cached advisories from before the setting was turned off: the
			// status has to say they aren't being reported.
			seed({ numpy: { version: '1.26.0', vulnerabilities: [ADVISORY], vulnerabilitiesCheckedAt: Date.now() } }, 0, SOURCE);
			const instance = makeInstance();

			const snapshot = await instance.getPackagesSnapshot();

			expect(snapshot.vulnerabilityStatus).toBe('disabled');
			// No source either: naming one would attribute data the caller is
			// being told it doesn't have.
			expect(snapshot.vulnerabilitySource).toBeUndefined();
			expect(getVulnerabilities).not.toHaveBeenCalled();
		});

		it('reports the cached advisories, and the instance that served them, without a lookup', async () => {
			// The warm-start case: a lookup answered in an earlier session and
			// the entry was persisted, so every package already has an answer
			// and there is nothing to gap-fill.
			seed({
				numpy: { version: '1.26.0', vulnerabilities: [ADVISORY], vulnerabilitiesCheckedAt: Date.now() },
				pandas: { version: '2.0.0', vulnerabilities: [], vulnerabilitiesCheckedAt: Date.now() },
			}, 0, SOURCE);
			const instance = makeInstance();

			const snapshot = await instance.getPackagesSnapshot();

			expect(snapshot.vulnerabilityStatus).toBe('cached');
			expect(snapshot.vulnerabilitySource).toEqual(SOURCE);
			expect(snapshot.packages.find(p => p.name === 'numpy')?.vulnerabilities).toEqual([ADVISORY]);
			// The auto lookup must not cost a warm cache a round trip on every
			// call -- that's what makes gap-filling affordable by default.
			expect(getVulnerabilities).not.toHaveBeenCalled();
		});

		it('asks only about the packages it has no advisory answer for', async () => {
			// numpy was asked about and reported clean; the empty array is an
			// answer, so re-asking would be a round trip for nothing. pandas has
			// no advisory marker, so it is the gap.
			seed({
				numpy: { version: '1.26.0', vulnerabilities: [], vulnerabilitiesCheckedAt: Date.now() },
				pandas: { version: '2.0.0', outdated: false },
			}, 0, SOURCE);
			getVulnerabilities.mockResolvedValue(lookupResult([['pandas', [ADVISORY]]]));
			const instance = makeInstance();

			const snapshot = await instance.getPackagesSnapshot();

			expect(getVulnerabilities.mock.calls[0][2]).toEqual([{ name: 'pandas', version: '2.0.0' }]);
			// A gap-fill leaves the rest as of the last full lookup, which is
			// what 'cached' says.
			expect(snapshot.vulnerabilityStatus).toBe('cached');
			expect(snapshot.packages.map(p => [p.name, p.vulnerabilities])).toEqual([
				['numpy', []],
				['pandas', [ADVISORY]],
			]);
		});

		it('serves a fresh cache for a package installed twice without refetching it', async () => {
			// The shadowed copy carries the other library's version, so it never
			// matches the single cache entry. Asked about anyway, it is a gap
			// that can never be filled -- every call would refetch the whole
			// library and merge the answer straight back under the visible
			// copy's version.
			getPackages.mockResolvedValue([
				{ ...pkg('Matrix', '1.6-1'), id: 'Matrix-project' },
				{ ...pkg('Matrix', '1.6-0'), id: 'Matrix-system' },
			]);
			seed({
				matrix: {
					version: '1.6-1',
					outdated: true,
					latestVersion: '1.7-0',
					vulnerabilities: [],
					vulnerabilitiesCheckedAt: Date.now(),
				},
			}, 0, SOURCE);
			const instance = makeInstance();

			const snapshot = await instance.getPackagesSnapshot();

			expect(snapshot.metadataStatus).toBe('cached');
			expect(snapshot.vulnerabilityStatus).toBe('cached');
			expect(getPackageMetadata).not.toHaveBeenCalled();
			expect(getVulnerabilities).not.toHaveBeenCalled();
		});

		it('hands the lookup its budget so partial chunks survive, and labels them', async () => {
			// The lookup asks in chunks of 100 and keeps whatever answered
			// within its budget. Bounding it from out here with a timeout
			// instead would throw away every chunk that had already come back,
			// so the budget goes in as an argument.
			getVulnerabilities.mockResolvedValue(lookupResult([['numpy', [ADVISORY]]], ['numpy']));
			const instance = makeInstance();

			const snapshot = await instance.getPackagesSnapshot(CancellationToken.None, { vulnerabilityTimeoutMs: 1_000 });

			expect(getVulnerabilities.mock.calls[0][4]).toBe(1_000);
			// What answered is kept and persisted, so the next call only has to
			// fill the rest.
			expect(snapshot.packages.map(p => [p.name, p.vulnerabilities])).toEqual([
				['numpy', [ADVISORY]],
				['pandas', undefined],
			]);
			expect(cache.get(RUNTIME_ID)?.packages.numpy?.vulnerabilities).toEqual([ADVISORY]);
			// But pandas was never reached, so this is not the full answer
			// 'fresh' would claim.
			expect(snapshot.vulnerabilityStatus).toBe('timed-out');
		});

		it('reports timed-out rather than unavailable when a lookup spends the whole budget', async () => {
			// Nothing came back, but the lookup was answering rather than
			// missing: a caller told 'unavailable' would stop asking.
			getVulnerabilities.mockImplementation(async (_lang, _access, _specs, _token, budgetMs) => {
				// Spends the budget it was handed, as a lookup whose first chunk
				// never came back does, then reports nothing.
				await new Promise(resolve => setTimeout(resolve, (budgetMs ?? 0) + 5));
				return undefined;
			});
			const instance = makeInstance();

			const snapshot = await instance.getPackagesSnapshot(CancellationToken.None, { vulnerabilityTimeoutMs: 20 });

			expect(snapshot.vulnerabilityStatus).toBe('timed-out');
		});

		it('judges timed-out against the lookup ceiling when the caller budget is above it', async () => {
			// The lookup clamps any budget it is handed to its own 90s ceiling,
			// so that is the most a lookup ever spends. A caller willing to
			// wait longer must not have a budget-exhausted lookup labelled
			// 'unavailable' -- documented as not worth retrying -- just because
			// the ceiling expired before the caller's own number did.
			vi.useFakeTimers();
			try {
				getVulnerabilities.mockImplementation(async (_lang, _access, _specs, _token, budgetMs) => {
					// Spends the budget it actually runs under, as the real
					// lookup does, then reports nothing.
					vi.setSystemTime(Date.now() + Math.min(budgetMs ?? 0, 90_000));
					return undefined;
				});
				const instance = makeInstance();

				const snapshot = await instance.getPackagesSnapshot(CancellationToken.None, { vulnerabilityTimeoutMs: 10 * 60 * 1000 });

				expect(snapshot.vulnerabilityStatus).toBe('timed-out');
			} finally {
				vi.useRealTimers();
			}
		});
	});
});
