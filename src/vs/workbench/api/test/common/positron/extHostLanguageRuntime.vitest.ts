/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type * as positron from 'positron';
import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeMessageType, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, RuntimeExitReason, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionMetadata } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IActiveRuntimeSessionMetadataDto, IMainPositronContext, MainThreadLanguageRuntimeShape } from '../../../common/positron/extHost.positron.protocol.js';
import { ExtHostLanguageRuntime, ExtHostRuntimeSessionProxy } from '../../../common/positron/extHostLanguageRuntime.js';
import { SingleProxyRPCProtocol } from '../testRPCProtocol.js';

function fakeMetadata(overrides: Partial<ILanguageRuntimeMetadata> = {}): ILanguageRuntimeMetadata {
	return {
		runtimeId: 'r-4.5.0',
		runtimeName: 'R 4.5.0',
		runtimeShortName: '4.5.0',
		runtimePath: '/usr/local/bin/R',
		runtimeVersion: '4.5.0',
		runtimeSource: 'HQ',
		languageId: 'r',
		languageName: 'R',
		languageVersion: '4.5.0',
		base64EncodedIconSvg: undefined,
		startupBehavior: LanguageRuntimeStartupBehavior.Implicit,
		sessionLocation: LanguageRuntimeSessionLocation.Workspace,
		extraRuntimeData: {},
		extensionId: new ExtensionIdentifier('positron.positron-r'),
		...overrides,
	};
}

function createMockShape() {
	return new class extends mock<MainThreadLanguageRuntimeShape>() {
		registrations: ILanguageRuntimeMetadata[] = [];
		unregistrations: string[] = [];
		override $registerLanguageRuntime(metadata: ILanguageRuntimeMetadata): void {
			this.registrations.push(metadata);
		}
		override $unregisterLanguageRuntime(runtimeId: string): void {
			this.unregistrations.push(runtimeId);
		}
		override $emitPerfMark(_extensionId: string, _name: string): void {
			// no-op
		}
		override $completeLanguageRuntimeDiscovery(): void {
			// no-op
		}
	};
}

const fakeExtension: IExtensionDescription = {
	identifier: new ExtensionIdentifier('positron.positron-r'),
	isBuiltin: true,
	isUserBuiltin: false,
	isUnderDevelopment: false,
	name: 'positron-r',
	publisher: 'positron',
	version: '0.0.1',
	engines: { vscode: '*' },
	extensionLocation: URI.file('/fake'),
	targetPlatform: 'undefined' as unknown as IExtensionDescription['targetPlatform'],
	preRelease: false,
};

describe('ExtHostLanguageRuntime - onDidRegisterRuntime', function () {

	const disposables = ensureNoLeakedDisposables();

	let shape: ReturnType<typeof createMockShape>;

	beforeEach(() => {
		shape = createMockShape();
	});

	it('$onDidRegisterLanguageRuntime fires the public event', () => {
		const runtime = new ExtHostLanguageRuntime(SingleProxyRPCProtocol(shape), new NullLogService());
		const seen: positron.LanguageRuntimeMetadata[] = [];
		disposables.add(runtime.onDidRegisterRuntime(m => seen.push(m)));

		const meta = fakeMetadata();
		runtime.$onDidRegisterLanguageRuntime(meta);

		expect(seen).toEqual([meta]);
	});

	it('cache-loaded runtimes are visible to subscribers via the broadcast path', () => {
		// The bug this guards: cache loader registers a runtime via
		// `_languageRuntimeService.registerRuntime` on the main thread, which
		// historically did not propagate to the ext-host emitter. Now main
		// thread forwards every `onDidRegisterRuntime` event via
		// `$onDidRegisterLanguageRuntime`, so listeners like the reticulate
		// extension see the cache-driven registrations.
		const runtime = new ExtHostLanguageRuntime(SingleProxyRPCProtocol(shape), new NullLogService());
		const seen: positron.LanguageRuntimeMetadata[] = [];
		disposables.add(runtime.onDidRegisterRuntime(m => seen.push(m)));

		const r1 = fakeMetadata({ runtimeId: 'r-1' });
		const r2 = fakeMetadata({ runtimeId: 'r-2' });
		// Simulate the main-thread broadcast for two cache-loaded entries.
		runtime.$onDidRegisterLanguageRuntime(r1);
		runtime.$onDidRegisterLanguageRuntime(r2);

		expect(seen).toEqual([r1, r2]);
	});

	it('registerLanguageRuntime does not fire the local emitter directly', () => {
		// `registerLanguageRuntime` only calls `$registerLanguageRuntime` on
		// the proxy and updates local state; the public event fires when the
		// main thread broadcasts back via `$onDidRegisterLanguageRuntime`.
		// Without this round-trip-only firing, runtimes registered locally
		// would emit twice (once locally, once on broadcast).
		const runtime = new ExtHostLanguageRuntime(SingleProxyRPCProtocol(shape), new NullLogService());
		const seen: positron.LanguageRuntimeMetadata[] = [];
		disposables.add(runtime.onDidRegisterRuntime(m => seen.push(m)));

		const meta = fakeMetadata();
		const manager = new (mock<positron.LanguageRuntimeManager>())();
		disposables.add(runtime.registerLanguageRuntime(fakeExtension, manager, meta));

		// The proxy got the registration request...
		expect(shape.registrations.length).toBe(1);
		expect(shape.registrations[0].runtimeId).toBe(meta.runtimeId);
		// ...but the public event has not fired yet (it would on broadcast back).
		expect(seen).toEqual([]);
	});
});

