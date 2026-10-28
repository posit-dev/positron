/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Barrier, DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { isWeb } from '../../../../../base/common/platform.js';
import { arch as systemArch } from '../../../../../base/common/process.js';
import { IConfigurationOverrides, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IEphemeralStateService } from '../../../../../platform/ephemeralState/common/ephemeralState.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { IFileService, IFileStatWithPartialMetadata } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { INotificationService, IPromptChoice, IPromptOptions, Severity } from '../../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { IProgressService } from '../../../../../platform/progress/common/progress.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IWorkbenchEnvironmentService } from '../../../environment/common/environmentService.js';
import { ExtensionMessageCollector, ExtensionsRegistry } from '../../../extensions/common/extensionsRegistry.js';
import {
	IHostedLanguageContribution,
	ILanguageRuntimeMetadata,
	ILanguageRuntimeService,
	IRuntimeManager,
	IRuntimeRootSignature,
	LanguageRuntimeArchitecture,
	LanguageRuntimeSessionLocation,
	LanguageRuntimeSessionMode,
	LanguageRuntimeStartupBehavior,
	LanguageStartupBehavior,
	RuntimeStartupPhase,
	RuntimeState,
} from '../../../languageRuntime/common/languageRuntimeService.js';
import { BeforeShutdownEvent, ILifecycleService, WillShutdownEvent } from '../../../lifecycle/common/lifecycle.js';
import { IPathService } from '../../../path/common/pathService.js';
import { IPositronNewFolderService, NewFolderStartupPhase } from '../../../positronNewFolder/common/positronNewFolder.js';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata, IRuntimeSessionService, SessionStartReasonId } from '../../../runtimeSession/common/runtimeSessionService.js';
import { createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../runtimeSession/test/common/testRuntimeSessionService.js';
import { TestLanguageRuntimeSession } from '../../../runtimeSession/test/common/testLanguageRuntimeSession.js';
import { TestRuntimeSessionManager } from '../../../../test/common/positronWorkbenchTestServices.js';
import { createInterpreterVariant } from '../../../languageRuntime/common/interpreterDefinitions.js';
import { RuntimeStartupService } from '../../common/runtimeStartup.js';
import { RuntimeDiscoveryCache } from '../../common/runtimeDiscoveryCache.js';
import { SerializedSessionMetadata } from '../../common/runtimeStartupService.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import {
	ICachedRuntime,
	IDiscoveryCacheBucket,
	IDiscoveryCacheSessionCounters,
	IRuntimeDiscoveryCache,
	IRuntimeFingerprint,
} from '../../common/runtimeDiscoveryCacheService.js';

/**
 * Test-only extension to `IRuntimeDiscoveryCache` so test code can populate
 * buckets and toggle the enabled flag without colliding with the interface.
 */
interface ITestDiscoveryCache extends IRuntimeDiscoveryCache {
	setBucket(bucket: IDiscoveryCacheBucket): void;
	setEnabled(enabled: boolean): void;
	/**
	 * Stub for `statRuntimePath`. By default returns a fixed valid fingerprint
	 * so `loadFromDiscoveryCache` treats every cached entry as still-on-disk.
	 * Override in a test to simulate `path gone` (return `undefined`) or a
	 * changed fingerprint (return different size/mtime/ctime).
	 */
	setStatRuntimePathBehavior(behavior: (path: string) => { resolvedPath: string; fingerprint: IRuntimeFingerprint } | undefined): void;
}

/**
 * Build a discovery-cache stub for the warm-start decision tests. The stub
 * only implements the methods the code paths under test actually consult --
 * `stubInterface` throws on unset reads, which surfaces "test grew a new
 * dependency" failures with a clear message instead of `undefined is not a
 * function`. Add overrides here when tests need a new method.
 */
function createTestCache(): ITestDiscoveryCache {
	const buckets = new Map<string, IDiscoveryCacheBucket>();
	let enabled = true;
	const bucketKey = (extId: string, langId: string) => `${extId}::${langId}`;
	let statBehavior: (path: string) => { resolvedPath: string; fingerprint: IRuntimeFingerprint } | undefined =
		(path) => ({ resolvedPath: path, fingerprint: { size: 1, mtimeMs: 1, ctimeMs: 1 } });
	const counters: IDiscoveryCacheSessionCounters = {
		foregroundHits: 0,
		revalidationsAttempted: 0,
		revalidationsSucceeded: 0,
		revalidationsFailed: 0,
		evictions: 0,
		rootsChangedFullDiscoveries: 0,
		fullDiscoveryRuns: [],
	};
	return stubInterface<ITestDiscoveryCache>({
		isEnabled: () => enabled,
		getAllBuckets: () => enabled ? Array.from(buckets.values()) : [],
		getEntries: (extId, langId) => enabled ? (buckets.get(bucketKey(extId, langId))?.entries ?? []) : [],
		getLastFullDiscovery: (extId, langId) => buckets.get(bucketKey(extId, langId))?.lastFullDiscovery,
		getDiscoveryRootSignature: (extId, langId) => buckets.get(bucketKey(extId, langId))?.discoveryRootSignature,
		statRuntimePath: async (path: string) => statBehavior(path),
		invalidate: (extId: string, langId: string, path: string) => {
			const bucket = buckets.get(bucketKey(extId, langId));
			if (bucket) {
				const filtered = bucket.entries.filter(e => e.metadata.runtimePath !== path);
				buckets.set(bucketKey(extId, langId), { ...bucket, entries: filtered });
			}
		},
		upsert: async (md: ILanguageRuntimeMetadata) => {
			const key = bucketKey(md.extensionId.value, md.languageId);
			const bucket = buckets.get(key);
			const entry: ICachedRuntime = {
				metadata: md,
				fingerprint: { size: 1, mtimeMs: 1, ctimeMs: 1 },
				resolvedPath: md.runtimePath,
				firstSeen: Date.now(),
				lastValidated: Date.now(),
			};
			const others = (bucket?.entries ?? []).filter(e => e.metadata.runtimePath !== md.runtimePath);
			buckets.set(key, {
				extensionId: md.extensionId.value,
				languageId: md.languageId,
				entries: [...others, entry],
				lastFullDiscovery: bucket?.lastFullDiscovery ?? 0,
				discoveryRootSignature: bucket?.discoveryRootSignature,
			});
			return entry;
		},
		markValidated: () => true,
		sessionCounters: counters,
		setBucket(bucket: IDiscoveryCacheBucket) {
			buckets.set(`${bucket.extensionId}::${bucket.languageId}`, bucket);
		},
		setEnabled(value: boolean) {
			enabled = value;
		},
		setStatRuntimePathBehavior(behavior) {
			statBehavior = behavior;
		},
	});
}

/**
 * Manager test double. Each piece of behavior is configurable per test.
 */
interface IManagerOptions {
	id: number;
	owns: ILanguageRuntimeMetadata[];
	rootSignatureByLanguage?: Record<string, IRuntimeRootSignature>;
	/**
	 * Per-(extensionId, languageId) override. Takes precedence over
	 * `rootSignatureByLanguage` when both match. Lets tests model the bug
	 * where two managers register for the same languageId (e.g. python) but
	 * only one of them owns the signature.
	 */
	rootSignatureByPair?: Record<string, IRuntimeRootSignature>;
	rootSignatureBehavior?: 'normal' | 'throws' | 'never-resolves';
	/**
	 * The (extensionId, languageId) contributions this ext host hosts, with
	 * their `alwaysRediscover` flag. If omitted, derived from `owns` with all
	 * flags `false` (covers the existing cache-hit tests). Set explicitly to
	 * model an ext host with multiple language managers (e.g. r + zed) or to
	 * declare per-language `alwaysRediscover`.
	 */
	contributions?: IHostedLanguageContribution[];
	contributionsBehavior?: 'normal' | 'throws';
	/**
	 * Override for `validateMetadata`. Defaults to the identity function. Set
	 * this to model R's `current`-redirect, where revalidating a cached
	 * `current: true` entry returns metadata for a *different* binary (wherever
	 * the rig `current`/`Current` symlink now points).
	 */
	validate?: (m: ILanguageRuntimeMetadata) => Promise<ILanguageRuntimeMetadata>;
}

function makeManager(opts: IManagerOptions): IRuntimeManager {
	const ownsByPath = new Map(opts.owns.map(m => [m.runtimePath, m]));
	const contributions: IHostedLanguageContribution[] = opts.contributions ?? Array.from(
		new Map(opts.owns.map(m => [
			`${m.extensionId.value}::${m.languageId}`,
			{ extensionId: m.extensionId.value, languageId: m.languageId, alwaysRediscover: false },
		])).values(),
	);
	return {
		id: opts.id,
		discoverAllRuntimes: async () => { /* no-op for unit test */ },
		markDiscoveryComplete: () => { /* no-op for unit test */ },
		recommendWorkspaceRuntimes: async () => [],
		managesRuntime: async (metadata) => ownsByPath.has(metadata.runtimePath),
		validateMetadata: opts.validate ?? (async (m) => m),
		registerRuntimeFromPath: async () => undefined,
		pinnedWorkspaceRuntime: async () => undefined,
		getDiscoveryRootSignature: async (extensionId: string, languageId: string) => {
			if (opts.rootSignatureBehavior === 'throws') {
				throw new Error('boom');
			}
			if (opts.rootSignatureBehavior === 'never-resolves') {
				return new Promise<IRuntimeRootSignature | undefined>(() => { /* never */ });
			}
			const pairKey = `${extensionId}::${languageId}`;
			return opts.rootSignatureByPair?.[pairKey] ?? opts.rootSignatureByLanguage?.[languageId];
		},
		getHostedLanguageContributions: async () => {
			if (opts.contributionsBehavior === 'throws') {
				throw new Error('boom');
			}
			return contributions;
		},
	};
}

function metadata(overrides: {
	extensionId?: string;
	languageId?: string;
	runtimePath?: string;
	runtimeId?: string;
	cacheable?: boolean;
} = {}): ILanguageRuntimeMetadata {
	return {
		runtimePath: overrides.runtimePath ?? '/usr/bin/python3',
		runtimeId: overrides.runtimeId ?? 'rt-1',
		languageName: 'Python',
		languageId: overrides.languageId ?? 'python',
		languageVersion: '3.12.0',
		base64EncodedIconSvg: undefined,
		runtimeName: 'Python 3.12',
		runtimeShortName: '3.12',
		runtimeVersion: '0.1',
		runtimeSource: 'System',
		startupBehavior: LanguageRuntimeStartupBehavior.Implicit,
		sessionLocation: LanguageRuntimeSessionLocation.Workspace,
		extensionId: new ExtensionIdentifier(overrides.extensionId ?? 'ms.python'),
		extraRuntimeData: {},
		cacheable: overrides.cacheable ?? true,
	};
}

function makeBucket(opts: {
	extensionId: string;
	languageId: string;
	runtimePath: string;
	lastFullDiscovery?: number;
	signature?: IRuntimeRootSignature;
	/**
	 * Defaults to the runtime path so tests that register multiple buckets
	 * don't collide on the default `'rt-1'` id (the language runtime service
	 * silently no-ops a re-register with the same id).
	 */
	runtimeId?: string;
}): IDiscoveryCacheBucket {
	const md = metadata({
		extensionId: opts.extensionId,
		languageId: opts.languageId,
		runtimePath: opts.runtimePath,
		runtimeId: opts.runtimeId ?? opts.runtimePath,
	});
	const entry: ICachedRuntime = {
		metadata: md,
		fingerprint: { size: 1, mtimeMs: 1, ctimeMs: 1 },
		resolvedPath: opts.runtimePath,
		firstSeen: Date.now(),
		lastValidated: Date.now(),
	};
	return {
		extensionId: opts.extensionId,
		languageId: opts.languageId,
		entries: [entry],
		lastFullDiscovery: opts.lastFullDiscovery ?? 0,
		discoveryRootSignature: opts.signature,
	};
}

/**
 * The real discovery cache, over a file service where every interpreter path
 * exists and never changes.
 */
function makeRealCache(storageService: IStorageService, configurationService: IConfigurationService): RuntimeDiscoveryCache {
	const fileService = stubInterface<IFileService>({
		realpath: async () => undefined,
		stat: async () => stubInterface<IFileStatWithPartialMetadata>({ isFile: true, isDirectory: false, size: 1, mtime: 1, ctime: 1 }),
	});
	return new RuntimeDiscoveryCache(
		storageService,
		configurationService,
		fileService,
		new NullLogService(),
		stubInterface<IPathService>(),
	);
}

const sig = (entries: Array<[string, boolean, number]>, opaque?: string): IRuntimeRootSignature => ({
	entries: entries.map(([path, exists, mtimeMs]) => ({ path, exists, mtimeMs })),
	opaque,
});

