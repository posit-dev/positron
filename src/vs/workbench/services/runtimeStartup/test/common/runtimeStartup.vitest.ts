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
	ILanguageRuntimeMetadata,
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
	IRuntimeDiscoveryCache,
} from '../../common/runtimeDiscoveryCacheService.js';

/**
 * Test-only extension to `IRuntimeDiscoveryCache` so test code can populate
 * buckets and toggle the enabled flag without colliding with the interface.
 */
interface ITestDiscoveryCache extends IRuntimeDiscoveryCache {
	setBucket(bucket: IDiscoveryCacheBucket): void;
	setEnabled(enabled: boolean): void;
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
	return stubInterface<ITestDiscoveryCache>({
		isEnabled: () => enabled,
		getAllBuckets: () => enabled ? Array.from(buckets.values()) : [],
		setBucket(bucket: IDiscoveryCacheBucket) {
			buckets.set(`${bucket.extensionId}::${bucket.languageId}`, bucket);
		},
		setEnabled(value: boolean) {
			enabled = value;
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
	rootSignatureBehavior?: 'normal' | 'throws' | 'never-resolves';
}

function makeManager(opts: IManagerOptions): IRuntimeManager {
	const ownsByPath = new Map(opts.owns.map(m => [m.runtimePath, m]));
	return {
		id: opts.id,
		discoverAllRuntimes: async () => { /* no-op for unit test */ },
		recommendWorkspaceRuntimes: async () => [],
		managesRuntime: async (metadata) => ownsByPath.has(metadata.runtimePath),
		validateMetadata: async (m) => m,
		getDiscoveryRootSignature: async (languageId: string) => {
			if (opts.rootSignatureBehavior === 'throws') {
				throw new Error('boom');
			}
			if (opts.rootSignatureBehavior === 'never-resolves') {
				return new Promise<IRuntimeRootSignature | undefined>(() => { /* never */ });
			}
			return opts.rootSignatureByLanguage?.[languageId];
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
}): IDiscoveryCacheBucket {
	const md = metadata({
		extensionId: opts.extensionId,
		languageId: opts.languageId,
		runtimePath: opts.runtimePath,
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
	function managersNeedingFullDiscovery(svc: RuntimeStartupService): Promise<IRuntimeManager[]> {
		return (svc as unknown as { managersNeedingFullDiscovery: () => Promise<IRuntimeManager[]> })
			.managersNeedingFullDiscovery();
	}

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

			const result = await managersNeedingFullDiscovery(svc);
			expect(result).toEqual([m1, m2]);
		});
	});

	describe('cold-start path', () => {
		it('returns every manager when no buckets are cached', async () => {
			const svc = makeService();
			const m1 = makeManager({ id: 1, owns: [] });
			ctx.disposables.add(svc.registerRuntimeManager(m1));

			const result = await managersNeedingFullDiscovery(svc);
			expect(result).toEqual([m1]);
			expect(lastFullDiscoveryReason(svc)).toBe('cold-start');
		});

		it('flags a manager that owns none of the cached buckets', async () => {
			// Cache has a Python bucket, but our manager doesn't claim Python.
			cache.setBucket(makeBucket({
				extensionId: 'ms.python',
				languageId: 'python',
				runtimePath: '/usr/bin/python3',
				lastFullDiscovery: Date.now(),
				signature: sig([['/usr/bin', true, 1000]]),
			}));
			const svc = makeService();
			const rManager = makeManager({ id: 2, owns: [] });
			ctx.disposables.add(svc.registerRuntimeManager(rManager));

			const result = await managersNeedingFullDiscovery(svc);
			expect(result).toEqual([rManager]);
			expect(lastFullDiscoveryReason(svc)).toBe('cold-start');
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

			const result = await managersNeedingFullDiscovery(svc);
			expect(result).toEqual([]);
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

			const result = await managersNeedingFullDiscovery(svc);
			expect(result).toEqual([pyManager]);
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

			const result = await managersNeedingFullDiscovery(svc);
			expect(result).toEqual([pyManager]);
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

			const result = await managersNeedingFullDiscovery(svc);
			expect(result).toEqual([pyManager]);
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

			const result = await managersNeedingFullDiscovery(svc);
			expect(result).toEqual([]);
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

			const result = await managersNeedingFullDiscovery(svc);
			expect(result).toEqual([pyManager]);
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
				const result = await promise;
				expect(result).toEqual([pyManager]);
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

			const result = await managersNeedingFullDiscovery(svc);
			expect(result).toHaveLength(2);
			expect(lastFullDiscoveryReason(svc)).toBe('roots-changed');
		});

		it('cold-start beats roots-changed when both fire across managers', async () => {
			// Manager A: cold-start (no buckets it owns).
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
				owns: [], // owns nothing -> cold-start
			})));
			ctx.disposables.add(svc.registerRuntimeManager(makeManager({
				id: 2,
				owns: [bBucket.entries[0].metadata],
				rootSignatureByLanguage: {
					r: sig([['/usr/local/bin', true, 9999]]), // differs
				},
			})));

			const result = await managersNeedingFullDiscovery(svc);
			expect(result).toHaveLength(2);
			expect(lastFullDiscoveryReason(svc)).toBe('cold-start');
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