/** A manager that exposes an `onDidRemoveRuntime` event for retraction tests. */
class RemovableManager extends mock<positron.LanguageRuntimeManager>() {
	readonly removeEmitter = new Emitter<string>();
	override readonly onDidRemoveRuntime = this.removeEmitter.event;
}

describe('ExtHostLanguageRuntime - onDidRemoveRuntime', function () {

	const disposables = ensureNoLeakedDisposables();

	let shape: ReturnType<typeof createMockShape>;
	let runtime: ExtHostLanguageRuntime;

	beforeEach(() => {
		shape = createMockShape();
		runtime = new ExtHostLanguageRuntime(SingleProxyRPCProtocol(shape), new NullLogService());
	});

	function registerRemovableRuntime(): RemovableManager {
		const manager = new RemovableManager();
		disposables.add(manager.removeEmitter);
		disposables.add(runtime.registerLanguageRuntimeManager(fakeExtension, 'r', manager));
		disposables.add(runtime.registerLanguageRuntime(fakeExtension, manager, fakeMetadata({ runtimeId: 'r-1' })));
		return manager;
	}

	it('retracts the runtime on the main thread when the manager fires onDidRemoveRuntime', () => {
		const manager = registerRemovableRuntime();

		manager.removeEmitter.fire('r-1');

		expect(shape.unregistrations).toEqual(['r-1']);
	});

	it('does not retract the runtime again when the manager is later disposed', () => {
		const manager = new RemovableManager();
		disposables.add(manager.removeEmitter);
		const managerRegistration = runtime.registerLanguageRuntimeManager(fakeExtension, 'r', manager);
		disposables.add(runtime.registerLanguageRuntime(fakeExtension, manager, fakeMetadata({ runtimeId: 'r-1' })));

		// The runtime is dropped from the manager map on retraction, so disposing
		// the manager afterwards must not unregister the same id a second time.
		manager.removeEmitter.fire('r-1');
		managerRegistration.dispose();

		expect(shape.unregistrations).toEqual(['r-1']);
	});
});

/**
 * A manager whose `discoverAllRuntimes` yields a fixed set of runtimes. Used to
 * exercise the discovery-completion enumeration paths.
 */
class DiscoveringManager extends mock<positron.LanguageRuntimeManager>() {
	constructor(private readonly _runtimes: positron.LanguageRuntimeMetadata[]) { super(); }
	override async *discoverAllRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
		for (const runtime of this._runtimes) {
			yield runtime;
		}
	}
}