describe('RuntimeStartupService - cache-aware discovery', () => {

	let cache: ITestDiscoveryCache = undefined!;
	let config: TestConfigurationService = undefined!;

	const ctx = createLightTestContainer()
		.withRuntimeServices()
		.stub(IEphemeralStateService, {
			getItem: () => Promise.resolve(undefined),
			setItem: () => Promise.resolve(),
		})
		.stub(ILifecycleService, {
			onBeforeShutdown: new Emitter<BeforeShutdownEvent>().event,
			onWillShutdown: new Emitter<WillShutdownEvent>().event,
		})
		.stub(IPositronNewFolderService, {
			onDidChangeNewFolderStartupPhase: new Emitter<NewFolderStartupPhase>().event,
			startupPhase: NewFolderStartupPhase.Complete,
		})
		.stub(IProgressService, {})
		.stub(IWorkbenchEnvironmentService, { remoteAuthority: undefined })
		.stub(INotificationService, new TestNotificationService())
		.stub(IRuntimeDiscoveryCache, {})
		.build();

	beforeEach(() => {
		// Replace the cache stub with a fresh fake. The builder runs *its* beforeEach
		// before this one, so our override here wins for the duration of the test.
		cache = createTestCache();
		config = new TestConfigurationService({});
		ctx.instantiationService.stub(IRuntimeDiscoveryCache, cache);
		ctx.instantiationService.stub(IConfigurationService, config);
	});

	function makeService(): RuntimeStartupService {
		return ctx.disposables.add(ctx.instantiationService.createInstance(RuntimeStartupService)) as RuntimeStartupService;
	}

	// `managersNeedingFullDiscovery` is private; test through string-index access.
	// The decision logic is the load-bearing part of the warm-start fast path,
	// and the public `discoverAllRuntimes` entry point would require simulating
	// the full startup phase machine just to get here.
	interface IPlan {
		manager: IRuntimeManager;
		runContributions: IHostedLanguageContribution[];
		skipLanguageIds: string[];
	}
	function managersNeedingFullDiscovery(svc: RuntimeStartupService): Promise<IPlan[]> {
		return (svc as unknown as { managersNeedingFullDiscovery: () => Promise<IPlan[]> })
			.managersNeedingFullDiscovery();
	}
	// Convenience for the most common assertion: which managers were planned for discovery?
	const managersFromPlans = (plans: IPlan[]) => plans.map(p => p.manager);

	function lastFullDiscoveryReason(svc: RuntimeStartupService): string {
		return (svc as unknown as { _lastFullDiscoveryReason: string })._lastFullDiscoveryReason;
	}

	describe('when the cache is disabled', () => {
		it('returns every registered manager regardless of cache state', async () => {
			cache.setEnabled(false);
			const svc = makeService();
			const m1 = makeManager({ id: 1, owns: [] });
			const m2 = makeManager({ id: 2, owns: [] });
			ctx.disposables.add(svc.registerRuntimeManager(m1));
			ctx.disposables.add(svc.registerRuntimeManager(m2));

			const plans = await managersNeedingFullDiscovery(svc);
			expect(managersFromPlans(plans)).toEqual([m1, m2]);
		});
	});

	describe('cold-start path', () => {
		it('flags a manager whose contributions have no cached entries', async () => {
			const svc = makeService();
			const pyManager = makeManager({
				id: 1,
				owns: [],
				contributions: [{ extensionId: 'ms.python', languageId: 'python', alwaysRediscover: false }],
			});
			ctx.disposables.add(svc.registerRuntimeManager(pyManager));

			const plans = await managersNeedingFullDiscovery(svc);
			expect(managersFromPlans(plans)).toEqual([pyManager]);
			expect(lastFullDiscoveryReason(svc)).toBe('cold-start');
		});

		it('skips a manager that hosts no contributions at all', async () => {
			// Ext host hasn't activated yet (or hosts no language runtime
			// managers); planner has nothing to do for it. Different from
			// cold-start, where the ext host *does* host contributions but
			// none of them are in the cache.
			cache.setBucket(makeBucket({
				extensionId: 'ms.python',
				languageId: 'python',
				runtimePath: '/usr/bin/python3',
				lastFullDiscovery: Date.now(),
				signature: sig([['/usr/bin', true, 1000]]),
			}));
			const svc = makeService();
			const rManager = makeManager({ id: 2, owns: [], contributions: [] });
			ctx.disposables.add(svc.registerRuntimeManager(rManager));

			const plans = await managersNeedingFullDiscovery(svc);
			expect(plans).toEqual([]);
		});
	});

	describe('warm-start fast path', () => {
		it('skips a manager whose bucket is fresh and signature matches', async () => {
			const rootSig = sig([['/usr/bin', true, 1000]]);
			const bucket = makeBucket({
				extensionId: 'ms.python',
				languageId: 'python',
				runtimePath: '/usr/bin/python3',
				lastFullDiscovery: Date.now(),
				signature: rootSig,
			});
			cache.setBucket(bucket);

			const svc = makeService();
			const pyManager = makeManager({
				id: 1,
				owns: [bucket.entries[0].metadata],
				rootSignatureByLanguage: { python: rootSig },
			});
			ctx.disposables.add(svc.registerRuntimeManager(pyManager));

			const plans = await managersNeedingFullDiscovery(svc);
			expect(plans).toEqual([]);
		});
	});

	describe('alwaysRediscover opt-out', () => {
		it('runs only the alwaysRediscover language when sibling languages are cache-satisfied', async () => {
			// Models the positron-zed scenario: zed and r share an ext host
			// (one IRuntimeManager hosts both contributions). R's cache is
			// fresh, zed has no cache and is marked alwaysRediscover. The
			// plan should run zed but skip r -- otherwise the cache PR is
			// pointless on warm starts because Zed's opt-out poisons R.
			const rootSig = sig([['/usr/local/bin/R', true, 1000]]);
			const rBucket = makeBucket({
				extensionId: 'positron.positron-r',
				languageId: 'r',
				runtimePath: '/usr/local/bin/R',
				lastFullDiscovery: Date.now(),
				signature: rootSig,
			});
			cache.setBucket(rBucket);

			const svc = makeService();
			const sharedHost = makeManager({
				id: 1,
				owns: [rBucket.entries[0].metadata],
				rootSignatureByLanguage: { r: rootSig },
				contributions: [
					{ extensionId: 'positron.positron-r', languageId: 'r', alwaysRediscover: false },
					{ extensionId: 'positron.positron-zed', languageId: 'zed', alwaysRediscover: true },
				],
			});
			ctx.disposables.add(svc.registerRuntimeManager(sharedHost));

			const plans = await managersNeedingFullDiscovery(svc);
			expect(plans).toEqual([{
				manager: sharedHost,
				runContributions: [
					{ extensionId: 'positron.positron-zed', languageId: 'zed', alwaysRediscover: true },
				],
				skipLanguageIds: ['r'],
			}]);
			expect(lastFullDiscoveryReason(svc)).toBe('always-rediscover');
		});

		it('falls back to a conservative whole-host run when the contributions probe throws', async () => {
			// A misbehaving ext host that throws from getHostedLanguageContributions
			// shouldn't strand its discovery; we plan a full pass with no skip
			// list, equivalent to the pre-cache behavior.
			const svc = makeService();
			const pyManager = makeManager({
				id: 1,
				owns: [],
				contributionsBehavior: 'throws',
			});
			ctx.disposables.add(svc.registerRuntimeManager(pyManager));

			const plans = await managersNeedingFullDiscovery(svc);
			expect(plans).toEqual([{ manager: pyManager, runContributions: [], skipLanguageIds: [] }]);
			expect(lastFullDiscoveryReason(svc)).toBe('cold-start');
		});
	});

	describe('periodic refresh', () => {
		it('flags a manager whose bucket has a never-recorded last-full-discovery', async () => {
			const rootSig = sig([['/usr/bin', true, 1000]]);
			const bucket = makeBucket({
				extensionId: 'ms.python',
				languageId: 'python',
				runtimePath: '/usr/bin/python3',
				lastFullDiscovery: 0, // never recorded
				signature: rootSig,
			});
			cache.setBucket(bucket);

			const svc = makeService();
			const pyManager = makeManager({
				id: 1,
				owns: [bucket.entries[0].metadata],
				rootSignatureByLanguage: { python: rootSig },
			});
			ctx.disposables.add(svc.registerRuntimeManager(pyManager));

			const plans = await managersNeedingFullDiscovery(svc);
			expect(managersFromPlans(plans)).toEqual([pyManager]);
			expect(lastFullDiscoveryReason(svc)).toBe('periodic');
		});

		it('flags a manager whose last-full-discovery is older than the periodic cap', async () => {
			const rootSig = sig([['/usr/bin', true, 1000]]);
			const longAgo = Date.now() - (25 * 60 * 60 * 1000); // 25h ago, beyond the 24h cap
			const bucket = makeBucket({
				extensionId: 'ms.python',
				languageId: 'python',
				runtimePath: '/usr/bin/python3',
				lastFullDiscovery: longAgo,
				signature: rootSig,
			});
			cache.setBucket(bucket);

			const svc = makeService();
			const pyManager = makeManager({
				id: 1,
				owns: [bucket.entries[0].metadata],
				rootSignatureByLanguage: { python: rootSig },
			});
			ctx.disposables.add(svc.registerRuntimeManager(pyManager));

			const plans = await managersNeedingFullDiscovery(svc);
			expect(managersFromPlans(plans)).toEqual([pyManager]);
			expect(lastFullDiscoveryReason(svc)).toBe('periodic');
		});
	});

	describe('root-signature change detection', () => {
		it('flags a manager whose signature differs from the persisted one', async () => {
			const persistedSig = sig([['/usr/bin', true, 1000]]);
			const currentSig = sig([['/usr/bin', true, 2000]]); // mtime moved
			const bucket = makeBucket({
				extensionId: 'ms.python',
				languageId: 'python',
				runtimePath: '/usr/bin/python3',
				lastFullDiscovery: Date.now(),
				signature: persistedSig,
			});
			cache.setBucket(bucket);

			const svc = makeService();
			const pyManager = makeManager({
				id: 1,
				owns: [bucket.entries[0].metadata],
				rootSignatureByLanguage: { python: currentSig },
			});
			ctx.disposables.add(svc.registerRuntimeManager(pyManager));

			const plans = await managersNeedingFullDiscovery(svc);
			expect(managersFromPlans(plans)).toEqual([pyManager]);
			expect(lastFullDiscoveryReason(svc)).toBe('roots-changed');
		});

		it('treats an undefined signature (manager opted out) as "fall back to periodic"', async () => {
			// Bucket is fresh and has no persisted signature. Manager returns undefined
			// from getDiscoveryRootSignature (didn't implement / no support for this lang).
			// Expectation: signature comparison contributes nothing; periodic-only logic
			// applies. Bucket is fresh -> no full pass needed.
			const bucket = makeBucket({
				extensionId: 'ms.python',
				languageId: 'python',
				runtimePath: '/usr/bin/python3',
				lastFullDiscovery: Date.now(),
			});
			cache.setBucket(bucket);

			const svc = makeService();
			const pyManager = makeManager({
				id: 1,
				owns: [bucket.entries[0].metadata],
				rootSignatureByLanguage: {}, // returns undefined for python
			});
			ctx.disposables.add(svc.registerRuntimeManager(pyManager));

			const plans = await managersNeedingFullDiscovery(svc);
			expect(plans).toEqual([]);
		});

		it('uses extensionId to disambiguate when two managers share a languageId', async () => {
			// Regression: two extensions can register a runtime manager for the
			// same language (e.g. ms-python.python and positron.positron-reticulate
			// both register for `python`). A signature lookup keyed on languageId
			// alone shadows the real owner with the sibling manager, which doesn't
			// implement `getDiscoveryRootSignature` and returns undefined -- so
			// `rootsChanged` evaluates to false and the pre-discovery cache wipe
			// is skipped, leaving a freshly-added `python.interpreters.exclude`
			// path live in cached entries. The fix keys the lookup on
			// (extensionId, languageId) so the right manager answers.
			const persistedSig = sig([['/usr/bin', true, 1000]]);
			const currentSig = sig([['/usr/bin', true, 2000]]); // mtime moved
			const bucket = makeBucket({
				extensionId: 'ms-python.python',
				languageId: 'python',
				runtimePath: '/usr/bin/python3',
				lastFullDiscovery: Date.now(),
				signature: persistedSig,
			});
			cache.setBucket(bucket);

			const svc = makeService();
			const pyManager = makeManager({
				id: 1,
				owns: [bucket.entries[0].metadata],
				// Only the real owner answers for its (extensionId, languageId);
				// `rootSignatureByLanguage` is deliberately unset so a buggy
				// caller keying on languageId alone would observe undefined.
				rootSignatureByPair: {
					'ms-python.python::python': currentSig,
				},
				contributions: [
					{ extensionId: 'ms-python.python', languageId: 'python', alwaysRediscover: false },
				],
			});
			ctx.disposables.add(svc.registerRuntimeManager(pyManager));

			const plans = await managersNeedingFullDiscovery(svc);
			expect(managersFromPlans(plans)).toEqual([pyManager]);
			expect(lastFullDiscoveryReason(svc)).toBe('roots-changed');
		});

		it('falls back to periodic when getDiscoveryRootSignature throws', async () => {
			// Periodic-stale bucket. If signature check throws, we shouldn't crash --
			// we should fall through to the periodic decision (which will flag it).
			const bucket = makeBucket({
				extensionId: 'ms.python',
				languageId: 'python',
				runtimePath: '/usr/bin/python3',
				lastFullDiscovery: 0,
			});
			cache.setBucket(bucket);

			const svc = makeService();
			const pyManager = makeManager({
				id: 1,
				owns: [bucket.entries[0].metadata],
				rootSignatureBehavior: 'throws',
			});
			ctx.disposables.add(svc.registerRuntimeManager(pyManager));

			const plans = await managersNeedingFullDiscovery(svc);
			expect(managersFromPlans(plans)).toEqual([pyManager]);
			expect(lastFullDiscoveryReason(svc)).toBe('periodic');
		});

		it('falls back to periodic when getDiscoveryRootSignature exceeds its 500ms timeout', async () => {
			// Stale bucket so periodic fires regardless. The point of this test is
			// that a never-resolving signature call doesn't hang the warm-start
			// decision; the 500ms timeout returns undefined -> periodic logic runs.
			const bucket = makeBucket({
				extensionId: 'ms.python',
				languageId: 'python',
				runtimePath: '/usr/bin/python3',
				lastFullDiscovery: 0,
			});
			cache.setBucket(bucket);

			const svc = makeService();
			const pyManager = makeManager({
				id: 1,
				owns: [bucket.entries[0].metadata],
				rootSignatureBehavior: 'never-resolves',
			});
			ctx.disposables.add(svc.registerRuntimeManager(pyManager));

			vi.useFakeTimers();
			try {
				const promise = managersNeedingFullDiscovery(svc);
				// Drive the 500ms timeout. The full call still awaits the timeout
				// resolution, so we need to advance and then drain the microtask
				// queue between awaits.
				await vi.advanceTimersByTimeAsync(600);
				const plans = await promise;
				expect(managersFromPlans(plans)).toEqual([pyManager]);
				expect(lastFullDiscoveryReason(svc)).toBe('periodic');
			} finally {
				vi.useRealTimers();
			}
		});
	});

	describe('reason precedence (cold-start > roots-changed > periodic)', () => {
		it('roots-changed beats periodic when both fire across managers', async () => {
			// Manager A: stale + signature unchanged -> periodic.
			// Manager B: fresh + signature changed -> roots-changed.
			// The reason field should be the more specific 'roots-changed'.
			const stableSig = sig([['/usr/bin', true, 1000]]);
			const aBucket = makeBucket({
				extensionId: 'ms.python',
				languageId: 'python',
				runtimePath: '/usr/bin/python3',
				lastFullDiscovery: 0, // periodic-stale
				signature: stableSig,
			});
			const bBucket = makeBucket({
				extensionId: 'posit.r',
				languageId: 'r',
				runtimePath: '/usr/local/bin/R',
				lastFullDiscovery: Date.now(), // fresh
				signature: stableSig,
			});
			cache.setBucket(aBucket);
			cache.setBucket(bBucket);

			const svc = makeService();
			ctx.disposables.add(svc.registerRuntimeManager(makeManager({
				id: 1,
				owns: [aBucket.entries[0].metadata],
				rootSignatureByLanguage: { python: stableSig }, // matches -> no roots-changed
			})));
			ctx.disposables.add(svc.registerRuntimeManager(makeManager({
				id: 2,
				owns: [bBucket.entries[0].metadata],
				rootSignatureByLanguage: {
					r: sig([['/usr/local/bin', true, 9999]]), // differs from stableSig
				},
			})));

			const plans = await managersNeedingFullDiscovery(svc);
			expect(plans).toHaveLength(2);
			expect(lastFullDiscoveryReason(svc)).toBe('roots-changed');
		});

		it('cold-start beats roots-changed when both fire across managers', async () => {
			// Manager A: cold-start (contribution has no cached entries).
			// Manager B: fresh + signature changed -> roots-changed.
			// The reason field should be the more specific 'cold-start'.
			const persistedSig = sig([['/usr/bin', true, 1000]]);
			const bBucket = makeBucket({
				extensionId: 'posit.r',
				languageId: 'r',
				runtimePath: '/usr/local/bin/R',
				lastFullDiscovery: Date.now(),
				signature: persistedSig,
			});
			cache.setBucket(bBucket);

			const svc = makeService();
			ctx.disposables.add(svc.registerRuntimeManager(makeManager({
				id: 1,
				owns: [],
				// Has a contribution but no cached entries -> cold-start.
				contributions: [{ extensionId: 'ms.python', languageId: 'python', alwaysRediscover: false }],
			})));
			ctx.disposables.add(svc.registerRuntimeManager(makeManager({
				id: 2,
				owns: [bBucket.entries[0].metadata],
				rootSignatureByLanguage: {
					r: sig([['/usr/local/bin', true, 9999]]), // differs
				},
			})));

			const plans = await managersNeedingFullDiscovery(svc);
			expect(plans).toHaveLength(2);
			expect(lastFullDiscoveryReason(svc)).toBe('cold-start');
		});
	});

	describe('loadFromDiscoveryCache skip set', () => {
		// `loadFromDiscoveryCache` is private; test via string-index access.
		function loadFromDiscoveryCache(
			svc: RuntimeStartupService,
			skipBuckets: ReadonlySet<string>,
		): Promise<unknown> {
			return (svc as unknown as {
				loadFromDiscoveryCache: (skip: ReadonlySet<string>) => Promise<unknown>;
			}).loadFromDiscoveryCache(skipBuckets);
		}

		function registeredPaths(): string[] {
			return ctx.get(ILanguageRuntimeService).registeredRuntimes.map(m => m.runtimePath);
		}

		it('does not pre-register cached entries for buckets in the skip set', async () => {
			// Two buckets: Python and R. The skip set names the Python bucket
			// because (in real flow) `managersNeedingFullDiscovery` decided
			// it needs a fresh enumeration. Pre-registering the cached Python
			// entry would leak an interpreter that current settings now filter
			// out -- the regression this test guards.
			cache.setBucket(makeBucket({
				extensionId: 'ms.python',
				languageId: 'python',
				runtimePath: '/usr/bin/python3',
				lastFullDiscovery: Date.now(),
			}));
			cache.setBucket(makeBucket({
				extensionId: 'positron.r',
				languageId: 'r',
				runtimePath: '/usr/local/bin/R',
				lastFullDiscovery: Date.now(),
			}));

			const svc = makeService();
			await loadFromDiscoveryCache(svc, new Set(['ms.python::python']));

			// R was loaded; Python was not. The skip set is the only thing
			// that should have made that difference.
			expect(registeredPaths()).toEqual(['/usr/local/bin/R']);
		});

		it('loads every bucket when the skip set is empty', async () => {
			// Sanity check that the skip-set wiring doesn't accidentally
			// suppress loads in the no-skip case.
			cache.setBucket(makeBucket({
				extensionId: 'ms.python',
				languageId: 'python',
				runtimePath: '/usr/bin/python3',
				lastFullDiscovery: Date.now(),
			}));
			cache.setBucket(makeBucket({
				extensionId: 'positron.r',
				languageId: 'r',
				runtimePath: '/usr/local/bin/R',
				lastFullDiscovery: Date.now(),
			}));

			const svc = makeService();
			await loadFromDiscoveryCache(svc, new Set());

			expect(registeredPaths().sort()).toEqual(['/usr/bin/python3', '/usr/local/bin/R']);
		});
	});

	describe('background revalidation key migration', () => {
		// `revalidateOne` is private; test via string-index access.
		function revalidateOne(svc: RuntimeStartupService, task: {
			extensionId: string;
			languageId: string;
			metadata: ILanguageRuntimeMetadata;
			freshFingerprint: IRuntimeFingerprint;
		}): Promise<void> {
			return (svc as unknown as {
				revalidateOne: (t: typeof task) => Promise<void>;
			}).revalidateOne(task);
		}

		it('evicts the stale key when a current-version entry is redirected to a new binary', async () => {
			// Models the rig bug: a cached `current: true` R entry for the
			// formerly-default version (4.5.2) is revalidated, and R's
			// validateMetadata re-resolves "current" to wherever the rig
			// `current` symlink now points (4.6.0). The cache is keyed by
			// runtimePath, so without evicting the old key the cache would keep
			// BOTH the stale 4.5.2 entry and the new 4.6.0 entry across sessions.
			const oldMd = metadata({
				extensionId: 'positron.positron-r',
				languageId: 'r',
				runtimePath: '/opt/R/4.5.2/bin/R',
				runtimeId: 'r-452',
			});
			const newMd = metadata({
				extensionId: 'positron.positron-r',
				languageId: 'r',
				runtimePath: '/opt/R/4.6.0/bin/R',
				runtimeId: 'r-460',
			});
			cache.setBucket(makeBucket({
				extensionId: 'positron.positron-r',
				languageId: 'r',
				runtimePath: '/opt/R/4.5.2/bin/R',
				runtimeId: 'r-452',
			}));

			const svc = makeService();
			ctx.disposables.add(svc.registerRuntimeManager(makeManager({
				id: 1,
				owns: [oldMd],
				validate: async () => newMd,
			})));

			await revalidateOne(svc, {
				extensionId: 'positron.positron-r',
				languageId: 'r',
				metadata: oldMd,
				freshFingerprint: { size: 2, mtimeMs: 2, ctimeMs: 2 },
			});

			// Only the redirected entry survives; the stale 4.5.2 key is gone.
			expect(cache.getEntries('positron.positron-r', 'r').map(e => e.metadata.runtimePath))
				.toEqual(['/opt/R/4.6.0/bin/R']);
		});

		it('registers a drifted entry that the validator marks to start right away as Implicit', async () => {
			// Like the cache, a cached record never starts right away in a
			// folder it wasn't recommended for (#16376).
			const oldMd = metadata({ extensionId: 'positron.positron-r', languageId: 'r', runtimePath: '/opt/R/4.6.0/bin/R', runtimeId: 'r-460-old' });
			const newMd = { ...metadata({ extensionId: 'positron.positron-r', languageId: 'r', runtimePath: '/opt/R/4.6.0/bin/R', runtimeId: 'r-460-new' }), startupBehavior: LanguageRuntimeStartupBehavior.Immediate };
			cache.setBucket(makeBucket({ extensionId: 'positron.positron-r', languageId: 'r', runtimePath: '/opt/R/4.6.0/bin/R', runtimeId: 'r-460-old' }));

			const svc = makeService();
			ctx.disposables.add(svc.registerRuntimeManager(makeManager({ id: 1, owns: [oldMd], validate: async () => newMd })));

			await revalidateOne(svc, {
				extensionId: 'positron.positron-r',
				languageId: 'r',
				metadata: oldMd,
				freshFingerprint: { size: 2, mtimeMs: 2, ctimeMs: 2 },
			});

			expect(ctx.get(ILanguageRuntimeService).getRegisteredRuntime('r-460-new')?.startupBehavior).toBe(LanguageRuntimeStartupBehavior.Implicit);
		});

		it('does not evict when the entry is revalidated in place (same path)', async () => {
			// A normal fingerprint refresh (e.g. in-place R upgrade at the same
			// path) must not trip the eviction branch.
			const md = metadata({
				extensionId: 'positron.positron-r',
				languageId: 'r',
				runtimePath: '/opt/R/4.6.0/bin/R',
				runtimeId: 'r-460',
			});
			cache.setBucket(makeBucket({
				extensionId: 'positron.positron-r',
				languageId: 'r',
				runtimePath: '/opt/R/4.6.0/bin/R',
				runtimeId: 'r-460',
			}));

			const svc = makeService();
			ctx.disposables.add(svc.registerRuntimeManager(makeManager({
				id: 1,
				owns: [md],
				validate: async (m) => m,
			})));

			await revalidateOne(svc, {
				extensionId: 'positron.positron-r',
				languageId: 'r',
				metadata: md,
				freshFingerprint: { size: 2, mtimeMs: 2, ctimeMs: 2 },
			});

			expect(cache.getEntries('positron.positron-r', 'r').map(e => e.metadata.runtimePath))
				.toEqual(['/opt/R/4.6.0/bin/R']);
		});
	});

	describe('rediscoverAllRuntimes precondition', () => {
		it('refuses to run while a background discovery pass is already in flight', async () => {
			const svc = makeService();
			// Force the service into Complete + background-in-flight; rediscover
			// should refuse and surface an "already running" notification rather
			// than kicking off a second concurrent pass.
			(svc as unknown as { _startupPhase: RuntimeStartupPhase })._startupPhase = RuntimeStartupPhase.Complete;
			(svc as unknown as { _backgroundDiscoveryInProgress: boolean })._backgroundDiscoveryInProgress = true;

			const notification = ctx.get(INotificationService) as TestNotificationService;
			const infoSpy = vi.spyOn(notification, 'info');

			await svc.rediscoverAllRuntimes();

			expect(infoSpy).toHaveBeenCalledOnce();
			expect(infoSpy.mock.calls[0][0]).toContain('already running');
		});
	});

	describe('languageIds', () => {
		it('includes a language registered only through the runtime API, and fires once', () => {
			const svc = makeService();
			const fired = vi.fn();
			ctx.disposables.add(svc.onDidChangeLanguageIds(fired));
			const runtimeService = ctx.get(ILanguageRuntimeService);
			ctx.disposables.add(runtimeService.registerRuntime(metadata({ runtimeId: 'zig-1', languageId: 'zig' })));
			ctx.disposables.add(runtimeService.registerRuntime(metadata({ runtimeId: 'zig-2', languageId: 'zig' })));
			expect(svc.languageIds).toContain('zig');
			expect(fired).toHaveBeenCalledTimes(1);
		});
	});

	describe('registerDiscoveredRuntime', () => {
		it('caches a runtime that was already registered before discovery', async () => {
			const svc = makeService();
			const md = metadata();
			ctx.disposables.add(ctx.get(ILanguageRuntimeService).registerRuntime(md));
			(svc as unknown as { _startupPhase: RuntimeStartupPhase })._startupPhase = RuntimeStartupPhase.Discovering;

			svc.registerDiscoveredRuntime(md);

			const registered = ctx.get(ILanguageRuntimeService).getRegisteredRuntime(md.runtimeId);
			expect(cache.getEntries('ms.python', 'python').map(e => e.metadata)).toEqual([registered]);
		});
	});

	describe('registerRuntimeFromPath', () => {
		function registerManager(svc: RuntimeStartupService, register: (md: ILanguageRuntimeMetadata) => void) {
			const manager = makeManager({ id: 1, owns: [] });
			const md = metadata();
			const registerRuntimeFromPath = vi.fn(async () => {
				register(md);
				return md;
			});
			ctx.disposables.add(svc.registerRuntimeManager({ ...manager, registerRuntimeFromPath }));
			return { md, registerRuntimeFromPath };
		}

		it('rejects a disabled language without asking the manager', async () => {
			await config.setUserConfiguration('interpreters.startupBehavior', LanguageStartupBehavior.Disabled);
			const svc = makeService();
			const { registerRuntimeFromPath } = registerManager(svc, () => { });

			await expect(svc.registerRuntimeFromPath('python', '/usr/bin/python3')).rejects.toThrow(/disabled/);
			expect(registerRuntimeFromPath).not.toHaveBeenCalled();
		});

		it('rejects a runtime the manager returned but that never registered', async () => {
			const svc = makeService();
			registerManager(svc, () => { });

			await expect(svc.registerRuntimeFromPath('python', '/usr/bin/python3')).rejects.toThrow(/could not be registered/);
		});

		it('returns the registered entry', async () => {
			const svc = makeService();
			const languageRuntimeService = ctx.get(ILanguageRuntimeService);
			const { md } = registerManager(svc, m => ctx.disposables.add(languageRuntimeService.registerRuntime(m)));

			const result = await svc.registerRuntimeFromPath('python', '/usr/bin/python3');

			expect(result).toBe(languageRuntimeService.getRegisteredRuntime(md.runtimeId));
		});
	});

	describe('expired cache entries', () => {
		// Uses the real cache. The fake's `upsert` always sets `firstSeen` to
		// now, so its entries never stay expired.
		it('uses the cache again on the launch after expired entries trigger a full discovery', async () => {
			const md = metadata();
			const contribution = { extensionId: 'ms.python', languageId: 'python', alwaysRediscover: false };

			async function launch(): Promise<string> {
				// Disposed at the end: only one `RuntimeStartupService` can exist at a time.
				const store = new DisposableStore();
				try {
					// A new cache, so it loads what the previous launch saved.
					const realCache = store.add(makeRealCache(ctx.get(IStorageService), config));
					ctx.instantiationService.stub(IRuntimeDiscoveryCache, realCache);
					const svc = store.add(ctx.instantiationService.createInstance(RuntimeStartupService));
					store.add(svc.registerRuntimeManager(makeManager({ id: 1, owns: [md], contributions: [contribution] })));

					const plans = await managersNeedingFullDiscovery(svc);
					if (plans.length === 0) {
						return 'warm-start';
					}
					// Fake a full discovery that finds the same interpreter again.
					realCache.setLastFullDiscovery('ms.python', 'python', Date.now());
					for (const entry of realCache.getEntries('ms.python', 'python')) {
						realCache.invalidate('ms.python', 'python', entry.metadata.runtimePath);
					}
					await realCache.upsert(md);
					return lastFullDiscoveryReason(svc);
				} finally {
					store.dispose();
				}
			}

			const HOUR_MS = 60 * 60 * 1000;
			const DAY_MS = 24 * HOUR_MS;
			vi.useFakeTimers({ toFake: ['Date'] });
			try {
				const day0 = Date.now();
				const reasons: string[] = [];
				reasons.push(await launch());
				vi.setSystemTime(day0 + HOUR_MS);
				reasons.push(await launch());
				// Not opened for 31 days, past the 30-day max age.
				vi.setSystemTime(day0 + 31 * DAY_MS);
				reasons.push(await launch());
				vi.setSystemTime(day0 + 31 * DAY_MS + HOUR_MS);
				reasons.push(await launch());

				expect(reasons).toEqual(['cold-start', 'warm-start', 'cold-start', 'warm-start']);
			} finally {
				vi.useRealTimers();
			}
		});
	});
});

