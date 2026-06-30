/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter, Event } from '../../../../../base/common/event.js';
import {
	ILanguageRuntimeMessageError,
	ILanguageRuntimeMessageOutput,
	ILanguageRuntimeMessageResult,
	ILanguageRuntimeMessageState,
	ILanguageRuntimeMessageStream,
	LanguageRuntimeMessageType,
	RuntimeOnlineState,
	RuntimeOutputKind,
} from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronConsoleService } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ActiveRuntimeSession } from '../../../../services/runtimeSession/common/activeRuntimeSession.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { executeCodeWithObserver } from '../../browser/positronMcpExecuteCode.js';

/**
 * A fake session that exposes only the per-type message emitters the observer
 * subscribes to. Tests fire these to simulate the runtime's responses.
 */
function fakeSession() {
	const stream = new Emitter<ILanguageRuntimeMessageStream>();
	const output = new Emitter<ILanguageRuntimeMessageOutput>();
	const result = new Emitter<ILanguageRuntimeMessageResult>();
	const error = new Emitter<ILanguageRuntimeMessageError>();
	const state = new Emitter<ILanguageRuntimeMessageState>();
	const session = stubInterface<ILanguageRuntimeSession>({
		onDidReceiveRuntimeMessageStream: stream.event,
		onDidReceiveRuntimeMessageOutput: output.event,
		onDidReceiveRuntimeMessageResult: result.event,
		onDidReceiveRuntimeMessageError: error.event,
		onDidReceiveRuntimeMessageState: state.event,
	});
	return { session, stream, output, result, error, state };
}

/**
 * Wire a console service and session service around one fake session.
 * `executeCode` resolves immediately (the dispatch succeeded). The observer
 * generates its own execution id and passes it to `executeCode` as the 9th
 * argument; `executionId()` reads it back so the test can stamp it onto the
 * runtime messages it fires (the observer matches messages by parent_id).
 */
function services(
	session: ILanguageRuntimeSession,
	executeCode: IPositronConsoleService['executeCode'] = vi.fn(async () => 'session-1'),
) {
	const consoleService = stubInterface<IPositronConsoleService>({ executeCode });
	const sessionService = stubInterface<IRuntimeSessionService>({
		getActiveSessions: () => [stubInterface<ActiveRuntimeSession>({ session })],
		onWillStartSession: Event.None,
	});
	// The observer passes its generated executionId as executeCode's 9th argument.
	const executionId = () => vi.mocked(executeCode).mock.calls[0]?.[8] ?? '';
	return { consoleService, sessionService, executeCode, executionId };
}

/** Shared base fields for a runtime message, carrying a parent_id. */
function base(type: LanguageRuntimeMessageType, parentId: string) {
	return { id: 'm', type, event_clock: 0, parent_id: parentId, when: '' };
}

function resultMsg(parentId: string, data: Record<string, string>): ILanguageRuntimeMessageResult {
	return { ...base(LanguageRuntimeMessageType.Result, parentId), kind: RuntimeOutputKind.Text, data, execution_count: 1 };
}
function outputMsg(parentId: string, data: Record<string, string>): ILanguageRuntimeMessageOutput {
	return { ...base(LanguageRuntimeMessageType.Output, parentId), kind: RuntimeOutputKind.Text, data };
}
function streamMsg(parentId: string, text: string): ILanguageRuntimeMessageStream {
	return { ...base(LanguageRuntimeMessageType.Stream, parentId), name: 'stdout', text };
}
function errorMsg(parentId: string, name: string, message: string, traceback: string[]): ILanguageRuntimeMessageError {
	return { ...base(LanguageRuntimeMessageType.Error, parentId), name, message, traceback };
}
function stateMsg(parentId: string, state: RuntimeOnlineState): ILanguageRuntimeMessageState {
	return { ...base(LanguageRuntimeMessageType.State, parentId), state };
}

describe('executeCodeWithObserver', () => {
	it('resolves success with the data from a matching Result message', async () => {
		const f = fakeSession();
		const { consoleService, sessionService, executionId } = services(f.session);

		const promise = executeCodeWithObserver(consoleService, sessionService, 'python', 'x = 1', 1000);
		await Promise.resolve();
		f.result.fire(resultMsg(executionId(), { 'text/plain': '42' }));

		expect(await promise).toEqual({ kind: 'success', data: { 'text/plain': '42' } });
	});

	it('accumulates stream/output then settles on the idle state transition', async () => {
		const f = fakeSession();
		const { consoleService, sessionService, executionId } = services(f.session);

		const promise = executeCodeWithObserver(consoleService, sessionService, 'python', 'print(1)', 1000);
		await Promise.resolve();
		const id = executionId();
		f.state.fire(stateMsg(id, RuntimeOnlineState.Busy));
		f.stream.fire(streamMsg(id, 'hello '));
		f.output.fire(outputMsg(id, { 'text/plain': 'world' }));
		f.state.fire(stateMsg(id, RuntimeOnlineState.Idle));

		// Idle with no Result settles to success with empty data; output is streamed
		// (surfaced only on the timeout path, exercised separately).
		expect(await promise).toEqual({ kind: 'success', data: {} });
	});

	it('resolves error from a matching Error message', async () => {
		const f = fakeSession();
		const { consoleService, sessionService, executionId } = services(f.session);

		const promise = executeCodeWithObserver(consoleService, sessionService, 'python', 'boom', 1000);
		await Promise.resolve();
		f.error.fire(errorMsg(executionId(), 'ValueError', 'bad', ['line 1']));

		expect(await promise).toEqual({ kind: 'error', error: { name: 'ValueError', message: 'bad', traceback: ['line 1'] } });
	});

	it('ignores messages whose parent_id does not match the execution', async () => {
		const f = fakeSession();
		const { consoleService, sessionService } = services(f.session);

		const promise = executeCodeWithObserver(consoleService, sessionService, 'python', 'x = 1', 50);
		await Promise.resolve();
		// A result from an unrelated execution must not settle this observer.
		f.result.fire(resultMsg('other-execution', { 'text/plain': 'nope' }));

		const outcome = await promise;
		expect(outcome.kind).toBe('timeout');
	});

	it('times out and reports whether execution had started', async () => {
		const f = fakeSession();
		const { consoleService, sessionService, executionId } = services(f.session);

		const promise = executeCodeWithObserver(consoleService, sessionService, 'python', 'sleep()', 50);
		await Promise.resolve();
		f.state.fire(stateMsg(executionId(), RuntimeOnlineState.Busy));

		expect(await promise).toEqual({ kind: 'timeout', started: true, streamed: '' });
	});

	it('reports a dispatch-time rejection as an error outcome', async () => {
		const f = fakeSession();
		const failing = vi.fn(async () => { throw new Error('no runtime registered'); });
		const { consoleService, sessionService } = services(f.session, failing);

		const outcome = await executeCodeWithObserver(consoleService, sessionService, 'python', 'x = 1', 1000);
		expect(outcome).toMatchObject({ kind: 'error', error: { message: 'no runtime registered' } });
	});
});