describe('ExtHostLanguageRuntime - discovery completion', function () {

	const disposables = ensureNoLeakedDisposables();

	let shape: ReturnType<typeof createMockShape>;
	let runtime: ExtHostLanguageRuntime;

	beforeEach(() => {
		shape = createMockShape();
		runtime = new ExtHostLanguageRuntime(SingleProxyRPCProtocol(shape), new NullLogService());
	});

	it('enumerates a manager registered before warm-start completion', async () => {
		// The race this guards: a runtime manager registered via the public API
		// before discovery completed is parked in `_runtimeManagers`, waiting
		// for an enumeration pass. On the warm-start fast path the main thread
		// served every cached language from cache and signals completion via
		// `$markRuntimeDiscoveryComplete` -- without enumerating here, the parked
		// manager (whose language isn't cache-backed) would be stranded forever.
		const testRuntime = fakeMetadata({ runtimeId: 'test-1', languageId: 'test' }) as unknown as positron.LanguageRuntimeMetadata;
		const manager = new DiscoveringManager([testRuntime]);
		disposables.add(runtime.registerLanguageRuntimeManager(fakeExtension, 'test', manager));

		// Warm start completes; cached languages (r) are supplied in the skip set.
		await runtime.$markRuntimeDiscoveryComplete(['r']);

		expect(shape.registrations.map(r => r.runtimeId)).toEqual(['test-1']);
	});

	it('does not re-enumerate cache-satisfied managers on warm-start completion', async () => {
		// A manager whose language was served from cache must not be re-walked:
		// that is the whole point of the warm-start optimization.
		const rRuntime = fakeMetadata({ runtimeId: 'r-1', languageId: 'r' }) as unknown as positron.LanguageRuntimeMetadata;
		const manager = new DiscoveringManager([rRuntime]);
		disposables.add(runtime.registerLanguageRuntimeManager(fakeExtension, 'r', manager));

		await runtime.$markRuntimeDiscoveryComplete(['r']);

		expect(shape.registrations).toEqual([]);
	});
});

/** The internal and positron-API enums share string values — the bridge is structural. */
const positronSessionMode = LanguageRuntimeSessionMode.Console as unknown as positron.LanguageRuntimeSessionMode;
const positronMessageType = {
	Output: LanguageRuntimeMessageType.Output as unknown as positron.LanguageRuntimeMessageType,
	CommOpen: LanguageRuntimeMessageType.CommOpen as unknown as positron.LanguageRuntimeMessageType,
};

class TestSession extends mock<positron.LanguageRuntimeSession>() {
	readonly stateEmitter = new Emitter<RuntimeState>();
	readonly messageEmitter = new Emitter<positron.LanguageRuntimeMessage>();
	readonly endEmitter = new Emitter<positron.LanguageRuntimeExit>();
	readonly usageEmitter = new Emitter<positron.RuntimeResourceUsage>();

	override readonly onDidChangeRuntimeState = this.stateEmitter.event;
	override readonly onDidReceiveRuntimeMessage = this.messageEmitter.event;
	override readonly onDidEndSession = this.endEmitter.event;
	override readonly onDidUpdateResourceUsage = this.usageEmitter.event;

	override readonly metadata = stubInterface<positron.RuntimeSessionMetadata>({
		sessionId: 'test-session',
		sessionMode: positronSessionMode,
	});

	override updateSessionName(_name: string): void { }
	override async getDynState(): Promise<positron.LanguageRuntimeDynState> {
		return { inputPrompt: '>', continuationPrompt: '+', sessionName: 'test' };
	}
	// eslint-disable-next-line local/code-must-use-super-dispose -- mock<T>() has no real super.dispose()
	override dispose(): void { }
}

class TestManager extends mock<positron.LanguageRuntimeManager>() {
	constructor(private readonly _session: positron.LanguageRuntimeSession) { super(); }
	override async createSession(): Promise<positron.LanguageRuntimeSession> {
		return this._session;
	}
}

class TestProxy extends mock<MainThreadLanguageRuntimeShape>() {
	override $emitLanguageRuntimeState = vi.fn();
	override $emitLanguageRuntimeMessage = vi.fn();
	override $emitLanguageRuntimeExit = vi.fn();
	override $emitLanguageRuntimeResourceUsage = vi.fn();
}

const extensionId = 'test.ext';
const runtimeMetadata = stubInterface<ILanguageRuntimeMetadata>({
	languageId: 'r',
	extensionId: new ExtensionIdentifier(extensionId),
	runtimeId: 'r-1',
});
const sessionMetadata: IRuntimeSessionMetadata = {
	sessionId: 'test-session',
	sessionMode: LanguageRuntimeSessionMode.Console,
	notebookUri: undefined,
	createdTimestamp: 0,
	startReason: 'test',
};
const extension = stubInterface<IExtensionDescription>({
	id: extensionId,
	identifier: new ExtensionIdentifier(extensionId),
});

function buildMessage(type: positron.LanguageRuntimeMessageType, overrides: Partial<positron.LanguageRuntimeMessage> = {}): positron.LanguageRuntimeMessage {
	return { id: 'msg', parent_id: '', when: '', type, ...overrides };
}