describe('Positron - RuntimeStartupService Architecture Mismatch', () => {

	describe('Local sessions', () => {
		const notificationService = new MockNotificationService();
		const ctx = createLightTestContainer()
			.withRuntimeServices()
			.stub(INotificationService, notificationService)
			.stub(IEphemeralStateService, {
				getItem: () => Promise.resolve(undefined),
				setItem: () => Promise.resolve(),
			})
			.stub(ILifecycleService, {
				onBeforeShutdown: Event.None,
				onWillShutdown: Event.None,
			})
			.stub(IPositronNewFolderService, {
				onDidChangeNewFolderStartupPhase: Event.None,
				startupPhase: NewFolderStartupPhase.Complete,
			})
			.stub(IProgressService, {})
			.stub(IWorkbenchEnvironmentService, { remoteAuthority: undefined })
			.build();

		let runtimeStartupService: RuntimeStartupService;
		beforeEach(() => {
			// Reset captured calls from prior tests in this describe.
			notificationService.promptCalls = [];
			runtimeStartupService = ctx.disposables.add(
				ctx.instantiationService.createInstance(RuntimeStartupService)
			);
		});

		// Architecture mismatch checks are skipped on web since the browser's
		// architecture doesn't relate to where the interpreter is running
		(isWeb ? it.skip : it)('no notification when architectures match', () => {
			// Use the same architecture as the system
			const matchingArch = systemArch === 'arm64'
				? LanguageRuntimeArchitecture.Arm64
				: LanguageRuntimeArchitecture.X64;

			const mockSession = stubInterface<ILanguageRuntimeSession>({
				runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({
					languageId: 'python',
					runtimeName: 'Python 3.12.0',
				}),
			});
			const mockRuntimeInfo = { interpreterArch: matchingArch };

			runtimeStartupService['checkArchitectureMismatch'](mockSession, mockRuntimeInfo);

			expect(notificationService.promptCalls.length, 'Should not show notification when architectures match').toBe(0);
		});

		(isWeb ? it.skip : it)('notification shown with correct message when architectures mismatch', () => {
			// Use a different architecture than the system
			const mismatchedArch = systemArch === 'arm64'
				? LanguageRuntimeArchitecture.X64
				: LanguageRuntimeArchitecture.Arm64;
			const mismatchedArchStr = systemArch === 'arm64' ? 'x64' : 'arm64';

			const mockSession = stubInterface<ILanguageRuntimeSession>({
				runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({
					languageId: 'python',
					runtimeName: 'Python 3.12.0 (x64)',
				}),
			});
			const mockRuntimeInfo = { interpreterArch: mismatchedArch };

			runtimeStartupService['checkArchitectureMismatch'](mockSession, mockRuntimeInfo);

			expect(notificationService.promptCalls.length, 'Should show notification when architectures mismatch').toBe(1);

			const call = notificationService.promptCalls[0];
			expect(call.severity).toBe(Severity.Warning);
			const expectedMessage = `The interpreter "Python 3.12.0 (x64)" has a different architecture (${mismatchedArchStr}) than your system (${systemArch}). This may cause problems with performance and package compatibility.`;
			expect(call.message).toBe(expectedMessage);
		});
	});

	describe('Remote SSH sessions', () => {
		const notificationService = new MockNotificationService();
		const ctx = createLightTestContainer()
			.withRuntimeServices()
			.stub(INotificationService, notificationService)
			.stub(IEphemeralStateService, {
				getItem: () => Promise.resolve(undefined),
				setItem: () => Promise.resolve(),
			})
			.stub(ILifecycleService, {
				onBeforeShutdown: Event.None,
				onWillShutdown: Event.None,
			})
			.stub(IPositronNewFolderService, {
				onDidChangeNewFolderStartupPhase: Event.None,
				startupPhase: NewFolderStartupPhase.Complete,
			})
			.stub(IProgressService, {})
			.stub(IWorkbenchEnvironmentService, { remoteAuthority: 'ssh-remote+myserver' })
			.build();

		let runtimeStartupService: RuntimeStartupService;
		beforeEach(() => {
			// Reset captured calls from prior tests in this describe.
			notificationService.promptCalls = [];
			runtimeStartupService = ctx.disposables.add(
				ctx.instantiationService.createInstance(RuntimeStartupService)
			);
		});

		it('no notification even when architectures mismatch', () => {
			// Use a different architecture than the system (would normally trigger warning)
			const mismatchedArch = systemArch === 'arm64'
				? LanguageRuntimeArchitecture.X64
				: LanguageRuntimeArchitecture.Arm64;

			const mockSession = stubInterface<ILanguageRuntimeSession>({
				runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({
					languageId: 'python',
					runtimeName: 'Python 3.12.0 (x64)',
				}),
			});
			const mockRuntimeInfo = { interpreterArch: mismatchedArch };

			runtimeStartupService['checkArchitectureMismatch'](mockSession, mockRuntimeInfo);

			expect(
				notificationService.promptCalls.length,
				'Should not show notification in remote SSH sessions'
			).toBe(0);
		});
	});
});

describe('RuntimeStartupService - affiliation healing', () => {

	const ctx = createLightTestContainer()
		.withRuntimeServices()
		.stub(IEphemeralStateService, {
			getItem: () => Promise.resolve(undefined),
			setItem: () => Promise.resolve(),
		})
		.stub(ILifecycleService, {
			onBeforeShutdown: new Emitter<BeforeShutdownEvent>().event,
			onWillShutdown: new Emitter<WillShutdownEvent>().event,
		})
		.stub(IPositronNewFolderService, {
			onDidChangeNewFolderStartupPhase: new Emitter<NewFolderStartupPhase>().event,
			startupPhase: NewFolderStartupPhase.Complete,
		})
		.stub(IProgressService, {})
		.stub(IWorkbenchEnvironmentService, { remoteAuthority: undefined })
		.stub(INotificationService, new TestNotificationService())
		.stub(IRuntimeDiscoveryCache, {})
		.build();

	it('heals a stale ~-prefixed runtimePath in stored affiliation when the runtime registers', async () => {
		const runtimeId = 'r-stale-path-test';
		const languageId = 'r';
		const staleRuntimePath = '~/local/lib/R/bin/R';
		const freshRuntimePath = '/home/positron/local/lib/R/bin/R';
		const storageKey = `positron.affiliatedRuntimeMetadata.v3.${languageId}`;
		// TestContextService uses TestWorkspace (one folder, no configuration) →
		// WorkbenchState.FOLDER → affiliationStorageScope() returns WORKSPACE.
		const scope = StorageScope.WORKSPACE;

		// Pre-populate storage with a stale affiliation whose runtimePath was
		// shortened with a ~ prefix before the runtimePath/runtimeDisplayPath split.
		const staleAffiliated = {
			metadata: metadata({ languageId, runtimePath: staleRuntimePath, runtimeId, extensionId: 'ms.r' }),
			lastUsed: 0,
			lastStarted: 0,
		};
		ctx.get(IStorageService).store(storageKey, JSON.stringify(staleAffiliated), scope, StorageTarget.MACHINE);

		const svc = ctx.disposables.add(
			ctx.instantiationService.createInstance(RuntimeStartupService)) as RuntimeStartupService;
		// Force into LoadingCache phase so onDidRegisterRuntime heals the affiliation.
		(svc as unknown as { _startupPhase: RuntimeStartupPhase })._startupPhase = RuntimeStartupPhase.LoadingCache;

		// Use Manual startup behavior so the service heals the stored affiliation
		// without attempting to auto-start a runtime (which has no extension host).
		const freshMd: ILanguageRuntimeMetadata = {
			...metadata({ languageId, runtimePath: freshRuntimePath, runtimeId, extensionId: 'ms.r' }),
			startupBehavior: LanguageRuntimeStartupBehavior.Manual,
		};
		// Registering the runtime fires onDidRegisterRuntime, which heals the stored affiliation.
		await ctx.get(ILanguageRuntimeService).registerRuntime(freshMd);

		// The stored affiliation must now carry the absolute path.
		const stored = JSON.parse(ctx.get(IStorageService).get(storageKey, scope)!);
		expect(stored.metadata.runtimePath).toBe(freshRuntimePath);

		// getAffiliatedRuntimes() returns the live registered metadata (absolute path).
		expect(svc.getAffiliatedRuntimes()[0].runtimePath).toBe(freshRuntimePath);
	});

	it.each([
		{ startupBehavior: LanguageRuntimeStartupBehavior.Explicit, started: false },
		{ startupBehavior: LanguageRuntimeStartupBehavior.Implicit, started: true },
	])('starts a never-used affiliation of the only language unless it starts only when picked ($startupBehavior)', async ({ startupBehavior, started }) => {
		ctx.instantiationService.stub(IConfigurationService,
			new TestConfigurationService({ 'interpreters.startupBehavior': LanguageStartupBehavior.Auto }));
		// A recommendation saved as the workspace default, never started or used.
		ctx.get(IStorageService).store('positron.affiliatedRuntimeMetadata.v3.python',
			JSON.stringify({ metadata: { ...metadata(), startupBehavior }, lastUsed: 0, lastStarted: 0 }),
			StorageScope.WORKSPACE, StorageTarget.MACHINE);

		const svc = ctx.disposables.add(
			ctx.instantiationService.createInstance(RuntimeStartupService)) as RuntimeStartupService;
		const internals = svc as unknown as {
			startAffiliatedLanguageRuntimes(disabled: string[], enabled: string[]): Promise<void>;
			startAffiliatedRuntime(): Promise<void>;
			activateExtensionsForLanguages(): Promise<void>;
		};
		vi.spyOn(internals, 'activateExtensionsForLanguages').mockResolvedValue();
		const startAffiliatedRuntime = vi.spyOn(internals, 'startAffiliatedRuntime').mockResolvedValue();

		await internals.startAffiliatedLanguageRuntimes([], ['python']);

		expect(startAffiliatedRuntime.mock.calls.length > 0).toBe(started);
	});

	it('keeps a stored affiliation that follows the current R when an older R re-registers', async () => {
		// R runtime IDs hash only the binary path and version, so the same
		// runtime ID comes back after `rig default` points at a newer R. The
		// R extension's validateMetadata only swaps in the current R when the
		// stored affiliation says `current: true`.
		const runtimeId = 'r-4.5-current-flag-test';
		const languageId = 'r';
		const runtimePath = '/Library/Frameworks/R.framework/Versions/4.5-arm64/Resources/bin/R';
		const storageKey = `positron.affiliatedRuntimeMetadata.v3.${languageId}`;
		const scope = StorageScope.WORKSPACE;

		// Affiliated while R 4.5 was the current R.
		const affiliated = {
			metadata: {
				...metadata({ languageId, runtimePath, runtimeId, extensionId: 'ms.r' }),
				extraRuntimeData: { binpath: runtimePath, current: true },
			},
			lastUsed: 0,
			lastStarted: 0,
		};
		ctx.get(IStorageService).store(storageKey, JSON.stringify(affiliated), scope, StorageTarget.MACHINE);

		const svc = ctx.disposables.add(
			ctx.instantiationService.createInstance(RuntimeStartupService)) as RuntimeStartupService;
		(svc as unknown as { _startupPhase: RuntimeStartupPhase })._startupPhase = RuntimeStartupPhase.LoadingCache;

		// Re-discovered after a newer R became current.
		await ctx.get(ILanguageRuntimeService).registerRuntime({
			...metadata({ languageId, runtimePath, runtimeId, extensionId: 'ms.r' }),
			startupBehavior: LanguageRuntimeStartupBehavior.Manual,
			extraRuntimeData: { binpath: runtimePath, current: false },
		});

		const stored = JSON.parse(ctx.get(IStorageService).get(storageKey, scope)!);
		expect(stored.metadata.extraRuntimeData.current).toBe(true);
	});
});

describe('RuntimeStartupService - restored sessions', () => {

	const ctx = createLightTestContainer()
		.withRuntimeServices()
		.stub(IEphemeralStateService, {
			getItem: () => Promise.resolve(undefined),
			setItem: () => Promise.resolve(),
		})
		.stub(ILifecycleService, {
			onBeforeShutdown: new Emitter<BeforeShutdownEvent>().event,
			onWillShutdown: new Emitter<WillShutdownEvent>().event,
		})
		.stub(IPositronNewFolderService, {
			onDidChangeNewFolderStartupPhase: new Emitter<NewFolderStartupPhase>().event,
			startupPhase: NewFolderStartupPhase.Complete,
		})
		.stub(IProgressService, {})
		.stub(IWorkbenchEnvironmentService, { remoteAuthority: undefined })
		.stub(INotificationService, new TestNotificationService())
		.stub(IRuntimeDiscoveryCache, {})
		.build();

	/** A session as persisted to workspace storage, optionally with an owner. */
	function storedSession(sessionId: string, lastUsed: number, owner?: string) {
		return {
			sessionName: sessionId,
			metadata: {
				sessionId,
				sessionMode: 'console',
				createdTimestamp: 0,
				startReason: 'test',
				...(owner ? { owner } : {}),
			},
			sessionState: 'idle',
			lastUsed,
			runtimeMetadata: metadata(),
			workingDirectory: '/',
			hasConsole: true,
			localWindowId: 'window-1',
		};
	}

	it('treats sessions stored before owners existed as the user\'s', async () => {
		// The persistent workspace session list, as an older build wrote it:
		// no owner on the first session.
		ctx.get(IStorageService).store(
			'positron.workspaceSessionList.v3',
			JSON.stringify([
				storedSession('pre-owner-session', 2),
				storedSession('agent-session', 1, 'agent'),
			]),
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE,
		);

		const svc = ctx.disposables.add(
			ctx.instantiationService.createInstance(RuntimeStartupService)) as RuntimeStartupService;
		const sessions = await svc.getRestoredSessions();

		expect(sessions.map(session => [session.metadata.sessionId, session.metadata.owner])).toEqual([
			['pre-owner-session', 'user'],
			['agent-session', 'agent'],
		]);
	});
});

