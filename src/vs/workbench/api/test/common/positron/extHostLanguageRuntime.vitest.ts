/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type * as positron from 'positron';
import { Emitter } from '../../../../../base/common/event.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeMetadata, LanguageRuntimeMessageType, LanguageRuntimeSessionMode, RuntimeExitReason, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionMetadata } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IMainPositronContext, MainThreadLanguageRuntimeShape } from '../../../common/positron/extHost.positron.protocol.js';
import { ExtHostLanguageRuntime } from '../../../common/positron/extHostLanguageRuntime.js';
import { SingleProxyRPCProtocol } from '../testRPCProtocol.js';

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
	return { cpu_percent: 0, memory_bytes: 0, thread_count: 0, sampling_period_ms: 0 };
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
