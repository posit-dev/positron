/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter, Event } from '../../../../../base/common/event.js';
import { isWeb } from '../../../../../base/common/platform.js';
import { arch as systemArch } from '../../../../../base/common/process.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IEphemeralStateService } from '../../../../../platform/ephemeralState/common/ephemeralState.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { INotificationService, IPromptChoice, IPromptOptions, Severity } from '../../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../../platform/notification/test/common/testNotificationService.js';
import { IProgressService } from '../../../../../platform/progress/common/progress.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IWorkbenchEnvironmentService } from '../../../environment/common/environmentService.js';
import {
	IHostedLanguageContribution,
	ILanguageRuntimeMetadata,
	ILanguageRuntimeService,
	IRuntimeManager,
	IRuntimeRootSignature,
	LanguageRuntimeArchitecture,
	LanguageRuntimeSessionLocation,
	LanguageRuntimeStartupBehavior,
	RuntimeStartupPhase,
} from '../../../languageRuntime/common/languageRuntimeService.js';
import { BeforeShutdownEvent, ILifecycleService, WillShutdownEvent } from '../../../lifecycle/common/lifecycle.js';
import { IPositronNewFolderService, NewFolderStartupPhase } from '../../../positronNewFolder/common/positronNewFolder.js';
import { ILanguageRuntimeSession } from '../../../runtimeSession/common/runtimeSessionService.js';
import { RuntimeStartupService } from '../../common/runtimeStartup.js';
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

const sig = (entries: Array<[string, boolean, number]>, opaque?: string): IRuntimeRootSignature => ({
	entries: entries.map(([path, exists, mtimeMs]) => ({ path, exists, mtimeMs })),
	opaque,
});

describe('RuntimeStartupService - cache-aware discovery', () => {

	let cache: ITestDiscoveryCache = undefined!;
	let config: TestConfigurationService = undefined!;

	const ctx = createTestContainer()
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

		it("skips a manager that hosts no contributions at all", async () => {
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
});

describe('Positron - RuntimeStartupService Architecture Mismatch', () => {

	describe('Local sessions', () => {
		const notificationService = new MockNotificationService();
		const ctx = createTestContainer()
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
		const ctx = createTestContainer()
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