describe('RuntimeStartupService - reconnect after a reload', () => {
	const ephemeralState = new Map<string, unknown>();

	const ctx = createTestContainer()
		.withRuntimeServices()
		.stub(IEphemeralStateService, {
			getItem: async <T>(key: string) => ephemeralState.get(key) as T | undefined,
			setItem: async (key: string, value: unknown) => { ephemeralState.set(key, value); },
		})
		.stub(ILifecycleService, {
			onBeforeShutdown: Event.None,
			onWillShutdown: Event.None,
		})
		.stub(IPositronNewFolderService, {
			onDidChangeNewFolderStartupPhase: Event.None,
			startupPhase: NewFolderStartupPhase.Complete,
			initTasksComplete: stubInterface<Barrier>({ isOpen: () => true }),
		})
		.stub(IProgressService, {})
		.stub(IWorkbenchEnvironmentService, { remoteAuthority: undefined })
		.stub(INotificationService, new TestNotificationService())
		.stub(IRuntimeDiscoveryCache, createTestCache())
		.build();

	beforeEach(() => ephemeralState.clear());

	/** Starts a console that reconnects on reload, last used to run code at `lastUsed`. */
	async function startConsole(lastUsed: number) {
		const runtime = createTestLanguageRuntimeMetadata(
			ctx.instantiationService, ctx.disposables, LanguageRuntimeSessionLocation.Workspace);
		const session = await startTestLanguageRuntimeSession(
			ctx.instantiationService, ctx.disposables, { runtime });
		vi.spyOn(session, 'lastUsed', 'get').mockReturnValue(lastUsed);
		// A new console comes to the front again when it is ready.
		await vi.waitFor(() => expect(session.getRuntimeState()).toBe(RuntimeState.Ready));
		return session;
	}

	/**
	 * Opens the folder in a new service, the way the service starts when the
	 * extension that provides the test runtimes loads.
	 */
	function openFolder() {
		ctx.disposables.add(ctx.instantiationService.createInstance(RuntimeStartupService));
		const extensionPoint = ExtensionsRegistry.getExtensionPoints().find(point => point.name === 'languageRuntimes')!;
		extensionPoint.acceptUsers([{
			description: stubInterface<IExtensionDescription>({ identifier: new ExtensionIdentifier('test-extension') }),
			value: [{ languageId: 'test' }],
			collector: stubInterface<ExtensionMessageCollector>(),
		}]);
		// The extension point outlives the service; leave it empty for the next test.
		ctx.disposables.add(toDisposable(() => extensionPoint.acceptUsers([])));
	}

	/**
	 * Saves two consoles that a reload left running, the first one focused
	 * last, the second one with code run more recently. Returns their session
	 * IDs.
	 */
	function saveRunningConsoles(): [focusedLast: string, other: string] {
		const sessions: SerializedSessionMetadata[] = [true, false].map((isLastActiveConsole, i) => ({
			sessionName: `console ${i}`,
			metadata: {
				sessionId: `session-${i}`,
				sessionMode: LanguageRuntimeSessionMode.Console,
				notebookUri: undefined,
				createdTimestamp: 0,
				startReason: 'test',
				owner: 'user',
			},
			sessionState: RuntimeState.Idle,
			lastUsed: i,
			isLastActiveConsole,
			runtimeMetadata: createTestLanguageRuntimeMetadata(
				ctx.instantiationService, ctx.disposables, LanguageRuntimeSessionLocation.Machine),
			workingDirectory: '/',
			hasConsole: true,
			localWindowId: 'window-1',
		}));
		ctx.get(IStorageService).store('positron.workspaceSessionList.v3', JSON.stringify(sessions),
			StorageScope.WORKSPACE, StorageTarget.MACHINE);
		return ['session-0', 'session-1'];
	}

	/** A test session whose start waits until `started` resolves. */
	class SlowTestLanguageRuntimeSession extends TestLanguageRuntimeSession {
		constructor(metadata: IRuntimeSessionMetadata, runtimeMetadata: ILanguageRuntimeMetadata, private readonly _started: Promise<void>) {
			super(metadata, runtimeMetadata);
		}

		override async start() {
			await this._started;
			return super.start();
		}
	}

	/** Records the ID of each session that comes to the front. */
	function recordFrontSessions(): (string | undefined)[] {
		const fronts: (string | undefined)[] = [];
		ctx.disposables.add(ctx.get(IRuntimeSessionService).onDidChangeForegroundSession(session => fronts.push(session?.sessionId)));
		return fronts;
	}

	it('while consoles reconnect after a reload, brings only the console focused last to the front', async () => {
		const [focusedLast, other] = saveRunningConsoles();
		// The console focused last finishes reconnecting after the other one.
		const focusedLastStarted = new DeferredPromise<void>();
		vi.spyOn(TestRuntimeSessionManager.instance, 'restoreSession').mockImplementation(async (runtimeMetadata, sessionMetadata) =>
			ctx.disposables.add(sessionMetadata.sessionId === focusedLast ?
				new SlowTestLanguageRuntimeSession(sessionMetadata, runtimeMetadata, focusedLastStarted.p) :
				new TestLanguageRuntimeSession(sessionMetadata, runtimeMetadata)));
		const fronts = recordFrontSessions();
		const runtimeSessionService = ctx.get(IRuntimeSessionService);

		openFolder();
		await vi.waitFor(() => expect(runtimeSessionService.getSession(other)?.getRuntimeState()).toBe(RuntimeState.Ready));
		focusedLastStarted.complete();
		await vi.waitFor(() => expect(runtimeSessionService.foregroundSession?.sessionId).toBe(focusedLast));

		expect(fronts).toEqual([focusedLast]);
	});

	it('brings another reconnected console to the front when the console focused last fails to reconnect', async () => {
		const [focusedLast, other] = saveRunningConsoles();
		vi.spyOn(TestRuntimeSessionManager.instance, 'restoreSession').mockImplementation(async (runtimeMetadata, sessionMetadata) => {
			if (sessionMetadata.sessionId === focusedLast) {
				throw new Error('The kernel is gone');
			}
			return ctx.disposables.add(new TestLanguageRuntimeSession(sessionMetadata, runtimeMetadata));
		});
		const fronts = recordFrontSessions();

		openFolder();
		await vi.waitFor(() => expect(fronts).toEqual([other]));
	});

	it('saves which console was focused last whenever focus moves to another console', async () => {
		// The web build can't wait for a save before a reload.
		ctx.disposables.add(ctx.instantiationService.createInstance(RuntimeStartupService));
		const focusedLast = await startConsole(1);
		await startConsole(2);
		ctx.get(IRuntimeSessionService).foregroundSession = focusedLast;

		await vi.waitFor(() => {
			const saved = [...ephemeralState.values()][0] as SerializedSessionMetadata[];
			expect(saved.filter(session => session.isLastActiveConsole).map(session => session.metadata.sessionId))
				.toEqual([focusedLast.sessionId]);
		});
	});
});

describe('RuntimeStartupService - getPreferredRuntime', () => {

	const ctx = createLightTestContainer()
		.withRuntimeServices()
		.stub(IEphemeralStateService, {
			getItem: () => Promise.resolve(undefined),
			setItem: () => Promise.resolve(),
		})
		.stub(ILifecycleService, {
			onBeforeShutdown: new Emitter<BeforeShutdownEvent>().event,
			onWillShutdown: new Emitter<WillShutdownEvent>().event,
		})
		.stub(IPositronNewFolderService, {
			onDidChangeNewFolderStartupPhase: new Emitter<NewFolderStartupPhase>().event,
			startupPhase: NewFolderStartupPhase.Complete,
		})
		.stub(IProgressService, {})
		.stub(IWorkbenchEnvironmentService, { remoteAuthority: undefined })
		.stub(INotificationService, new TestNotificationService())
		.stub(IRuntimeDiscoveryCache, {})
		.build();

	it('skips a preferred runtime that is no longer registered', async () => {
		const svc = ctx.disposables.add(
			ctx.instantiationService.createInstance(RuntimeStartupService)) as RuntimeStartupService;
		const languageRuntimeService = ctx.get(ILanguageRuntimeService);

		// Start a console session, which makes its runtime both the active
		// console session for the language and the most recently started
		// runtime for it.
		const staleRuntime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
		await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables, { runtime: staleRuntime });

		// Register a second runtime for the same language, then unregister the
		// one the session was started from - the shape left behind when a
		// window reload rediscovers runtimes and the old ids go away while a
		// restored session still references them.
		const liveRuntime = metadata({ languageId: staleRuntime.languageId, runtimeId: 'rt-live' });
		ctx.disposables.add(languageRuntimeService.registerRuntime(liveRuntime));
		languageRuntimeService.unregisterRuntime(staleRuntime.runtimeId);

		// Handing back the unregistered runtime makes every caller that starts
		// a session from it fail with "No language runtime with id X was found".
		expect(svc.getPreferredRuntime(staleRuntime.languageId)?.runtimeId).toBe(liveRuntime.runtimeId);
	});

	it('prefers the active console session runtime while it is still registered', async () => {
		const svc = ctx.disposables.add(
			ctx.instantiationService.createInstance(RuntimeStartupService)) as RuntimeStartupService;

		const sessionRuntime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
		await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables, { runtime: sessionRuntime });
		ctx.disposables.add(ctx.get(ILanguageRuntimeService).registerRuntime(
			metadata({ languageId: sessionRuntime.languageId, runtimeId: 'rt-other' })));

		expect(svc.getPreferredRuntime(sessionRuntime.languageId)?.runtimeId).toBe(sessionRuntime.runtimeId);
	});

	it('goes on to the recommendations when the affiliated runtime fails to start', async () => {
		ctx.instantiationService.stub(IPositronNewFolderService, {
			onDidChangeNewFolderStartupPhase: Event.None,
			startupPhase: NewFolderStartupPhase.Complete,
			initTasksComplete: { isOpen: () => true },
		} as unknown as IPositronNewFolderService);
		const svc = ctx.disposables.add(
			ctx.instantiationService.createInstance(RuntimeStartupService)) as RuntimeStartupService;
		const internals = svc as unknown as {
			startupSequence(): Promise<void>;
			restoreSessions(): Promise<void>;
			hasAffiliatedRuntime(): boolean;
			startAffiliatedLanguageRuntimes(): Promise<void>;
			startRecommendedLanguageRuntimes(): Promise<void>;
			discoverAllRuntimes(): Promise<void>;
		};
		vi.spyOn(internals, 'restoreSessions').mockResolvedValue();
		vi.spyOn(internals, 'hasAffiliatedRuntime').mockReturnValue(true);
		// e.g. the extension refuses an interpreter the settings now filter out.
		vi.spyOn(internals, 'startAffiliatedLanguageRuntimes').mockRejectedValue(new Error('filtered out'));
		const startRecommended = vi.spyOn(internals, 'startRecommendedLanguageRuntimes').mockResolvedValue();
		vi.spyOn(internals, 'discoverAllRuntimes').mockResolvedValue();

		await internals.startupSequence();

		expect(startRecommended).toHaveBeenCalledTimes(1);
	});

	it('asks again after discovery and prefers that answer over the first registered runtime', async () => {
		const svc = ctx.disposables.add(
			ctx.instantiationService.createInstance(RuntimeStartupService)) as RuntimeStartupService;

		// Discovery registered an unsupported release candidate first.
		ctx.disposables.add(ctx.get(ILanguageRuntimeService).registerRuntime(
			metadata({ runtimeId: 'rt-rc', runtimePath: '/uv/cpython-3.15.0rc2/bin/python' })));

		// The extension has no answer at startup, and recommends a conda env once
		// discovery has completed.
		const recommended = metadata({ runtimeId: 'rt-conda', runtimePath: '/conda/envs/threefourteen/bin/python' });
		const asks: [string[], boolean | undefined][] = [];
		const manager = makeManager({ id: 1, owns: [] });
		manager.recommendWorkspaceRuntimes = async (disabledLanguageIds, afterDiscovery) => {
			asks.push([disabledLanguageIds, afterDiscovery]);
			return afterDiscovery ? [{ metadata: recommended, isProjectDefault: false }] : [];
		};
		ctx.disposables.add(svc.registerRuntimeManager(manager));

		await (svc as unknown as { recommendAfterDiscovery: () => Promise<void> }).recommendAfterDiscovery();

		expect({
			asks,
			preferred: svc.getPreferredRuntime('python')?.runtimeId,
		}).toEqual({
			asks: [[[], true]],
			preferred: 'rt-conda',
		});
	});

	it('saves a recommendation that does not start as the project default only if its manager allows it', async () => {
		const svc = ctx.disposables.add(
			ctx.instantiationService.createInstance(RuntimeStartupService)) as RuntimeStartupService;

		// One manager opts out; the other keeps the default.
		const manager = makeManager({ id: 1, owns: [] });
		manager.recommendWorkspaceRuntimes = async () => [
			{ metadata: metadata({ languageId: 'python', runtimeId: 'rt-python' }), isProjectDefault: false },
			{ metadata: metadata({ languageId: 'r', runtimeId: 'rt-r' }), isProjectDefault: true },
		];
		ctx.disposables.add(svc.registerRuntimeManager(manager));

		await (svc as unknown as {
			startRecommendedLanguageRuntimes(disabledLanguageIds: string[], enabledLanguageIds: string[]): Promise<void>;
		}).startRecommendedLanguageRuntimes([], []);

		expect({
			pythonAffiliation: svc.getAffiliatedRuntimeMetadata('python')?.runtimeId,
			rAffiliation: svc.getAffiliatedRuntimeMetadata('r')?.runtimeId,
			pythonPreferred: svc.getPreferredRuntime('python')?.runtimeId,
		}).toEqual({
			pythonAffiliation: undefined,
			rAffiliation: 'rt-r',
			pythonPreferred: 'rt-python',
		});
	});
});

describe('RuntimeStartupService - hasLanguageRuntimeProvider', () => {

	const ctx = createLightTestContainer()
		.withRuntimeServices()
		.stub(IEphemeralStateService, {
			getItem: () => Promise.resolve(undefined),
			setItem: () => Promise.resolve(),
		})
		.stub(ILifecycleService, {
			onBeforeShutdown: new Emitter<BeforeShutdownEvent>().event,
			onWillShutdown: new Emitter<WillShutdownEvent>().event,
		})
		.stub(IPositronNewFolderService, {
			onDidChangeNewFolderStartupPhase: new Emitter<NewFolderStartupPhase>().event,
			startupPhase: NewFolderStartupPhase.Complete,
		})
		.stub(IProgressService, {})
		.stub(IWorkbenchEnvironmentService, { remoteAuthority: undefined })
		.stub(INotificationService, new TestNotificationService())
		.stub(IRuntimeDiscoveryCache, {})
		.build();

	it('counts a runtime registered without a `languageRuntimes` contribution', () => {
		// Extensions can register a runtime manager through the API alone, so a
		// registered runtime proves the language is provided even when nothing
		// declared it in extension metadata.
		const svc = ctx.disposables.add(
			ctx.instantiationService.createInstance(RuntimeStartupService)) as RuntimeStartupService;
		ctx.disposables.add(ctx.get(ILanguageRuntimeService).registerRuntime(
			metadata({ languageId: 'testquarto', runtimeId: 'rt-testquarto' })));

		expect(svc.hasLanguageRuntimeProvider('testquarto')).toBe(true);
		expect(svc.hasLanguageRuntimeProvider('mermaid')).toBe(false);
	});
});

describe('RuntimeStartupService - discovery completion', () => {

	const notificationService = new TestNotificationService();

	const ctx = createLightTestContainer()
		.withRuntimeServices()
		.stub(IEphemeralStateService, {
			getItem: () => Promise.resolve(undefined),
			setItem: () => Promise.resolve(),
		})
		.stub(ILifecycleService, {
			onBeforeShutdown: new Emitter<BeforeShutdownEvent>().event,
			onWillShutdown: new Emitter<WillShutdownEvent>().event,
		})
		.stub(IPositronNewFolderService, {
			onDidChangeNewFolderStartupPhase: new Emitter<NewFolderStartupPhase>().event,
			startupPhase: NewFolderStartupPhase.Complete,
		})
		.stub(IProgressService, {})
		.stub(IWorkbenchEnvironmentService, { remoteAuthority: undefined })
		.stub(INotificationService, notificationService)
		.stub(IConfigurationService, new TestConfigurationService({
			// Anything other than 'disabled' - a language the user has not opted
			// out of is what made the old code treat an empty discovery as an error.
			'interpreters.startupBehavior': LanguageStartupBehavior.Auto,
		}))
		.stub(IRuntimeDiscoveryCache, {})
		.build();

	it('stays quiet when discovery completes with no runtimes registered', () => {
		// Finding no interpreters used to raise an error notification pointing at
		// the general Get Started docs. The welcome page health checks cover that
		// case now, so completing discovery empty-handed must say nothing.
		const errorNotification = vi.spyOn(notificationService, 'error');

		const svc = ctx.disposables.add(
			ctx.instantiationService.createInstance(RuntimeStartupService)) as RuntimeStartupService;

		// Language packs come from an extension point that no unit test can drive,
		// but an empty map is the one shape that suppressed the old notification on
		// its own. Seed one enabled language so this asserts the removal itself.
		(svc as unknown as { _languagePacks: Map<string, ExtensionIdentifier[]> })
			._languagePacks.set('python', [new ExtensionIdentifier('ms-python.python')]);

		ctx.get(ILanguageRuntimeService).setStartupPhase(RuntimeStartupPhase.Complete);

		expect(ctx.get(ILanguageRuntimeService).registeredRuntimes).toHaveLength(0);
		expect(errorNotification).not.toHaveBeenCalled();
	});
});

