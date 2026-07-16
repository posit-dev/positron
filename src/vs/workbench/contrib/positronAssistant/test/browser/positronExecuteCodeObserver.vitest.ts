/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Emitter } from '../../../../../base/common/event.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { ILanguageRuntimeMessageError, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageResult, ILanguageRuntimeMessageState, ILanguageRuntimeMessageStream, RuntimeOnlineState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { PositronExecuteCodeObserver } from '../../browser/tools/positronExecuteCodeObserver.js';

const EXECUTION_ID = 'exec-1';

describe('PositronExecuteCodeObserver', () => {
	const disposables = ensureNoLeakedDisposables();

	// Emitters standing in for the session's runtime message stream.
	let output: Emitter<ILanguageRuntimeMessageOutput>;
	let result: Emitter<ILanguageRuntimeMessageResult>;
	let stream: Emitter<ILanguageRuntimeMessageStream>;
	let error: Emitter<ILanguageRuntimeMessageError>;
	let state: Emitter<ILanguageRuntimeMessageState>;
	let interruptCount: number;
	let session: ILanguageRuntimeSession;

	beforeEach(() => {
		output = disposables.add(new Emitter());
		result = disposables.add(new Emitter());
		stream = disposables.add(new Emitter());
		error = disposables.add(new Emitter());
		state = disposables.add(new Emitter());
		interruptCount = 0;
		session = stubInterface<ILanguageRuntimeSession>({
			onDidReceiveRuntimeMessageOutput: output.event,
			onDidReceiveRuntimeMessageResult: result.event,
			onDidReceiveRuntimeMessageStream: stream.event,
			onDidReceiveRuntimeMessageError: error.event,
			onDidReceiveRuntimeMessageState: state.event,
			interrupt: () => { interruptCount++; },
		});
	});

	function observe(token: CancellationToken = CancellationToken.None): PositronExecuteCodeObserver {
		return disposables.add(new PositronExecuteCodeObserver(session, EXECUTION_ID, token));
	}

	it('resolves the execute result and captures streamed output', async () => {
		const observer = observe();
		stream.fire(stubInterface<ILanguageRuntimeMessageStream>({ parent_id: EXECUTION_ID, name: 'stdout', text: 'hello ' }));
		result.fire(stubInterface<ILanguageRuntimeMessageResult>({ parent_id: EXECUTION_ID, data: { 'text/plain': '42' } }));

		expect(await observer.waitForResult()).toEqual({ result: '42', outputText: 'hello ' });
	});

	it('captures output messages and settles on idle when there is no result', async () => {
		const observer = observe();
		output.fire(stubInterface<ILanguageRuntimeMessageOutput>({ parent_id: EXECUTION_ID, data: { 'text/plain': 'printed' } }));
		state.fire(stubInterface<ILanguageRuntimeMessageState>({ parent_id: EXECUTION_ID, state: RuntimeOnlineState.Idle }));

		expect(await observer.waitForResult()).toEqual({ outputText: 'printed' });
	});

	it('captures stderr and reports a serializable error', async () => {
		const observer = observe();
		stream.fire(stubInterface<ILanguageRuntimeMessageStream>({ parent_id: EXECUTION_ID, name: 'stderr', text: 'oops' }));
		error.fire(stubInterface<ILanguageRuntimeMessageError>({ parent_id: EXECUTION_ID, name: 'ValueError', message: 'bad', traceback: ['line 1', 'line 2'] }));

		expect(await observer.waitForResult()).toEqual({
			error: { name: 'ValueError', message: 'bad', stack: 'line 1\nline 2' },
			outputError: 'oops',
		});
	});

	it('ignores messages belonging to other executions', async () => {
		const observer = observe();
		output.fire(stubInterface<ILanguageRuntimeMessageOutput>({ parent_id: 'other-execution', data: { 'text/plain': 'not mine' } }));
		state.fire(stubInterface<ILanguageRuntimeMessageState>({ parent_id: EXECUTION_ID, state: RuntimeOnlineState.Idle }));

		expect(await observer.waitForResult()).toEqual({});
	});

	it('interrupts the session when cancelled while running', async () => {
		const cts = disposables.add(new CancellationTokenSource());
		const observer = observe(cts.token);

		state.fire(stubInterface<ILanguageRuntimeMessageState>({ parent_id: EXECUTION_ID, state: RuntimeOnlineState.Busy }));
		cts.cancel();

		expect(interruptCount).toBe(1);

		// Settle so the observer's promise resolves.
		state.fire(stubInterface<ILanguageRuntimeMessageState>({ parent_id: EXECUTION_ID, state: RuntimeOnlineState.Idle }));
		await observer.waitForResult();
	});

	it('does not interrupt when cancelled before execution starts', () => {
		const cts = disposables.add(new CancellationTokenSource());
		observe(cts.token);

		cts.cancel();

		expect(interruptCount).toBe(0);
	});
});