function buildExit(): positron.LanguageRuntimeExit {
	return {
		runtime_name: 'R',
		session_name: 'test',
		exit_code: 0,
		reason: RuntimeExitReason.Shutdown as unknown as positron.RuntimeExitReason,
		message: '',
	};
}

function buildResourceUsage(): positron.RuntimeResourceUsage {
	return { cpu_percent: 0, memory_bytes: 0, thread_count: 0, sampling_period_ms: 0, timestamp: 0 };
}

async function createAttachedSession(runtime: ExtHostLanguageRuntime): Promise<{ session: TestSession; handle: number }> {
	const session = new TestSession();
	const manager = new TestManager(session);
	runtime.registerLanguageRuntimeManager(extension, 'r', manager);
	const init = await runtime.$createLanguageRuntimeSession(runtimeMetadata, sessionMetadata, 'test');
	return { session, handle: init.handle };
}

describe('ExtHostLanguageRuntime', () => {
	let proxy: TestProxy;
	let runtime: ExtHostLanguageRuntime;

	beforeEach(() => {
		proxy = new TestProxy();
		const rpc = SingleProxyRPCProtocol(proxy) as unknown as IMainPositronContext;
		runtime = new ExtHostLanguageRuntime(rpc, new NullLogService());
	});

	describe('$disposeLanguageRuntime', () => {
		it('disposes the four session listeners wired by attachToSession', async () => {
			const { session, handle } = await createAttachedSession(runtime);

			session.stateEmitter.fire(RuntimeState.Ready);
			session.messageEmitter.fire(buildMessage(positronMessageType.Output));
			session.endEmitter.fire(buildExit());
			session.usageEmitter.fire(buildResourceUsage());

			expect(proxy.$emitLanguageRuntimeState).toHaveBeenCalledTimes(1);
			expect(proxy.$emitLanguageRuntimeMessage).toHaveBeenCalledTimes(1);
			expect(proxy.$emitLanguageRuntimeExit).toHaveBeenCalledTimes(1);
			expect(proxy.$emitLanguageRuntimeResourceUsage).toHaveBeenCalledTimes(1);

			await runtime.$disposeLanguageRuntime(handle);

			expect(session.stateEmitter.hasListeners()).toBe(false);
			expect(session.messageEmitter.hasListeners()).toBe(false);
			expect(session.endEmitter.hasListeners()).toBe(false);
			expect(session.usageEmitter.hasListeners()).toBe(false);

			// Further emissions must not reach the proxy.
			session.stateEmitter.fire(RuntimeState.Exited);
			session.messageEmitter.fire(buildMessage(positronMessageType.Output, { id: 'msg2' }));
			session.endEmitter.fire(buildExit());
			session.usageEmitter.fire(buildResourceUsage());

			expect(proxy.$emitLanguageRuntimeState).toHaveBeenCalledTimes(1);
			expect(proxy.$emitLanguageRuntimeMessage).toHaveBeenCalledTimes(1);
			expect(proxy.$emitLanguageRuntimeExit).toHaveBeenCalledTimes(1);
			expect(proxy.$emitLanguageRuntimeResourceUsage).toHaveBeenCalledTimes(1);
		});

		it('disposes per-comm state listeners registered by handleCommOpen', async () => {
			const { session, handle } = await createAttachedSession(runtime);

			// CommOpen via the wire causes handleCommOpen to register an extra
			// listener on the state emitter.
			session.messageEmitter.fire(buildMessage(positronMessageType.CommOpen, {
				id: 'comm-msg-1',
			}));
			session.messageEmitter.fire(buildMessage(positronMessageType.CommOpen, {
				id: 'comm-msg-2',
			}));

			await runtime.$disposeLanguageRuntime(handle);

			expect(session.stateEmitter.hasListeners()).toBe(false);
		});

		it('keeps the array slot so later session handles stay valid', async () => {
			const { handle: firstHandle } = await createAttachedSession(runtime);
			await runtime.$disposeLanguageRuntime(firstHandle);

			const { handle: secondHandle } = await createAttachedSession(runtime);

			expect(secondHandle).toBe(firstHandle + 1);
			// Re-disposing must still find the (released) slot rather than throwing.
			await expect(runtime.$disposeLanguageRuntime(secondHandle)).resolves.toBeUndefined();
		});
	});
});

/**
 * A main-thread shape stub for proxy-session tests. It serves a single session
 * (owned by "another" extension host) via `$getSession` and records the
 * subscribe/unsubscribe calls the proxy makes for event forwarding.
 */