describe('RuntimeStartupService - start reasons', () => {
	const setItem = vi.fn<IEphemeralStateService['setItem']>(async () => { });

	const ctx = createLightTestContainer()
		.withRuntimeServices()
		.stub(IEphemeralStateService, {
			getItem: () => Promise.resolve(undefined),
			setItem,
		})
		.stub(ILifecycleService, {
			onBeforeShutdown: Event.None,
			onWillShutdown: Event.None,
		})
		.stub(IPositronNewFolderService, {
			onDidChangeNewFolderStartupPhase: Event.None,
			startupPhase: NewFolderStartupPhase.Complete,
		})
		.stub(IProgressService, {})
		.stub(IWorkbenchEnvironmentService, { remoteAuthority: undefined })
		.stub(IRuntimeDiscoveryCache, {})
		.build();

	/**
	 * Creates the service with the given startup behavior, and returns the
	 * IDs of the start reasons it auto-starts runtimes with.
	 */
	function createService(startupBehavior: LanguageStartupBehavior, options?: { overrideIdentifiers?: string[]; settings?: Record<string, unknown> }) {
		const configurationService = new TestConfigurationService({ 'interpreters.startupBehavior': startupBehavior, ...options?.settings });
		if (options?.overrideIdentifiers) {
			configurationService.setOverrideIdentifiers('interpreters.startupBehavior', options.overrideIdentifiers);
		}
		ctx.instantiationService.stub(IConfigurationService, configurationService);
		const autoStartRuntime = vi.spyOn(ctx.get(IRuntimeSessionService), 'autoStartRuntime').mockResolvedValue('');
		svc = ctx.disposables.add(ctx.instantiationService.createInstance(RuntimeStartupService)) as RuntimeStartupService;
		// Python's language pack comes first, as it does in the product.
		const languagePacks = (svc as unknown as { _languagePacks: Map<string, ExtensionIdentifier[]> })._languagePacks;
		languagePacks.set('python', [new ExtensionIdentifier('ms-python.python')]);
		languagePacks.set('r', [new ExtensionIdentifier('ms.r')]);
		startedRuntimeIds = () => autoStartRuntime.mock.calls.map(([runtime]) => runtime.runtimeId);
		return () => autoStartRuntime.mock.calls.map(([, startReason]) => startReason.id);
	}
	let svc: RuntimeStartupService;
	let startedRuntimeIds: () => string[];

	/** Has the service's manager recommend the given runtime after discovery. */
	function recommendAfterDiscovery(recommended: ILanguageRuntimeMetadata) {
		const manager = makeManager({ id: 1, owns: [] });
		manager.recommendWorkspaceRuntimes = async (_disabledLanguageIds, afterDiscovery) =>
			afterDiscovery ? [{ metadata: recommended, isProjectDefault: false }] : [];
		ctx.disposables.add(svc.registerRuntimeManager(manager));
	}

	/** Saves an affiliation for the runtime, as if it was used in this folder. */
	function affiliate(runtime: ILanguageRuntimeMetadata) {
		ctx.get(IStorageService).store(`positron.affiliatedRuntimeMetadata.v3.${runtime.languageId}`,
			JSON.stringify({ metadata: runtime, lastUsed: 1, lastStarted: 1 }),
			StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	function registerRuntime(startupBehavior: LanguageRuntimeStartupBehavior) {
		ctx.disposables.add(ctx.get(ILanguageRuntimeService).registerRuntime({ ...metadata(), startupBehavior }));
	}

	function completeDiscovery() {
		ctx.get(ILanguageRuntimeService).setStartupPhase(RuntimeStartupPhase.Complete);
	}

	it('starts a runtime marked to start immediately when discovery finishes', () => {
		const startReasonIds = createService(LanguageStartupBehavior.Auto);
		registerRuntime(LanguageRuntimeStartupBehavior.Immediate);
		completeDiscovery();

		expect(startReasonIds()).toEqual([SessionStartReasonId.ExtensionRequestedImmediateStart]);
	});

	it.each([
		{ overrideIdentifiers: ['python'], id: SessionStartReasonId.StartupBehaviorAlways },
		{ overrideIdentifiers: undefined, id: SessionStartReasonId.StartupBehaviorAlwaysAllLanguages },
		// A value set for another language doesn't apply to Python.
		{ overrideIdentifiers: ['r'], id: SessionStartReasonId.StartupBehaviorAlwaysAllLanguages },
	])('starts the recommendation, not the first registered runtime, when set to always start (language-specific values: $overrideIdentifiers)', async ({ overrideIdentifiers, id }) => {
		const startReasonIds = createService(LanguageStartupBehavior.Always, { overrideIdentifiers });
		registerRuntime(LanguageRuntimeStartupBehavior.Implicit);
		// The recommendation registers Explicit, like every discovered Python.
		const recommended = { ...metadata({ runtimeId: 'rt-rec', runtimePath: '/venv/bin/python' }), startupBehavior: LanguageRuntimeStartupBehavior.Explicit };
		ctx.disposables.add(ctx.get(ILanguageRuntimeService).registerRuntime(recommended));
		recommendAfterDiscovery(recommended);
		completeDiscovery();

		await vi.waitFor(() => expect(startReasonIds()).toEqual([id]));
		expect(startedRuntimeIds()).toEqual(['rt-rec']);
	});

	it('starts the recommendation when set to always start even if another language has an affiliation', async () => {
		createService(LanguageStartupBehavior.Always, { overrideIdentifiers: ['python'] });
		affiliate(metadata({ languageId: 'r', runtimeId: 'rt-r', runtimePath: '/usr/bin/R', extensionId: 'ms.r' }));
		recommendAfterDiscovery(metadata({ runtimeId: 'rt-rec', runtimePath: '/venv/bin/python' }));
		completeDiscovery();

		await vi.waitFor(() => expect(startedRuntimeIds()).toEqual(['rt-rec']));
	});

	/** Sets interpreters.definitions, and definitionsOnly discovery unless told otherwise. */
	async function defineInterpreters(definition: { language: string; path: string; label: string }, definitionsOnly = true) {
		const settings: Record<string, unknown> = { 'interpreters.definitions': [definition] };
		if (definitionsOnly) {
			settings['interpreters.discovery'] = 'definitionsOnly';
		}
		// The language runtime service reads these too, to register variants.
		for (const [key, value] of Object.entries(settings)) {
			await (ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration(key, value);
		}
		return settings;
	}

	it('starts the defined variant of the recommendation without saving an affiliation when discovery is limited to definitions', async () => {
		const definition = { language: 'python', path: '/venv/bin/python', label: 'Python (GPU)' };
		createService(LanguageStartupBehavior.Auto, { settings: await defineInterpreters(definition) });
		const recommended = { ...metadata({ runtimeId: 'rt-rec', runtimePath: '/venv/bin/python' }), startupBehavior: LanguageRuntimeStartupBehavior.Immediate };
		const manager = makeManager({ id: 1, owns: [] });
		manager.recommendWorkspaceRuntimes = async () => [{ metadata: recommended, isProjectDefault: false }];
		ctx.disposables.add(svc.registerRuntimeManager(manager));

		await (svc as unknown as {
			startRecommendedLanguageRuntimes(disabledLanguageIds: string[], enabledLanguageIds: string[]): Promise<void>;
		}).startRecommendedLanguageRuntimes([], []);

		const variantId = createInterpreterVariant(recommended, definition).runtimeId;
		expect({
			started: startedRuntimeIds(),
			preferred: svc.getPreferredRuntime('python')?.runtimeId,
			affiliation: svc.getAffiliatedRuntimeMetadata('python')?.runtimeId,
		}).toEqual({
			started: [variantId],
			preferred: variantId,
			affiliation: undefined,
		});
	});

	it('starts the plain recommendation when a definition matches it but discovery is not limited to definitions', async () => {
		const definition = { language: 'python', path: '/venv/bin/python', label: 'Python (GPU)' };
		createService(LanguageStartupBehavior.Auto, { settings: await defineInterpreters(definition, false) });
		const recommended = { ...metadata({ runtimeId: 'rt-rec', runtimePath: '/venv/bin/python' }), startupBehavior: LanguageRuntimeStartupBehavior.Immediate };
		const manager = makeManager({ id: 1, owns: [] });
		manager.recommendWorkspaceRuntimes = async () => [{ metadata: recommended, isProjectDefault: false }];
		ctx.disposables.add(svc.registerRuntimeManager(manager));

		await (svc as unknown as {
			startRecommendedLanguageRuntimes(disabledLanguageIds: string[], enabledLanguageIds: string[]): Promise<void>;
		}).startRecommendedLanguageRuntimes([], []);

		expect({
			started: startedRuntimeIds(),
			preferred: svc.getPreferredRuntime('python')?.runtimeId,
		}).toEqual({
			started: ['rt-rec'],
			preferred: 'rt-rec',
		});
	});

	it('saves the base recommendation, not its defined variant, as the project default', async () => {
		const definition = { language: 'python', path: '/venv/bin/python', label: 'Python (GPU)' };
		createService(LanguageStartupBehavior.Auto, { settings: await defineInterpreters(definition) });
		const recommended = { ...metadata({ runtimeId: 'rt-rec', runtimePath: '/venv/bin/python' }), startupBehavior: LanguageRuntimeStartupBehavior.Explicit };
		const manager = makeManager({ id: 1, owns: [] });
		manager.recommendWorkspaceRuntimes = async () => [{ metadata: recommended, isProjectDefault: true }];
		ctx.disposables.add(svc.registerRuntimeManager(manager));

		await (svc as unknown as {
			startRecommendedLanguageRuntimes(disabledLanguageIds: string[], enabledLanguageIds: string[]): Promise<void>;
		}).startRecommendedLanguageRuntimes([], []);

		expect(svc.getAffiliatedRuntimeMetadata('python')?.runtimeId).toBe('rt-rec');
	});

	it.each([
		{ name: 'no recommendation', recommendation: false },
		{ name: 'a recommendation that is the project default', recommendation: true },
	])('starts the preferred runtime when set to always start and there is $name', async ({ recommendation }) => {
		createService(LanguageStartupBehavior.Always);
		const registered = { ...metadata({ runtimeId: 'rt-first', runtimePath: '/usr/bin/python' }), startupBehavior: LanguageRuntimeStartupBehavior.Explicit };
		ctx.disposables.add(ctx.get(ILanguageRuntimeService).registerRuntime(registered));
		const manager = makeManager({ id: 1, owns: [] });
		manager.recommendWorkspaceRuntimes = async () => [];
		ctx.disposables.add(svc.registerRuntimeManager(manager));
		if (recommendation) {
			// The recommendation made at startup is the preferred runtime.
			(svc as unknown as { _recommendedRuntimesByLanguageId: Map<string, ILanguageRuntimeMetadata> })
				._recommendedRuntimesByLanguageId.set('python', registered);
		}
		completeDiscovery();

		await vi.waitFor(() => expect(startedRuntimeIds()).toEqual(['rt-first']));
	});

	it('starts the recommendation when set to always start and the affiliation was never started', async () => {
		createService(LanguageStartupBehavior.Always);
		const affiliated = metadata({ runtimeId: 'rt-aff', runtimePath: '/old/bin/python' });
		ctx.get(IStorageService).store(`positron.affiliatedRuntimeMetadata.v3.python`,
			JSON.stringify({ metadata: affiliated, lastUsed: 0, lastStarted: 0 }),
			StorageScope.WORKSPACE, StorageTarget.MACHINE);
		recommendAfterDiscovery(metadata({ runtimeId: 'rt-rec', runtimePath: '/venv/bin/python' }));
		completeDiscovery();

		await vi.waitFor(() => expect(startedRuntimeIds()).toEqual(['rt-rec']));
	});

	it('starts the recommendation for always at most once per window', async () => {
		createService(LanguageStartupBehavior.Always);
		recommendAfterDiscovery(metadata({ runtimeId: 'rt-rec', runtimePath: '/venv/bin/python' }));
		completeDiscovery();
		await vi.waitFor(() => expect(startedRuntimeIds()).toEqual(['rt-rec']));

		// A rediscovery reaching Complete again must not restart a closed console.
		await (svc as unknown as { recommendAfterDiscovery: () => Promise<void> }).recommendAfterDiscovery();

		expect(startedRuntimeIds()).toEqual(['rt-rec']);
	});

	it('starts only one language when every language is set to always start', async () => {
		createService(LanguageStartupBehavior.Always);
		const python = metadata({ runtimeId: 'rt-py', runtimePath: '/venv/bin/python' });
		const r = metadata({ languageId: 'r', runtimeId: 'rt-r', runtimePath: '/usr/bin/R', extensionId: 'ms.r' });
		const manager = makeManager({ id: 1, owns: [] });
		manager.recommendWorkspaceRuntimes = async (_disabledLanguageIds, afterDiscovery) =>
			afterDiscovery ? [python, r].map(runtime => ({ metadata: runtime, isProjectDefault: false })) : [];
		ctx.disposables.add(svc.registerRuntimeManager(manager));

		await (svc as unknown as { recommendAfterDiscovery: () => Promise<void> }).recommendAfterDiscovery();

		expect(startedRuntimeIds()).toEqual(['rt-py']);
	});

	describe('a language set to always start by a language-specific value', () => {
		const python = metadata({ runtimeId: 'rt-py', runtimePath: '/venv/bin/python' });
		const r = metadata({ languageId: 'r', runtimeId: 'rt-r', runtimePath: '/usr/bin/R', extensionId: 'ms.r' });

		/** Recommends both languages after discovery, then runs the ask after discovery. */
		async function recommendBothAfterDiscovery() {
			const manager = makeManager({ id: 1, owns: [] });
			manager.recommendWorkspaceRuntimes = async (_disabledLanguageIds, afterDiscovery) =>
				afterDiscovery ? [python, r].map(runtime => ({ metadata: runtime, isProjectDefault: false })) : [];
			ctx.disposables.add(svc.registerRuntimeManager(manager));
			await (svc as unknown as { recommendAfterDiscovery: () => Promise<void> }).recommendAfterDiscovery();
		}

		/** Each auto-start as [runtime ID, start reason, whether it was brought to the front]. */
		function starts() {
			return vi.mocked(ctx.get(IRuntimeSessionService).autoStartRuntime).mock.calls
				.map(([runtime, startReason, activate]) => [runtime.runtimeId, startReason.id, activate]);
		}

		it('starts in the background when another language\'s console is running', async () => {
			createService(LanguageStartupBehavior.Always, { overrideIdentifiers: ['r'] });
			// A Python console started first, e.g. from an Immediate recommendation.
			vi.spyOn(ctx.get(IRuntimeSessionService), 'hasStartingOrRunningConsole')
				.mockImplementation(languageId => languageId !== 'r');

			await recommendBothAfterDiscovery();

			expect(starts()).toEqual([['rt-r', SessionStartReasonId.StartupBehaviorAlways, false]]);
		});

		it('does not start when a console of its own language is running', async () => {
			createService(LanguageStartupBehavior.Always, { overrideIdentifiers: ['r'] });
			vi.spyOn(ctx.get(IRuntimeSessionService), 'hasStartingOrRunningConsole').mockReturnValue(true);

			await recommendBothAfterDiscovery();

			expect(starts()).toEqual([]);
		});

		it('starts for every language that has one', async () => {
			createService(LanguageStartupBehavior.Always, { overrideIdentifiers: ['python', 'r'] });

			await recommendBothAfterDiscovery();

			expect(starts().map(([runtimeId]) => runtimeId)).toEqual(['rt-py', 'rt-r']);
		});

		it('starts as well as the one language set by the value for all languages', async () => {
			// Python is set to always start by the value for all languages, R by its own.
			createService(LanguageStartupBehavior.Always, { overrideIdentifiers: ['r'] });

			await recommendBothAfterDiscovery();

			expect(starts().map(([runtimeId, startReason]) => [runtimeId, startReason])).toEqual([
				['rt-py', SessionStartReasonId.StartupBehaviorAlwaysAllLanguages],
				['rt-r', SessionStartReasonId.StartupBehaviorAlways],
			]);
		});
	});

	it.each([
		{ name: 'never answers', answer: () => new Promise<never>(() => { }) },
		{ name: 'fails', answer: () => Promise.reject(new Error('ranking failed')) },
	])('starts R when set to always start while the Python recommendation after discovery $name', async ({ answer }) => {
		createService(LanguageStartupBehavior.Always);
		const r = metadata({ languageId: 'r', runtimeId: 'rt-r', runtimePath: '/usr/bin/R', extensionId: 'ms.r' });
		ctx.disposables.add(ctx.get(ILanguageRuntimeService).registerRuntime({ ...r, startupBehavior: LanguageRuntimeStartupBehavior.Explicit }));
		const manager = makeManager({ id: 1, owns: [] });
		// Python and R share an extension host, so each language is asked on its own.
		manager.recommendWorkspaceRuntimes = async (disabledLanguageIds, afterDiscovery) =>
			afterDiscovery && !disabledLanguageIds.includes('python') ? answer() : [];
		ctx.disposables.add(svc.registerRuntimeManager(manager));

		completeDiscovery();

		await vi.waitFor(() => expect(startedRuntimeIds()).toEqual(['rt-r']));
	});

	it('starts the language recommended at startup first when every language is set to always start', async () => {
		createService(LanguageStartupBehavior.Always);
		// R is recommended at startup, e.g. from its default interpreter setting.
		const r = { ...metadata({ languageId: 'r', runtimeId: 'rt-r', runtimePath: '/usr/bin/R', extensionId: 'ms.r' }), startupBehavior: LanguageRuntimeStartupBehavior.Explicit };
		const manager = makeManager({ id: 1, owns: [] });
		manager.recommendWorkspaceRuntimes = async (_disabledLanguageIds, afterDiscovery) => afterDiscovery ?
			[{ metadata: metadata({ runtimeId: 'rt-py', runtimePath: '/venv/bin/python' }), isProjectDefault: false }] :
			[{ metadata: r, isProjectDefault: true }];
		ctx.disposables.add(svc.registerRuntimeManager(manager));

		await (svc as unknown as {
			startRecommendedLanguageRuntimes(disabledLanguageIds: string[], enabledLanguageIds: string[]): Promise<void>;
		}).startRecommendedLanguageRuntimes([], []);
		await (svc as unknown as { recommendAfterDiscovery: () => Promise<void> }).recommendAfterDiscovery();

		expect(startedRuntimeIds()).toEqual(['rt-r']);
	});

	it('maps the recommendation made after discovery to its defined variant when discovery is limited to definitions', async () => {
		const definition = { language: 'python', path: '/venv/bin/python', label: 'Python (GPU)' };
		createService(LanguageStartupBehavior.Always, { settings: await defineInterpreters(definition) });
		const recommended = metadata({ runtimeId: 'rt-rec', runtimePath: '/venv/bin/python' });
		recommendAfterDiscovery(recommended);
		completeDiscovery();

		const variantId = createInterpreterVariant(recommended, definition).runtimeId;
		await vi.waitFor(() => expect(startedRuntimeIds()).toEqual([variantId]));
		expect(svc.getPreferredRuntime('python')?.runtimeId).toBe(variantId);
	});

	it('does not start the affiliated runtime when set to start the recommendation', async () => {
		createService(LanguageStartupBehavior.Recommended);
		const startNewRuntimeSession = vi.spyOn(ctx.get(IRuntimeSessionService), 'startNewRuntimeSession').mockResolvedValue('');
		const affiliated = metadata({ runtimeId: 'rt-aff', runtimePath: '/old/bin/python' });
		affiliate(affiliated);
		(svc as unknown as { _startupPhase: RuntimeStartupPhase })._startupPhase = RuntimeStartupPhase.Discovering;
		ctx.disposables.add(ctx.get(ILanguageRuntimeService).registerRuntime(affiliated));

		recommendAfterDiscovery(metadata({ runtimeId: 'rt-rec', runtimePath: '/venv/bin/python' }));
		await (svc as unknown as { recommendAfterDiscovery: () => Promise<void> }).recommendAfterDiscovery();

		expect({
			startedAtRegistration: startNewRuntimeSession.mock.calls.length,
			preferred: svc.getPreferredRuntime('python')?.runtimeId,
		}).toEqual({
			startedAtRegistration: 0,
			preferred: 'rt-rec',
		});
	});

	describe('an Immediate recommendation made after discovery', () => {
		const immediate = { ...metadata({ runtimeId: 'rt-rec', runtimePath: '/venv/bin/python' }), startupBehavior: LanguageRuntimeStartupBehavior.Immediate };
		const runRecommendAfterDiscovery = () =>
			(svc as unknown as { recommendAfterDiscovery: () => Promise<void> }).recommendAfterDiscovery();

		it('starts when no language has an affiliation', async () => {
			createService(LanguageStartupBehavior.Auto);
			recommendAfterDiscovery(immediate);

			await runRecommendAfterDiscovery();

			expect(startedRuntimeIds()).toEqual(['rt-rec']);
		});

		it.each([
			{ name: 'a default that was never started', lastUsed: 0, lastStarted: 0 },
			{ name: 'a used affiliation', lastUsed: 1, lastStarted: 1 },
		])('starts when another language has $name and no console', async ({ lastUsed, lastStarted }) => {
			createService(LanguageStartupBehavior.Auto);
			const r = metadata({ languageId: 'r', runtimeId: 'rt-r', runtimePath: '/usr/bin/R', extensionId: 'ms.r' });
			ctx.get(IStorageService).store(`positron.affiliatedRuntimeMetadata.v3.r`,
				JSON.stringify({ metadata: r, lastUsed, lastStarted }),
				StorageScope.WORKSPACE, StorageTarget.MACHINE);
			recommendAfterDiscovery(immediate);

			await runRecommendAfterDiscovery();

			expect(startedRuntimeIds()).toEqual(['rt-rec']);
		});

		it('starts when the language has a default that was never started', async () => {
			createService(LanguageStartupBehavior.Auto);
			ctx.get(IStorageService).store(`positron.affiliatedRuntimeMetadata.v3.python`,
				JSON.stringify({ metadata: metadata({ runtimeId: 'rt-aff', runtimePath: '/old/bin/python' }), lastUsed: 0, lastStarted: 0 }),
				StorageScope.WORKSPACE, StorageTarget.MACHINE);
			recommendAfterDiscovery(immediate);

			await runRecommendAfterDiscovery();

			expect(startedRuntimeIds()).toEqual(['rt-rec']);
		});

		it('starts when set to start the recommendation, even if the language has a used affiliation', async () => {
			createService(LanguageStartupBehavior.Recommended);
			affiliate(metadata({ runtimeId: 'rt-aff', runtimePath: '/old/bin/python' }));
			recommendAfterDiscovery(immediate);

			await runRecommendAfterDiscovery();

			expect(startedRuntimeIds()).toEqual(['rt-rec']);
		});

		it('does not start when the language has a used affiliation', async () => {
			createService(LanguageStartupBehavior.Auto);
			affiliate(metadata({ runtimeId: 'rt-aff', runtimePath: '/old/bin/python' }));
			recommendAfterDiscovery(immediate);

			await runRecommendAfterDiscovery();

			expect(startedRuntimeIds()).toEqual([]);
		});
	});

	it('starts a runtime marked to start immediately when it registers after discovery', () => {
		const startReasonIds = createService(LanguageStartupBehavior.Auto);
		completeDiscovery();
		registerRuntime(LanguageRuntimeStartupBehavior.Immediate);

		expect(startReasonIds()).toEqual([SessionStartReasonId.ExtensionRequestedStartAtRegistration]);
	});

	it('starts a runtime for an open file\'s language when it registers after discovery', () => {
		const startReasonIds = createService(LanguageStartupBehavior.Auto);
		completeDiscovery();
		ctx.get(ILanguageService).requestRichLanguageFeatures('python');
		registerRuntime(LanguageRuntimeStartupBehavior.Implicit);

		expect(startReasonIds()).toEqual([SessionStartReasonId.LanguageFileOpenedAtRegistration]);
	});

	it('starts the recommendation made after discovery when a file of its language opens', async () => {
		ctx.instantiationService.stub(IConfigurationService,
			new TestConfigurationService({ 'interpreters.startupBehavior': LanguageStartupBehavior.Auto }));
		const autoStartRuntime = vi.spyOn(ctx.get(IRuntimeSessionService), 'autoStartRuntime').mockResolvedValue('');
		const svc = ctx.disposables.add(ctx.instantiationService.createInstance(RuntimeStartupService)) as RuntimeStartupService;

		// Discovery registers every runtime Explicit; the extension recommends the
		// same runtime as Implicit only when asked after discovery.
		registerRuntime(LanguageRuntimeStartupBehavior.Explicit);
		let asked = false;
		const manager = makeManager({ id: 1, owns: [] });
		manager.recommendWorkspaceRuntimes = async (_disabledLanguageIds, afterDiscovery) => {
			asked = !!afterDiscovery;
			return afterDiscovery ? [{ metadata: metadata(), isProjectDefault: false }] : [];
		};
		ctx.disposables.add(svc.registerRuntimeManager(manager));
		completeDiscovery();
		await vi.waitFor(() => expect(asked).toBe(true));
		// Let the answer be remembered.
		await new Promise(resolve => setTimeout(resolve, 0));
		const beforeFileOpen = autoStartRuntime.mock.calls.length;

		ctx.get(ILanguageService).requestRichLanguageFeatures('python');

		expect({
			beforeFileOpen,
			started: autoStartRuntime.mock.calls.map(([runtime, startReason]) => [runtime.runtimeId, startReason.id]),
		}).toEqual({
			beforeFileOpen: 0,
			started: [['rt-1', SessionStartReasonId.LanguageFileOpened]],
		});
	});

	it('keeps the start reason ID when saving workspace sessions', async () => {
		ctx.disposables.add(ctx.instantiationService.createInstance(RuntimeStartupService));
		const runtime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables, LanguageRuntimeSessionLocation.Workspace);

		await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables, {
			runtime,
			startReasonId: SessionStartReasonId.CodeExecutedWithoutSession,
		});

		await vi.waitFor(() => {
			const saved = setItem.mock.calls.at(-1)?.[1] as SerializedSessionMetadata[] | undefined;
			expect(saved?.map(session => session.metadata.startReasonId)).toEqual([SessionStartReasonId.CodeExecutedWithoutSession]);
		});
	});
});

/** `interpreters.startupBehavior` for all languages, with optional per-language values. */
interface IStartupBehaviors {
	default: LanguageStartupBehavior;
	[languageId: string]: LanguageStartupBehavior;
}

/**
 * `TestConfigurationService` ignores `overrideIdentifier`, so it can't hold a
 * per-language `interpreters.startupBehavior`. This one can.
 */
class StartupBehaviorConfigurationService extends TestConfigurationService {
	constructor(private readonly _startupBehavior: IStartupBehaviors, settings: Record<string, unknown> = {}) {
		super(settings);
		this.setOverrideIdentifiers('interpreters.startupBehavior',
			Object.keys(_startupBehavior).filter(key => key !== 'default'));
	}

	override getValue<T>(arg1?: string | IConfigurationOverrides, arg2?: IConfigurationOverrides): T | undefined {
		if (arg1 === 'interpreters.startupBehavior') {
			const languageId = arg2?.overrideIdentifier;
			return ((languageId && this._startupBehavior[languageId]) || this._startupBehavior.default) as T;
		}
		return super.getValue(arg1, arg2);
	}
}

/**
 * Runs the whole startup sequence: reconnect running consoles, start
 * the affiliated runtimes, start recommendations, search for
 * interpreters, then start a runtime once the search ends.
 */
describe('RuntimeStartupService - startup sequence', () => {

	const ctx = createTestContainer()
		.withRuntimeServices()
		.stub(IEphemeralStateService, {
			getItem: () => Promise.resolve(undefined),
			setItem: () => Promise.resolve(),
		})
		.stub(ILifecycleService, {
			onBeforeShutdown: Event.None,
			onWillShutdown: Event.None,
		})
		.stub(IProgressService, {})
		.stub(IWorkbenchEnvironmentService, { remoteAuthority: undefined })
		.stub(INotificationService, new TestNotificationService())
		.build();

	/** A language that an extension provides interpreters for. */
	interface IStartupLanguage {
		languageId: string;
		extensionId: string;
		/** The interpreters the extension's interpreter search finds. */
		discovered?: ILanguageRuntimeMetadata[];
		/** The affiliated runtime saved for this folder, if any. */
		affiliated?: { metadata: ILanguageRuntimeMetadata; lastUsed: number; lastStarted: number };
	}

	interface IStartupSequenceOptions {
		languages: IStartupLanguage[];
		startupBehavior: IStartupBehaviors;
		/** Replaces methods on the extension host's runtime manager. */
		manager?: Partial<IRuntimeManager>;
		/** The interpreter picked in the New Folder flow, when that flow just created this folder. */
		newFolderRuntime?: ILanguageRuntimeMetadata;
		/** Settings other than `interpreters.startupBehavior`. */
		settings?: Record<string, unknown>;
		/** Interpreters a recent search saved in the discovery cache. Their languages skip the search. */
		cached?: ILanguageRuntimeMetadata[];
		/** Consoles still running from the last time the folder was open, which startup reconnects before it starts anything. */
		reconnected?: ILanguageRuntimeMetadata[];
		/** The reconnected console the user focused last before the reload. */
		focusedLast?: ILanguageRuntimeMetadata;
		/** The reconnected console that ran code last before the reload. */
		ranCodeLast?: ILanguageRuntimeMetadata;
		/** Fires when a console comes to the front, in place of the session service's own event. */
		foregroundChanges?: Event<ILanguageRuntimeSession | undefined>;
		/** Fires when a session starts, in place of the session service's own event. */
		runtimeStarts?: Event<ILanguageRuntimeSession>;
		/** Runs when the interpreter search starts, before it finds anything. */
		beforeSearch?: () => Promise<void>;
		/**
		 * Runs the interpreter search in place of registering every language's
		 * `discovered` runtimes at once. It ends the search by calling
		 * `completeDiscovery(1)`.
		 */
		discover?: (service: RuntimeStartupService, started: IStartedRuntime[]) => Promise<void>;
	}

	interface IStartedRuntime {
		runtimeId: string;
		reason: SessionStartReasonId;
	}

	/**
	 * Opens the folder: runs the startup sequence the way the service does
	 * when the extensions that declare `languageRuntimes` load, and waits for
	 * it to finish. Interpreters aren't really started; each request to start
	 * one is recorded instead, and counts as a starting console from then on.
	 * The first console, started or reconnected, also counts as the console in
	 * front.
	 * The session service's own checks don't run, so a request is recorded
	 * even where the session service would refuse it (for example, for a
	 * language whose startup behavior is `manual`).
	 */
	async function runStartupSequence(options: IStartupSequenceOptions): Promise<{ service: RuntimeStartupService; started: IStartedRuntime[]; announced: string[]; cache: RuntimeDiscoveryCache }> {
		// Services the container already built, such as the language runtime
		// service, keep the configuration service they were given.
		const builtConfigurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		for (const [key, value] of Object.entries(options.settings ?? {})) {
			await builtConfigurationService.setUserConfiguration(key, value);
		}
		const configurationService = new StartupBehaviorConfigurationService(options.startupBehavior, options.settings);
		ctx.instantiationService.stub(IConfigurationService, configurationService);
		const cache = ctx.disposables.add(makeRealCache(ctx.get(IStorageService), configurationService));
		for (const runtime of options.cached ?? []) {
			await cache.upsert(runtime);
			cache.setLastFullDiscovery(runtime.extensionId.value, runtime.languageId, Date.now());
		}
		ctx.instantiationService.stub(IRuntimeDiscoveryCache, cache);
		const reconnectedSessions: SerializedSessionMetadata[] = (options.reconnected ?? []).map((runtime, i) => ({
			sessionName: runtime.runtimeName,
			metadata: {
				sessionId: `session-${i}`,
				sessionMode: LanguageRuntimeSessionMode.Console,
				notebookUri: undefined,
				createdTimestamp: 0,
				startReason: 'test',
				owner: 'user',
			},
			sessionState: RuntimeState.Idle,
			lastUsed: runtime === options.ranCodeLast ? 1 : 0,
			...(options.focusedLast ? { isLastActiveConsole: runtime === options.focusedLast } : {}),
			runtimeMetadata: runtime,
			workingDirectory: '/',
			hasConsole: true,
			localWindowId: 'window-1',
		}));
		ctx.instantiationService.stub(IEphemeralStateService, {
			getItem: async () => reconnectedSessions,
			setItem: async () => { },
		});
		ctx.instantiationService.stub(IPositronNewFolderService, {
			onDidChangeNewFolderStartupPhase: Event.None,
			startupPhase: NewFolderStartupPhase.Complete,
			initTasksComplete: stubInterface<Barrier>({
				isOpen: () => options.newFolderRuntime === undefined,
				wait: async () => true,
			}),
			newFolderRuntimeMetadata: options.newFolderRuntime,
		});

		for (const { affiliated } of options.languages) {
			if (affiliated) {
				ctx.get(IStorageService).store(`positron.affiliatedRuntimeMetadata.v3.${affiliated.metadata.languageId}`,
					JSON.stringify(affiliated), StorageScope.WORKSPACE, StorageTarget.MACHINE);
			}
		}

		const started: IStartedRuntime[] = [];
		const consoleLanguageIds = new Set<string>();
		const runtimeSessionService = ctx.get(IRuntimeSessionService);
		const languageRuntimeService = ctx.get(ILanguageRuntimeService);
		vi.spyOn(runtimeSessionService, 'autoStartRuntime').mockImplementation(async (metadata, startReason) => {
			started.push({ runtimeId: metadata.runtimeId, reason: startReason.id });
			consoleLanguageIds.add(metadata.languageId);
			return '';
		});
		vi.spyOn(runtimeSessionService, 'startNewRuntimeSession').mockImplementation(async (runtimeId, _name, _mode, _notebookUri, startReason) => {
			started.push({ runtimeId, reason: startReason.id });
			consoleLanguageIds.add(languageRuntimeService.getRegisteredRuntime(runtimeId)?.languageId ?? '');
			return '';
		});
		vi.spyOn(runtimeSessionService, 'validateRuntimeSession').mockResolvedValue(true);
		vi.spyOn(runtimeSessionService, 'restoreRuntimeSession').mockImplementation(async metadata => {
			consoleLanguageIds.add(metadata.languageId);
		});
		vi.spyOn(runtimeSessionService, 'hasStartingOrRunningConsole').mockImplementation(languageId =>
			languageId === undefined ? consoleLanguageIds.size > 0 : consoleLanguageIds.has(languageId));
		// The first console that starts or reconnects comes to the front.
		vi.spyOn(runtimeSessionService, 'foregroundSession', 'get').mockImplementation(() =>
			consoleLanguageIds.size > 0 ? stubInterface<ILanguageRuntimeSession>() : undefined);

		if (options.foregroundChanges) {
			// The container is rebuilt for each test, so this doesn't leak.
			Object.defineProperty(runtimeSessionService, 'onDidChangeForegroundSession', { value: options.foregroundChanges });
		}
		if (options.runtimeStarts) {
			Object.defineProperty(runtimeSessionService, 'onDidStartRuntime', { value: options.runtimeStarts });
		}

		const service = ctx.disposables.add(ctx.instantiationService.createInstance(RuntimeStartupService)) as RuntimeStartupService;
		// The runtime IDs the Console pane shows as starting, in order.
		const announced: string[] = [];
		ctx.disposables.add(service.onWillAutoStartRuntime(event => {
			if (event.activate) {
				announced.push(event.runtime.runtimeId);
			}
		}));
		const discovered = options.languages.flatMap(language => language.discovered ?? []);
		const manager: IRuntimeManager = {
			...makeManager({
				id: 1,
				owns: discovered,
				contributions: options.languages.map(({ extensionId, languageId }) => ({ extensionId, languageId, alwaysRediscover: false })),
			}),
			// The cache starts empty, so startup runs the interpreter search.
			discoverAllRuntimes: async () => {
				await options.beforeSearch?.();
				if (options.discover) {
					// Not awaited, like the extension host's search.
					options.discover(service, started);
					return;
				}
				for (const runtime of discovered) {
					service.registerDiscoveredRuntime(runtime);
				}
				service.completeDiscovery(1);
			},
			...options.manager,
		};
		// After the search, startup asks for recommendations again without waiting for the answers.
		const answersAfterDiscovery: Promise<unknown>[] = [];
		const recommend = manager.recommendWorkspaceRuntimes;
		manager.recommendWorkspaceRuntimes = (disabledLanguageIds, afterDiscovery) => {
			const answer = recommend(disabledLanguageIds, afterDiscovery);
			if (afterDiscovery) {
				answersAfterDiscovery.push(answer);
			}
			return answer;
		};
		ctx.disposables.add(service.registerRuntimeManager(manager));

		const complete = Event.toPromise(Event.filter(languageRuntimeService.onDidChangeRuntimeStartupPhase,
			phase => phase === RuntimeStartupPhase.Complete));
		const extensionPoint = ExtensionsRegistry.getExtensionPoints().find(point => point.name === 'languageRuntimes')!;
		extensionPoint.acceptUsers(options.languages.map(({ extensionId, languageId }) => ({
			description: stubInterface<IExtensionDescription>({ identifier: new ExtensionIdentifier(extensionId) }),
			value: [{ languageId }],
			collector: stubInterface<ExtensionMessageCollector>(),
		})));
		// The extension point outlives the service; leave it empty for the next test.
		ctx.disposables.add(toDisposable(() => extensionPoint.acceptUsers([])));
		await complete;
		// Wait for the recommendations asked for after the search. Then let
		// startup finish acting on them, and finish starting the other
		// affiliated runtimes in the background.
		await Promise.all(answersAfterDiscovery);
		await timeout(0);

		return { service, started, announced, cache };
	}

	/** The affiliated runtime saved in workspace storage for the language. */
	function storedAffiliation(languageId: string): { runtimeId: string; lastUsed: number; lastStarted: number } | undefined {
		const stored = ctx.get(IStorageService).get(`positron.affiliatedRuntimeMetadata.v3.${languageId}`, StorageScope.WORKSPACE);
		if (!stored) {
			return undefined;
		}
		const { metadata, lastUsed, lastStarted } = JSON.parse(stored) as { metadata: ILanguageRuntimeMetadata; lastUsed: number; lastStarted: number };
		return { runtimeId: metadata.runtimeId, lastUsed, lastStarted };
	}

	const python = metadata({ extensionId: 'ms-python.python', languageId: 'python', runtimeId: 'python-3.12' });
	const r = metadata({ extensionId: 'positron.positron-r', languageId: 'r', runtimeId: 'r-4.5' });
	const pythonLanguage = { languageId: 'python', extensionId: 'ms-python.python' };
	const rLanguage = { languageId: 'r', extensionId: 'positron.positron-r' };

	it('starts the affiliated runtime before asking for a recommendation', async () => {
		const { started } = await runStartupSequence({
			languages: [{ ...pythonLanguage, discovered: [python], affiliated: { metadata: python, lastUsed: 2, lastStarted: 1 } }],
			startupBehavior: { default: LanguageStartupBehavior.Auto },
		});

		expect(started).toEqual([{ runtimeId: python.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime }]);
	});

	it('moves an affiliated runtime saved by an earlier version to the new key and starts it', async () => {
		ctx.get(IStorageService).store('positron.affiliatedRuntimeMetadata.v2.python',
			JSON.stringify({ metadata: python, lastUsed: 2, lastStarted: 1 }), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const { started } = await runStartupSequence({
			languages: [{ ...pythonLanguage, discovered: [python] }],
			startupBehavior: { default: LanguageStartupBehavior.Auto },
		});

		expect({
			started,
			v2: ctx.get(IStorageService).get('positron.affiliatedRuntimeMetadata.v2.python', StorageScope.WORKSPACE),
		}).toEqual({
			started: [{ runtimeId: python.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime }],
			v2: undefined,
		});
	});

	it('drops an affiliated runtime saved by an earlier version that was never started or used', async () => {
		ctx.get(IStorageService).store('positron.affiliatedRuntimeMetadata.v2.python',
			JSON.stringify({ metadata: python, lastUsed: 0, lastStarted: 0 }), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const { service, started } = await runStartupSequence({
			languages: [{ ...pythonLanguage, discovered: [python] }],
			startupBehavior: { default: LanguageStartupBehavior.Auto },
		});

		expect({
			started,
			affiliated: service.getAffiliatedRuntimes(),
			v2: ctx.get(IStorageService).get('positron.affiliatedRuntimeMetadata.v2.python', StorageScope.WORKSPACE),
		}).toEqual({ started: [], affiliated: [], v2: undefined });
	});

	it('keeps an affiliated runtime under the new key over one saved by an earlier version', async () => {
		const olderPython = metadata({ extensionId: 'ms-python.python', languageId: 'python', runtimeId: 'python-3.11' });
		ctx.get(IStorageService).store('positron.affiliatedRuntimeMetadata.v2.python',
			JSON.stringify({ metadata: olderPython, lastUsed: 4, lastStarted: 3 }), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const { started } = await runStartupSequence({
			languages: [{ ...pythonLanguage, discovered: [python, olderPython], affiliated: { metadata: python, lastUsed: 2, lastStarted: 1 } }],
			startupBehavior: { default: LanguageStartupBehavior.Auto },
		});

		expect({ started, affiliated: storedAffiliation('python')?.runtimeId }).toEqual({
			started: [{ runtimeId: python.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime }],
			affiliated: python.runtimeId,
		});
	});

	it('removes affiliated runtimes saved by an earlier version that cannot be read', async () => {
		ctx.get(IStorageService).store('positron.affiliatedRuntimeMetadata.v2.python', '{not json', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		ctx.get(IStorageService).store('positron.affiliatedRuntimeMetadata.v2.r', 'null', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		const { service, started } = await runStartupSequence({
			languages: [{ ...pythonLanguage, discovered: [python] }],
			startupBehavior: { default: LanguageStartupBehavior.Auto },
		});

		expect({
			started,
			affiliated: service.getAffiliatedRuntimes(),
			v2: ['python', 'r'].map(languageId =>
				ctx.get(IStorageService).get(`positron.affiliatedRuntimeMetadata.v2.${languageId}`, StorageScope.WORKSPACE)),
		}).toEqual({ started: [], affiliated: [], v2: [undefined, undefined] });
	});

	it('starts a recommendation marked to start right away when no runtime is affiliated', async () => {
		const { started } = await runStartupSequence({
			languages: [{ ...rLanguage, discovered: [r] }],
			startupBehavior: { default: LanguageStartupBehavior.Auto },
			manager: {
				recommendWorkspaceRuntimes: async (_disabledLanguageIds, afterDiscovery) => afterDiscovery ? [] :
					[{ metadata: { ...r, startupBehavior: LanguageRuntimeStartupBehavior.Immediate }, isProjectDefault: true }],
			},
		});

		expect(started).toEqual([{ runtimeId: r.runtimeId, reason: SessionStartReasonId.ExtensionRecommendedRuntime }]);
	});

	it('starts the interpreter picked in the New Folder flow as the affiliated runtime', async () => {
		const { started } = await runStartupSequence({
			languages: [{ ...pythonLanguage, discovered: [python] }],
			startupBehavior: { default: LanguageStartupBehavior.Auto },
			newFolderRuntime: python,
		});

		expect(started).toEqual([{ runtimeId: python.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime }]);
	});

	it('after a reload, brings back the console that was focused last, not the one that ran code last', async () => {
		const focusedLast = metadata({ extensionId: 'ms-python.python', languageId: 'python', runtimeId: 'python-3.14' });
		await runStartupSequence({
			languages: [{ ...pythonLanguage, discovered: [python, focusedLast] }],
			startupBehavior: { default: LanguageStartupBehavior.Auto },
			reconnected: [python, focusedLast],
			focusedLast,
			ranCodeLast: python,
		});

		// The console the reconnect brings to the front.
		const activated = vi.mocked(ctx.get(IRuntimeSessionService).restoreRuntimeSession).mock.calls
			.filter(([, , , , activate]) => activate)
			.map(([runtime]) => runtime.runtimeId);
		expect(activated).toEqual([focusedLast.runtimeId]);
	});

	describe('pinned check', () => {
		const oldR = metadata({ extensionId: 'positron.positron-r', languageId: 'r', runtimeId: 'r-4.3', runtimePath: '/opt/R/4.3/bin/R' });
		const pinnedR = metadata({ extensionId: 'positron.positron-r', languageId: 'r', runtimeId: 'r-4.4', runtimePath: '/opt/R/4.4/bin/R' });
		const pinnedPython = metadata({ extensionId: 'ms-python.python', languageId: 'python', runtimeId: 'python-3.13', runtimePath: '/opt/python/3.13/bin/python' });
		const affiliatedR = { metadata: oldR, lastUsed: 2, lastStarted: 1 };

		/** A runtime manager answer that pins R to `pinnedR`. */
		function pinR() {
			return vi.fn(async (_extensionId: string, languageId: string) => languageId === 'r' ? pinnedR : undefined);
		}

		/**
		 * Runs the startup sequence on a fake clock and moves the clock on by
		 * `ms`, so a pinned check that never answers can reach its time limit.
		 */
		async function runStartupSequenceWithClock(ms: number, options: IStartupSequenceOptions) {
			vi.useFakeTimers();
			try {
				const sequence = runStartupSequence(options);
				await vi.advanceTimersByTimeAsync(ms);
				return await sequence;
			} finally {
				vi.useRealTimers();
			}
		}

		it('starts the pinned runtime instead of the affiliated runtime', async () => {
			const { started } = await runStartupSequence({
				languages: [{ ...rLanguage, discovered: [oldR], affiliated: affiliatedR }],
				startupBehavior: { default: LanguageStartupBehavior.Auto },
				manager: { pinnedWorkspaceRuntime: pinR() },
			});

			expect({ started, affiliated: storedAffiliation('r')?.runtimeId }).toEqual({
				started: [{ runtimeId: pinnedR.runtimeId, reason: SessionStartReasonId.PinnedRuntime }],
				affiliated: pinnedR.runtimeId,
			});
		});

		it('says the runtime started because it is pinned when the pin already is the affiliated runtime', async () => {
			const { started } = await runStartupSequence({
				languages: [{ ...rLanguage, discovered: [pinnedR], affiliated: { metadata: pinnedR, lastUsed: 2, lastStarted: 1 } }],
				startupBehavior: { default: LanguageStartupBehavior.Auto },
				manager: { pinnedWorkspaceRuntime: pinR() },
			});

			expect(started).toEqual([{ runtimeId: pinnedR.runtimeId, reason: SessionStartReasonId.PinnedRuntime }]);
		});

		it('gives the pinned reason only to the language that is pinned', async () => {
			const { started } = await runStartupSequence({
				languages: [
					{ ...rLanguage, affiliated: { metadata: oldR, lastUsed: 3, lastStarted: 1 } },
					{ ...pythonLanguage, affiliated: { metadata: python, lastUsed: 2, lastStarted: 1 } },
				],
				startupBehavior: { default: LanguageStartupBehavior.Auto },
				manager: { pinnedWorkspaceRuntime: pinR() },
			});

			expect(started).toEqual([
				{ runtimeId: pinnedR.runtimeId, reason: SessionStartReasonId.PinnedRuntime },
				{ runtimeId: python.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime },
			]);
		});

		it('names the pinned runtime in the Console pane once the check has run', async () => {
			// Startup announces the affiliated runtime before it activates the extension.
			const { announced } = await runStartupSequence({
				languages: [{ ...rLanguage, discovered: [oldR], affiliated: affiliatedR }],
				startupBehavior: { default: LanguageStartupBehavior.Auto },
				manager: { pinnedWorkspaceRuntime: pinR() },
			});

			expect(announced).toEqual([oldR.runtimeId, pinnedR.runtimeId]);
		});

		it('keeps the saved setup of an affiliated runtime that is the pinned runtime, and takes the rest from the pin', async () => {
			// The saved copy holds what the extension recorded when it started, such as an
			// environment module's startup command. The pin's answer can lack it, and it
			// can say so with an undefined value. Where the answer has a value, it is newer.
			const moduleSetup = { type: 'module', startupCommand: 'module load R/4.4' };
			const saved = { binpath: '/opt/R/4.4/bin/R', current: true, packagerMetadata: moduleSetup };
			const answer = { binpath: '/opt/R/4.4/bin/R', current: false, packagerMetadata: undefined };
			const { started } = await runStartupSequence({
				languages: [{ ...rLanguage, affiliated: { metadata: { ...pinnedR, extraRuntimeData: saved }, lastUsed: 2, lastStarted: 1 } }],
				startupBehavior: { default: LanguageStartupBehavior.Auto },
				manager: { pinnedWorkspaceRuntime: async () => ({ ...pinnedR, extraRuntimeData: answer }) },
			});

			const merged = { binpath: '/opt/R/4.4/bin/R', current: false, packagerMetadata: moduleSetup };
			const startedWith = vi.mocked(ctx.get(IRuntimeSessionService).autoStartRuntime).mock.calls.map(([runtime]) => runtime.extraRuntimeData);
			expect({
				started: started.map(start => start.runtimeId),
				startedWith,
				registeredWith: ctx.get(ILanguageRuntimeService).getRegisteredRuntime(pinnedR.runtimeId)?.extraRuntimeData,
				savedWith: JSON.parse(ctx.get(IStorageService).get('positron.affiliatedRuntimeMetadata.v3.r', StorageScope.WORKSPACE) ?? '{}').metadata?.extraRuntimeData,
			}).toEqual({ started: [pinnedR.runtimeId], startedWith: [merged], registeredWith: merged, savedWith: merged });
		});

		it('starts the affiliated runtime unchanged when no pin is set', async () => {
			const { started } = await runStartupSequence({
				languages: [{ ...rLanguage, discovered: [oldR], affiliated: affiliatedR }],
				startupBehavior: { default: LanguageStartupBehavior.Auto },
			});

			expect({ started, affiliated: storedAffiliation('r')?.runtimeId }).toEqual({
				started: [{ runtimeId: oldR.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime }],
				affiliated: oldR.runtimeId,
			});
		});

		it('does not ask for the pin when the language has no affiliated runtime', async () => {
			const pinnedWorkspaceRuntime = pinR();
			await runStartupSequence({
				languages: [{ ...rLanguage, discovered: [oldR] }],
				startupBehavior: { default: LanguageStartupBehavior.Auto },
				manager: { pinnedWorkspaceRuntime },
			});

			expect(pinnedWorkspaceRuntime).not.toHaveBeenCalled();
		});

		it('does not ask for the pin on the launch the New Folder flow picked the interpreter', async () => {
			const pinnedWorkspaceRuntime = pinR();
			const { started } = await runStartupSequence({
				languages: [{ ...rLanguage, discovered: [oldR] }],
				startupBehavior: { default: LanguageStartupBehavior.Auto },
				manager: { pinnedWorkspaceRuntime },
				newFolderRuntime: oldR,
			});

			expect(pinnedWorkspaceRuntime).not.toHaveBeenCalled();
			expect(started).toEqual([{ runtimeId: oldR.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime }]);
		});

		it('does not ask for the pin under recommended', async () => {
			const pinnedWorkspaceRuntime = pinR();
			await runStartupSequence({
				languages: [{ ...rLanguage, discovered: [oldR], affiliated: affiliatedR }],
				startupBehavior: { default: LanguageStartupBehavior.Recommended },
				manager: { pinnedWorkspaceRuntime },
			});

			expect(pinnedWorkspaceRuntime).not.toHaveBeenCalled();
		});

		it('puts the pin in place of a manual language\'s affiliated runtime without saving it, and starts nothing', async () => {
			// R is manual, so startup does not start its affiliated runtime.
			// Asking for recommendations activates the R extension, which runs
			// the check.
			const pinnedWorkspaceRuntime = pinR();
			const { service, started } = await runStartupSequence({
				languages: [{ ...rLanguage, discovered: [oldR], affiliated: affiliatedR }],
				startupBehavior: { default: LanguageStartupBehavior.Auto, r: LanguageStartupBehavior.Manual },
				manager: { pinnedWorkspaceRuntime },
			});

			expect({
				started,
				affiliated: service.getAffiliatedRuntimeMetadata('r')?.runtimeId,
				stored: storedAffiliation('r'),
			}).toEqual({
				started: [],
				affiliated: pinnedR.runtimeId,
				stored: { runtimeId: oldR.runtimeId, lastUsed: 2, lastStarted: 1 },
			});
			// Asking for recommendations and the interpreter search both activate
			// the extension, but it is asked once.
			expect(pinnedWorkspaceRuntime).toHaveBeenCalledTimes(1);
		});

		it('keeps reconnected consoles running, and keeps the console used last as the saved affiliated runtime', async () => {
			// After a reload, the pinned interpreter's console and the console
			// used last both reconnect. If the pin were saved here, a later
			// launch without the pin would start it as the one used last.
			const { started } = await runStartupSequence({
				languages: [{ ...rLanguage, discovered: [oldR, pinnedR], affiliated: affiliatedR }],
				startupBehavior: { default: LanguageStartupBehavior.Auto },
				manager: { pinnedWorkspaceRuntime: pinR() },
				reconnected: [oldR, pinnedR],
			});

			expect({ started, stored: storedAffiliation('r')?.runtimeId }).toEqual({
				started: [],
				stored: oldR.runtimeId,
			});
		});

		describe('when nothing started before the search', () => {
			// Neither language was used since it last started, so nothing starts
			// before the interpreter search. An affiliated runtime can then start
			// as the cache loads it.
			function skippedAffiliations(r: ILanguageRuntimeMetadata): IStartupLanguage[] {
				return [
					{ ...rLanguage, affiliated: { metadata: r, lastUsed: 1, lastStarted: 2 } },
					{ ...pythonLanguage, affiliated: { metadata: python, lastUsed: 1, lastStarted: 2 } },
				];
			}

			it('starts the pinned runtime instead of the old one before the cache loads', async () => {
				const { started } = await runStartupSequence({
					languages: skippedAffiliations(oldR),
					startupBehavior: { default: LanguageStartupBehavior.Auto },
					manager: { pinnedWorkspaceRuntime: pinR() },
					cached: [oldR],
				});

				expect(started).toEqual([{ runtimeId: pinnedR.runtimeId, reason: SessionStartReasonId.PinnedRuntime }]);
			});

			it('starts the pinned runtime before the cache loads, if it already is the affiliated runtime', async () => {
				const { started } = await runStartupSequence({
					languages: skippedAffiliations(pinnedR),
					startupBehavior: { default: LanguageStartupBehavior.Auto },
					manager: { pinnedWorkspaceRuntime: pinR() },
					cached: [pinnedR],
				});

				expect(started).toEqual([{ runtimeId: pinnedR.runtimeId, reason: SessionStartReasonId.PinnedRuntime }]);
			});
		});

		describe('interpreters.definitions entries for the pinned path', () => {
			const definition = (label: string) => ({ language: 'r', path: pinnedR.runtimePath, label });
			const definitions = [definition('R 4.4 (GPU)'), definition('R 4.4 (CPU)')];

			it('writes the first entry when discovery is limited to definitions', async () => {
				const { started } = await runStartupSequence({
					languages: [{ ...rLanguage, discovered: [oldR], affiliated: affiliatedR }],
					startupBehavior: { default: LanguageStartupBehavior.Auto },
					manager: { pinnedWorkspaceRuntime: pinR() },
					settings: { 'interpreters.definitions': definitions, 'interpreters.discovery': 'definitionsOnly' },
				});

				const gpu = createInterpreterVariant(pinnedR, definition('R 4.4 (GPU)'));
				expect({ started, affiliated: storedAffiliation('r')?.runtimeId }).toEqual({
					started: [{ runtimeId: gpu.runtimeId, reason: SessionStartReasonId.PinnedRuntime }],
					affiliated: gpu.runtimeId,
				});
			});

			it('writes the pinned interpreter itself otherwise, as the recommendation does', async () => {
				const { started } = await runStartupSequence({
					languages: [{ ...rLanguage, discovered: [oldR], affiliated: affiliatedR }],
					startupBehavior: { default: LanguageStartupBehavior.Auto },
					manager: { pinnedWorkspaceRuntime: pinR() },
					settings: { 'interpreters.definitions': definitions },
				});

				expect({ started, affiliated: storedAffiliation('r')?.runtimeId }).toEqual({
					started: [{ runtimeId: pinnedR.runtimeId, reason: SessionStartReasonId.PinnedRuntime }],
					affiliated: pinnedR.runtimeId,
				});
			});
		});

		it('never writes the pinned runtime to the discovery cache', async () => {
			const { cache } = await runStartupSequence({
				languages: [{ ...rLanguage, discovered: [oldR], affiliated: affiliatedR }],
				startupBehavior: { default: LanguageStartupBehavior.Auto },
				manager: { pinnedWorkspaceRuntime: pinR() },
			});

			expect(cache.getEntries(rLanguage.extensionId, 'r').map(entry => entry.metadata.runtimePath)).toEqual([oldR.runtimePath]);
		});

		it('starts the affiliated runtime when the pin takes over 20 seconds, and ignores the late pin', async () => {
			const lateAnswer = new DeferredPromise<ILanguageRuntimeMetadata | undefined>();
			const { service, started } = await runStartupSequenceWithClock(21_000, {
				languages: [{ ...rLanguage, discovered: [oldR], affiliated: affiliatedR }],
				startupBehavior: { default: LanguageStartupBehavior.Auto },
				manager: { pinnedWorkspaceRuntime: () => lateAnswer.p },
			});
			const affiliatedBeforeAnswer = storedAffiliation('r')?.runtimeId;

			// The check keeps running, but its answer applies only from the
			// next launch, so the console that started stays the affiliated
			// runtime.
			await lateAnswer.complete(pinnedR);
			await timeout(0);

			expect({
				started,
				affiliatedBeforeAnswer,
				affiliatedAfterAnswer: service.getAffiliatedRuntimeMetadata('r')?.runtimeId,
				storedAfterAnswer: storedAffiliation('r')?.runtimeId,
			}).toEqual({
				started: [{ runtimeId: oldR.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime }],
				affiliatedBeforeAnswer: oldR.runtimeId,
				affiliatedAfterAnswer: oldR.runtimeId,
				storedAfterAnswer: oldR.runtimeId,
			});
		});

		it('starts the affiliated runtime as the search finds it when the pin answers after 20 seconds', async () => {
			// Neither language was used since it last started, so nothing
			// starts before the search. Startup stops waiting for R's pin
			// check, and the check answers while the search runs, before the
			// search finds old R.
			const lateAnswer = new DeferredPromise<ILanguageRuntimeMetadata | undefined>();
			const { started } = await runStartupSequenceWithClock(21_000, {
				languages: [
					{ ...rLanguage, discovered: [oldR], affiliated: { metadata: oldR, lastUsed: 1, lastStarted: 2 } },
					{ ...pythonLanguage, affiliated: { metadata: python, lastUsed: 1, lastStarted: 2 } },
				],
				startupBehavior: { default: LanguageStartupBehavior.Auto },
				manager: {
					pinnedWorkspaceRuntime: (_extensionId, languageId) => languageId === 'r' ? lateAnswer.p : Promise.resolve(undefined),
				},
				beforeSearch: async () => {
					await lateAnswer.complete(pinnedR);
					await timeout(0);
				},
			});

			expect(started).toEqual([{ runtimeId: oldR.runtimeId, reason: SessionStartReasonId.AffiliatedRuntimeAtRegistration }]);
		});

		it('forgets the pin when the console saved as the affiliated runtime shuts down', async () => {
			// After a reload, old R's console reconnects and comes to the
			// front. The pin check answers after that, so old R stays saved.
			const lateAnswer = new DeferredPromise<ILanguageRuntimeMetadata | undefined>();
			const foreground = ctx.disposables.add(new Emitter<ILanguageRuntimeSession | undefined>());
			const runtimeState = ctx.disposables.add(new Emitter<RuntimeState>());
			const { service } = await runStartupSequence({
				languages: [{ ...rLanguage, discovered: [oldR], affiliated: affiliatedR }],
				startupBehavior: { default: LanguageStartupBehavior.Auto },
				manager: { pinnedWorkspaceRuntime: () => lateAnswer.p },
				reconnected: [oldR],
				foregroundChanges: foreground.event,
			});
			foreground.fire(stubInterface<ILanguageRuntimeSession>({ runtimeMetadata: oldR, onDidChangeRuntimeState: runtimeState.event }));
			await lateAnswer.complete(pinnedR);
			await timeout(0);

			// The user shuts down old R, which removes the saved affiliation.
			runtimeState.fire(RuntimeState.Exiting);

			expect({
				affiliated: service.getAffiliatedRuntimeMetadata('r')?.runtimeId,
				hasAffiliation: service.hasAffiliatedRuntime(),
				stored: storedAffiliation('r'),
			}).toEqual({
				affiliated: undefined,
				hasAffiliation: false,
				stored: undefined,
			});
		});

		it('loads the cache without waiting for the pin check of a language whose console reconnected', async () => {
			// Startup can't start Python's affiliated runtime while its console
			// runs, so the cache loads without waiting for Python's check. The
			// clock moves on by less than the check's time limit.
			await runStartupSequenceWithClock(1_000, {
				languages: [rLanguage, { ...pythonLanguage, affiliated: { metadata: python, lastUsed: 2, lastStarted: 1 } }],
				startupBehavior: { default: LanguageStartupBehavior.Auto },
				manager: {
					pinnedWorkspaceRuntime: (_extensionId, languageId) =>
						languageId === 'python' ? new Promise<never>(() => { }) : Promise.resolve(undefined),
				},
				cached: [oldR],
				reconnected: [python],
			});

			expect(ctx.get(ILanguageRuntimeService).getRegisteredRuntime(oldR.runtimeId)?.runtimeId).toBe(oldR.runtimeId);
		});

		it('starts the R console without waiting for Python\'s pin check', async () => {
			const autoStartRuntime = () => vi.mocked(ctx.get(IRuntimeSessionService).autoStartRuntime);
			const { started } = await runStartupSequence({
				languages: [
					{ ...rLanguage, affiliated: { metadata: oldR, lastUsed: 3, lastStarted: 1 } },
					{ ...pythonLanguage, affiliated: { metadata: python, lastUsed: 2, lastStarted: 1 } },
				],
				startupBehavior: { default: LanguageStartupBehavior.Auto },
				manager: {
					pinnedWorkspaceRuntime: async (_extensionId, languageId) => {
						if (languageId === 'r') {
							return pinnedR;
						}
						// Python answers only once the R console has started.
						await vi.waitFor(() => expect(autoStartRuntime()).toHaveBeenCalled());
						return pinnedPython;
					},
				},
			});

			expect(started).toEqual([
				{ runtimeId: pinnedR.runtimeId, reason: SessionStartReasonId.PinnedRuntime },
				{ runtimeId: pinnedPython.runtimeId, reason: SessionStartReasonId.PinnedRuntime },
			]);
		});

		describe('with recommendations', () => {
			/** The runtime as R's and Python's discovery register it. */
			function startsWhenPicked(runtime: ILanguageRuntimeMetadata): ILanguageRuntimeMetadata {
				return { ...runtime, startupBehavior: LanguageRuntimeStartupBehavior.Explicit };
			}

			/** Recommends the given runtimes on the first ask, and nothing after discovery. */
			function recommend(...runtimes: ILanguageRuntimeMetadata[]): IRuntimeManager['recommendWorkspaceRuntimes'] {
				return async (_disabledLanguageIds, afterDiscovery) => afterDiscovery ? [] :
					runtimes.map(runtime => ({ metadata: runtime, isProjectDefault: false }));
			}

			it('starts the recommended pinned R when an R file opens, if it is registered before any other R', async () => {
				// The runtime session service starts the first registered Implicit
				// runtime, and asking for recommendations registers the pinned R
				// before the search registers oldR.
				const { started } = await runStartupSequence({
					languages: [{ ...rLanguage, discovered: [oldR] }],
					startupBehavior: { default: LanguageStartupBehavior.Auto },
					manager: { recommendWorkspaceRuntimes: recommend(pinnedR) },
				});
				ctx.get(ILanguageService).requestRichLanguageFeatures('r');

				expect(started).toEqual([{ runtimeId: pinnedR.runtimeId, reason: SessionStartReasonId.LanguageFileOpened }]);
			});

			it('starts the recommended pinned R when an R file opens, if it is registered after another R', async () => {
				// The Python console starts first, so startup doesn't ask R for a
				// recommendation before the search. Discovery registers oldR first,
				// and R names the pinned R only when asked after discovery.
				// This test gives the discovered Rs the behavior R gives them (they
				// start only when picked), so it checks only that core then starts
				// the recommendation. That R gives them this behavior is checked by
				// positron-r's 'the search finds Rs that start only when picked'.
				const { started } = await runStartupSequence({
					languages: [
						{ ...rLanguage, discovered: [oldR, pinnedR].map(startsWhenPicked) },
						{ ...pythonLanguage, discovered: [python], affiliated: { metadata: python, lastUsed: 2, lastStarted: 1 } },
					],
					startupBehavior: { default: LanguageStartupBehavior.Auto },
					manager: {
						recommendWorkspaceRuntimes: async (_disabledLanguageIds, afterDiscovery) => afterDiscovery ?
							[{ metadata: pinnedR, isProjectDefault: false }] : [],
					},
				});
				ctx.get(ILanguageService).requestRichLanguageFeatures('r');

				expect(started).toEqual([
					{ runtimeId: python.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime },
					{ runtimeId: pinnedR.runtimeId, reason: SessionStartReasonId.LanguageFileOpened },
				]);
			});

			describe('asked once its own discovery finishes', () => {
				/** Recommends the given runtime after discovery, and nothing on the first ask. */
				function recommendAfterDiscovery(runtime: ILanguageRuntimeMetadata): IRuntimeManager['recommendWorkspaceRuntimes'] {
					return async (_disabledLanguageIds, afterDiscovery) => afterDiscovery ?
						[{ metadata: runtime, isProjectDefault: false }] : [];
				}

				const pythonUsedLast = { ...pythonLanguage, discovered: [python], affiliated: { metadata: python, lastUsed: 2, lastStarted: 1 } };

				/** Waits for R's recommendation after discovery to arrive. */
				async function waitForRRecommendation(service: RuntimeStartupService) {
					await vi.waitFor(() => expect(service.getPreferredRuntime('r')?.runtimeId).toBe(pinnedR.runtimeId));
				}

				it('opening an R file while Python is still being discovered starts the pinned R', async () => {
					let startedDuringSearch: IStartedRuntime[] = [];
					const { started } = await runStartupSequence({
						languages: [{ ...rLanguage, discovered: [oldR, pinnedR].map(startsWhenPicked) }, pythonUsedLast],
						startupBehavior: { default: LanguageStartupBehavior.Auto },
						manager: { recommendWorkspaceRuntimes: recommendAfterDiscovery(pinnedR) },
						discover: async (service, started) => {
							service.registerDiscoveredRuntime(startsWhenPicked(oldR));
							service.registerDiscoveredRuntime(startsWhenPicked(pinnedR));
							service.completeLanguageDiscovery(1, 'r');
							await waitForRRecommendation(service);
							ctx.get(ILanguageService).requestRichLanguageFeatures('r');
							startedDuringSearch = [...started];
							service.registerDiscoveredRuntime(python);
							service.completeDiscovery(1);
						},
					});

					const expected = [
						{ runtimeId: python.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime },
						{ runtimeId: pinnedR.runtimeId, reason: SessionStartReasonId.LanguageFileOpened },
					];
					expect({ startedDuringSearch, started }).toEqual({ startedDuringSearch: expected, started: expected });
				});

				it('an R file that is already open starts the pinned R once R\'s discovery finishes', async () => {
					let startedDuringSearch: IStartedRuntime[] = [];
					const { started } = await runStartupSequence({
						languages: [{ ...rLanguage, discovered: [oldR, pinnedR].map(startsWhenPicked) }, pythonUsedLast],
						startupBehavior: { default: LanguageStartupBehavior.Auto },
						manager: { recommendWorkspaceRuntimes: recommendAfterDiscovery(pinnedR) },
						discover: async (service, started) => {
							ctx.get(ILanguageService).requestRichLanguageFeatures('r');
							service.registerDiscoveredRuntime(startsWhenPicked(oldR));
							service.registerDiscoveredRuntime(startsWhenPicked(pinnedR));
							service.completeLanguageDiscovery(1, 'r');
							await vi.waitFor(() => expect(started).toHaveLength(2));
							startedDuringSearch = [...started];
							service.registerDiscoveredRuntime(python);
							service.completeDiscovery(1);
						},
					});

					const expected = [
						{ runtimeId: python.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime },
						{ runtimeId: pinnedR.runtimeId, reason: SessionStartReasonId.LanguageFileOpenedAtRegistration },
					];
					expect({ startedDuringSearch, started }).toEqual({ startedDuringSearch: expected, started: expected });
				});

				it('a recommendation that starts right away still waits for every language\'s discovery', async () => {
					// Until Python's search ends, an affiliated Python could still
					// start as the search registers it, and must not lose its place.
					const immediateR = { ...pinnedR, startupBehavior: LanguageRuntimeStartupBehavior.Immediate };
					let startedDuringSearch: IStartedRuntime[] = [];
					const { started } = await runStartupSequence({
						languages: [{ ...rLanguage, discovered: [oldR, pinnedR].map(startsWhenPicked) }, { ...pythonLanguage, discovered: [python] }],
						startupBehavior: { default: LanguageStartupBehavior.Auto },
						manager: { recommendWorkspaceRuntimes: recommendAfterDiscovery(immediateR) },
						discover: async (service, started) => {
							service.registerDiscoveredRuntime(startsWhenPicked(oldR));
							service.registerDiscoveredRuntime(startsWhenPicked(pinnedR));
							service.completeLanguageDiscovery(1, 'r');
							await waitForRRecommendation(service);
							startedDuringSearch = [...started];
							service.registerDiscoveredRuntime(python);
							service.completeDiscovery(1);
						},
					});

					expect({ startedDuringSearch, started }).toEqual({
						startedDuringSearch: [],
						started: [{ runtimeId: pinnedR.runtimeId, reason: SessionStartReasonId.ExtensionRecommendedRuntime }],
					});
				});

				it('a language the cache covers is asked before the other languages finish discovery', async () => {
					let startedDuringSearch: IStartedRuntime[] = [];
					const { started } = await runStartupSequence({
						languages: [rLanguage, pythonUsedLast],
						startupBehavior: { default: LanguageStartupBehavior.Auto },
						cached: [oldR, pinnedR].map(startsWhenPicked),
						manager: { recommendWorkspaceRuntimes: recommendAfterDiscovery(pinnedR) },
						discover: async (service, started) => {
							await waitForRRecommendation(service);
							ctx.get(ILanguageService).requestRichLanguageFeatures('r');
							startedDuringSearch = [...started];
							service.registerDiscoveredRuntime(python);
							service.completeDiscovery(1);
						},
					});

					const expected = [
						{ runtimeId: python.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime },
						{ runtimeId: pinnedR.runtimeId, reason: SessionStartReasonId.LanguageFileOpened },
					];
					expect({ startedDuringSearch, started }).toEqual({ startedDuringSearch: expected, started: expected });
				});

				/**
				 * Records the language each ask after discovery is for, and answers
				 * R with `answer`. Every language other than the one asked is
				 * passed as disabled.
				 */
				function recordAsks(answer: ILanguageRuntimeMetadata | undefined) {
					const asked: string[] = [];
					const recommendWorkspaceRuntimes: IRuntimeManager['recommendWorkspaceRuntimes'] = async (disabledLanguageIds, afterDiscovery) => {
						if (!afterDiscovery) {
							return [];
						}
						const languageId = ['r', 'python'].find(id => !disabledLanguageIds.includes(id));
						asked.push(languageId ?? '');
						return languageId === 'r' && answer ? [{ metadata: answer, isProjectDefault: false }] : [];
					};
					return { asked, recommendWorkspaceRuntimes };
				}

				it('waits for every language before asking when the discovery cache is off', async () => {
					// With the cache off, startup doesn't know which languages each
					// extension host searches, so a language that finished can't be
					// told apart from one that hasn't started.
					const { asked, recommendWorkspaceRuntimes } = recordAsks(pinnedR);
					let askedDuringSearch: string[] = [];
					await runStartupSequence({
						languages: [{ ...rLanguage, discovered: [oldR, pinnedR].map(startsWhenPicked) }, { ...pythonLanguage, discovered: [python] }],
						startupBehavior: { default: LanguageStartupBehavior.Auto },
						settings: { 'interpreters.discoveryCache.enabled': false },
						manager: { recommendWorkspaceRuntimes },
						discover: async service => {
							service.registerDiscoveredRuntime(startsWhenPicked(oldR));
							service.registerDiscoveredRuntime(startsWhenPicked(pinnedR));
							service.completeLanguageDiscovery(1, 'r');
							await new Promise(resolve => setTimeout(resolve, 0));
							askedDuringSearch = [...asked];
							service.registerDiscoveredRuntime(python);
							service.completeDiscovery(1);
						},
					});

					expect({ askedDuringSearch, asked: [...asked].sort() }).toEqual({ askedDuringSearch: [], asked: ['python', 'r'] });
				});

				it('asks a language once, even when it was asked early and recommended nothing', async () => {
					const { asked, recommendWorkspaceRuntimes } = recordAsks(undefined);
					await runStartupSequence({
						languages: [{ ...rLanguage, discovered: [oldR, pinnedR].map(startsWhenPicked) }, { ...pythonLanguage, discovered: [python] }],
						startupBehavior: { default: LanguageStartupBehavior.Auto },
						manager: { recommendWorkspaceRuntimes },
						discover: async service => {
							service.registerDiscoveredRuntime(startsWhenPicked(oldR));
							service.registerDiscoveredRuntime(startsWhenPicked(pinnedR));
							service.completeLanguageDiscovery(1, 'r');
							await vi.waitFor(() => expect(asked).toContain('r'));
							service.registerDiscoveredRuntime(python);
							service.completeDiscovery(1);
						},
					});

					expect([...asked].sort()).toEqual(['python', 'r']);
				});
			});

			describe('with an affiliated R that startup skipped, and Python in front', () => {
				// Python was used last. R wasn't used since it last started, so
				// startup starts only Python. With Python's console in front, the
				// search doesn't start R's affiliated runtime as it registers it.
				const languages = [
					{ ...rLanguage, discovered: [oldR, r].map(startsWhenPicked), affiliated: { metadata: startsWhenPicked(oldR), lastUsed: 1, lastStarted: 2 } },
					{ ...pythonLanguage, discovered: [python], affiliated: { metadata: python, lastUsed: 3, lastStarted: 1 } },
				];
				// With no pin, R recommends the R it lists first.
				const manager: Partial<IRuntimeManager> = {
					recommendWorkspaceRuntimes: async (_disabledLanguageIds, afterDiscovery) => afterDiscovery ?
						[{ metadata: r, isProjectDefault: false }] : [],
				};

				it('opening an R file starts the affiliated R, as running R code does', async () => {
					const { service, started } = await runStartupSequence({ languages, startupBehavior: { default: LanguageStartupBehavior.Auto }, manager });
					const preferred = service.getPreferredRuntime('r')?.runtimeId;
					ctx.get(ILanguageService).requestRichLanguageFeatures('r');

					expect({ started, preferred }).toEqual({
						started: [
							{ runtimeId: python.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime },
							{ runtimeId: oldR.runtimeId, reason: SessionStartReasonId.LanguageFileOpened },
						],
						preferred: oldR.runtimeId,
					});
				});

				it('an R file that is already open starts the affiliated R once R is recommended', async () => {
					const { started } = await runStartupSequence({
						languages,
						startupBehavior: { default: LanguageStartupBehavior.Auto },
						manager,
						discover: async service => {
							ctx.get(ILanguageService).requestRichLanguageFeatures('r');
							for (const runtime of languages.flatMap(language => language.discovered)) {
								service.registerDiscoveredRuntime(runtime);
							}
							service.completeDiscovery(1);
						},
					});

					expect(started).toEqual([
						{ runtimeId: python.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime },
						{ runtimeId: oldR.runtimeId, reason: SessionStartReasonId.LanguageFileOpenedAtRegistration },
					]);
				});
			});

			describe('opening a file skips a runtime that must not start on its own', () => {
				// R was used last, so startup starts R. Python's interpreters start
				// only when picked, and Python recommends nothing.
				const usedR = { ...rLanguage, discovered: [oldR], affiliated: affiliatedR };

				it('skips a Manual runtime that started last', async () => {
					// Like reticulate's Python, started from the R console.
					const manualPython = { ...pinnedPython, startupBehavior: LanguageRuntimeStartupBehavior.Manual };
					const runtimeStarts = ctx.disposables.add(new Emitter<ILanguageRuntimeSession>());
					const { started } = await runStartupSequence({
						languages: [usedR, { ...pythonLanguage, discovered: [startsWhenPicked(python), manualPython] }],
						startupBehavior: { default: LanguageStartupBehavior.Auto },
						runtimeStarts: runtimeStarts.event,
					});
					runtimeStarts.fire(stubInterface<ILanguageRuntimeSession>({ runtimeMetadata: manualPython }));
					ctx.get(ILanguageService).requestRichLanguageFeatures('python');

					expect(started).toEqual([{ runtimeId: oldR.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime }]);
				});

				it('skips a saved default that starts only when picked and was never started or used', async () => {
					// A project default the extension saved, as startup skips it.
					const { started } = await runStartupSequence({
						languages: [usedR, {
							...pythonLanguage,
							discovered: [startsWhenPicked(python)],
							affiliated: { metadata: startsWhenPicked(python), lastUsed: 0, lastStarted: 0 },
						}],
						startupBehavior: { default: LanguageStartupBehavior.Auto },
					});
					ctx.get(ILanguageService).requestRichLanguageFeatures('python');

					expect(started).toEqual([{ runtimeId: oldR.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime }]);
				});
			});

			it('starts the recommended pinned R when an R file opens during Discover All Interpreters', async () => {
				// R is recommended after the first search, so the second search
				// doesn't ask R again. The R file opens while that search runs.
				ctx.instantiationService.stub(IProgressService, stubInterface<IProgressService>({
					withProgress: async (_options, task) => task({ report: () => { } }),
				}));
				let searches = 0;
				const { service, started } = await runStartupSequence({
					languages: [
						{ ...rLanguage, discovered: [oldR, pinnedR].map(startsWhenPicked) },
						{ ...pythonLanguage, discovered: [python], affiliated: { metadata: python, lastUsed: 2, lastStarted: 1 } },
					],
					startupBehavior: { default: LanguageStartupBehavior.Auto },
					manager: {
						recommendWorkspaceRuntimes: async (_disabledLanguageIds, afterDiscovery) => afterDiscovery ?
							[{ metadata: pinnedR, isProjectDefault: false }] : [],
					},
					discover: async service => {
						if (++searches === 2) {
							ctx.get(ILanguageService).requestRichLanguageFeatures('r');
						}
						for (const runtime of [oldR, pinnedR].map(startsWhenPicked).concat(python)) {
							service.registerDiscoveredRuntime(runtime);
						}
						service.completeDiscovery(1);
					},
				});
				await service.rediscoverAllRuntimes();
				await timeout(0);

				expect(started).toEqual([
					{ runtimeId: python.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime },
					{ runtimeId: pinnedR.runtimeId, reason: SessionStartReasonId.LanguageFileOpened },
				]);
			});

			it('starts the pinned Python when a Python file opens, if Python did not start at launch', async () => {
				// Python's other interpreters start only when picked. R was used
				// last. Python wasn't used since it last started, so startup does
				// not start it.
				const discoveredPython = { ...python, startupBehavior: LanguageRuntimeStartupBehavior.Explicit };
				const { service, started } = await runStartupSequence({
					languages: [
						{ ...rLanguage, affiliated: { metadata: oldR, lastUsed: 3, lastStarted: 1 } },
						{ ...pythonLanguage, discovered: [discoveredPython], affiliated: { metadata: discoveredPython, lastUsed: 1, lastStarted: 2 } },
					],
					startupBehavior: { default: LanguageStartupBehavior.Auto },
					manager: {
						pinnedWorkspaceRuntime: async (_extensionId, languageId) => languageId === 'python' ? pinnedPython : undefined,
					},
				});
				// Running Python code with no console starts the preferred runtime.
				const preferred = service.getPreferredRuntime('python')?.runtimeId;
				ctx.get(ILanguageService).requestRichLanguageFeatures('python');

				expect({ started, preferred }).toEqual({
					started: [
						{ runtimeId: oldR.runtimeId, reason: SessionStartReasonId.AffiliatedRuntime },
						{ runtimeId: pinnedPython.runtimeId, reason: SessionStartReasonId.LanguageFileOpened },
					],
					preferred: pinnedPython.runtimeId,
				});
			});

			it('under recommended, running code with no console uses the pin, not the old affiliated runtime', async () => {
				const { service } = await runStartupSequence({
					languages: [{ ...rLanguage, discovered: [oldR], affiliated: affiliatedR }],
					startupBehavior: { default: LanguageStartupBehavior.Recommended },
					manager: { recommendWorkspaceRuntimes: recommend(pinnedR) },
				});

				// Running code with no console starts the preferred runtime.
				expect(service.getPreferredRuntime('r')?.runtimeId).toBe(pinnedR.runtimeId);
			});

			it('under always for R only, with no affiliated runtime, starts only the pinned R', async () => {
				const { started } = await runStartupSequence({
					languages: [{ ...rLanguage, discovered: [oldR] }, { ...pythonLanguage, discovered: [python] }],
					startupBehavior: { default: LanguageStartupBehavior.Auto, r: LanguageStartupBehavior.Always },
					manager: { recommendWorkspaceRuntimes: recommend(pinnedR, pinnedPython) },
				});

				expect(started).toEqual([{ runtimeId: pinnedR.runtimeId, reason: SessionStartReasonId.StartupBehaviorAlways }]);
			});
		});
	});
});

/**
 * Mock notification service that captures prompt calls for testing.
 */
class MockNotificationService implements Partial<INotificationService> {
	promptCalls: Array<{
		severity: Severity;
		message: string;
		choices?: IPromptChoice[];
		options?: IPromptOptions;
	}> = [];

	prompt(severity: Severity, message: string, choices?: IPromptChoice[], options?: IPromptOptions) {
		this.promptCalls.push({ severity, message, choices, options });
		return {
			close: () => { },
			onDidClose: new Emitter<void>().event,
			onDidChangeVisibility: new Emitter<boolean>().event,
			progress: { infinite: () => { }, total: () => { }, worked: () => { }, done: () => { } },
			updateSeverity: () => { },
			updateMessage: () => { },
			updateActions: () => { },
		};
	}
}