function createProxyShape(dto: IActiveRuntimeSessionMetadataDto) {
	return new class extends mock<MainThreadLanguageRuntimeShape>() {
		subscribed: string[] = [];
		unsubscribed: string[] = [];
		override async $getSession(sessionId: string): Promise<IActiveRuntimeSessionMetadataDto | undefined> {
			return sessionId === dto.metadata.sessionId ? dto : undefined;
		}
		override $subscribeToSession(sessionId: string): void {
			this.subscribed.push(sessionId);
		}
		override $unsubscribeFromSession(sessionId: string): void {
			this.unsubscribed.push(sessionId);
		}
	};
}

function fakeSessionDto(overrides: Partial<IActiveRuntimeSessionMetadataDto> = {}): IActiveRuntimeSessionMetadataDto {
	return {
		metadata: {
			sessionId: 's1',
			sessionMode: LanguageRuntimeSessionMode.Console,
		},
		runtimeMetadata: fakeMetadata(),
		runtimeState: RuntimeState.Idle,
		...overrides,
	};
}

describe('ExtHostLanguageRuntime - proxy session', function () {

	const disposables = ensureNoLeakedDisposables();

	it('getSession returns a proxy seeded with the current runtime state and subscribes for updates', async () => {
		const shape = createProxyShape(fakeSessionDto({ runtimeState: RuntimeState.Busy }));
		const runtime = new ExtHostLanguageRuntime(SingleProxyRPCProtocol(shape), new NullLogService());

		const session = await runtime.getSession('s1') as ExtHostRuntimeSessionProxy;
		disposables.add(session);

		// The proxy exposes the synchronous accessor seeded from the DTO...
		expect(session.getRuntimeState()).toBe(RuntimeState.Busy);
		// ...and asks the main thread to forward events for this session.
		expect(shape.subscribed).toEqual(['s1']);
	});

	it('forwards state changes, disconnect and reconnect to the proxy', async () => {
		const shape = createProxyShape(fakeSessionDto({ runtimeState: RuntimeState.Idle }));
		const runtime = new ExtHostLanguageRuntime(SingleProxyRPCProtocol(shape), new NullLogService());

		const session = await runtime.getSession('s1') as ExtHostRuntimeSessionProxy;
		disposables.add(session);

		let disconnects = 0;
		let reconnects = 0;
		disposables.add(session.onDidDisconnect(() => disconnects++));
		disposables.add(session.onDidReconnect(() => reconnects++));

		runtime.$updateProxySessionState('s1', RuntimeState.Busy);
		runtime.$notifyProxySessionDisconnected('s1');
		runtime.$notifyProxySessionReconnected('s1');

		expect({ state: session.getRuntimeState(), disconnects, reconnects })
			.toEqual({ state: RuntimeState.Busy, disconnects: 1, reconnects: 1 });
	});

	it('unsubscribes from main-thread forwarding when the proxy is disposed', async () => {
		const shape = createProxyShape(fakeSessionDto());
		const runtime = new ExtHostLanguageRuntime(SingleProxyRPCProtocol(shape), new NullLogService());

		const session = await runtime.getSession('s1') as ExtHostRuntimeSessionProxy;
		session.dispose();

		expect(shape.unsubscribed).toEqual(['s1']);
	});

	it('returns the same proxy instance for repeated getSession calls', async () => {
		const shape = createProxyShape(fakeSessionDto());
		const runtime = new ExtHostLanguageRuntime(SingleProxyRPCProtocol(shape), new NullLogService());

		const first = await runtime.getSession('s1') as ExtHostRuntimeSessionProxy;
		disposables.add(first);
		const second = await runtime.getSession('s1') as ExtHostRuntimeSessionProxy;

		// Cached: same object, and we only subscribe once.
		expect(second).toBe(first);
		expect(shape.subscribed).toEqual(['s1']);
	});

	it('ignores forwarded events for sessions with no live proxy', () => {
		const shape = createProxyShape(fakeSessionDto());
		const runtime = new ExtHostLanguageRuntime(SingleProxyRPCProtocol(shape), new NullLogService());

		// No proxy was created for this id, so forwarded events must be no-ops.
		expect(() => {
			runtime.$updateProxySessionState('s-unknown', RuntimeState.Busy);
			runtime.$notifyProxySessionDisconnected('s-unknown');
			runtime.$notifyProxySessionReconnected('s-unknown');
		}).not.toThrow();
	});
});
