/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ILanguageRuntimeMessageError, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageResult, ILanguageRuntimeMessageState, ILanguageRuntimeMessageStream, RuntimeOnlineState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';

/**
 * Assembled result of an execute-code tool invocation, serialized and returned
 * to the model.
 */
export interface IExecuteCodeResult {
	/** The `text/plain` representation of the execution result, if any. */
	result?: string;
	/** A serializable error, if the execution failed. */
	error?: { message: string; name: string; stack?: string };
	/** Accumulated plain-text output and standard output. */
	outputText?: string;
	/** Accumulated standard error output. */
	outputError?: string;
}

/**
 * Observes a single code execution in a runtime session, accumulating its
 * output and resolving with the execution result.
 *
 * This is the main-thread counterpart of the execution observer the Positron
 * API exposes to extensions: it subscribes directly to the session's runtime
 * message stream and correlates messages by their parent execution id.
 */
export class PositronExecuteCodeObserver extends Disposable {

	private _outputText = '';
	private _outputError = '';
	private _state: 'pending' | 'running' | 'completed' = 'pending';
	private readonly _result = new DeferredPromise<Record<string, unknown>>();

	constructor(
		private readonly _session: ILanguageRuntimeSession,
		executionId: string,
		token: CancellationToken,
	) {
		super();

		// Only handle messages that belong to this execution.
		const forThisExecution = <T extends { parent_id: string }>(handler: (message: T) => void) =>
			(message: T) => {
				if (message.parent_id === executionId) {
					handler(message);
				}
			};

		this._register(this._session.onDidReceiveRuntimeMessageOutput(forThisExecution((message: ILanguageRuntimeMessageOutput) => this._onOutput(message))));
		this._register(this._session.onDidReceiveRuntimeMessageResult(forThisExecution((message: ILanguageRuntimeMessageResult) => this._onResult(message))));
		this._register(this._session.onDidReceiveRuntimeMessageStream(forThisExecution((message: ILanguageRuntimeMessageStream) => this._onStream(message))));
		this._register(this._session.onDidReceiveRuntimeMessageError(forThisExecution((message: ILanguageRuntimeMessageError) => this._onError(message))));
		this._register(this._session.onDidReceiveRuntimeMessageState(forThisExecution((message: ILanguageRuntimeMessageState) => this._onState(message))));

		this._register(token.onCancellationRequested(() => {
			// Only a running execution can be interrupted; a pending one has not
			// started yet.
			if (this._state === 'running') {
				this._session.interrupt();
			}
		}));
	}

	/**
	 * Wait for the execution to complete and return the assembled result.
	 */
	async waitForResult(): Promise<IExecuteCodeResult> {
		const assembled: IExecuteCodeResult = {};
		try {
			const data = await this._result.p;
			const output = data['text/plain'];
			if (typeof output === 'string' && output.length > 0) {
				assembled.result = output;
			}
		} catch (error) {
			assembled.error = error as IExecuteCodeResult['error'];
		}
		if (this._outputText) {
			assembled.outputText = this._outputText;
		}
		if (this._outputError) {
			assembled.outputError = this._outputError;
		}
		return assembled;
	}

	private _onOutput(message: ILanguageRuntimeMessageOutput): void {
		const text = message.data['text/plain'];
		if (typeof text === 'string') {
			this._outputText += text;
		}
	}

	private _onStream(message: ILanguageRuntimeMessageStream): void {
		if (message.name === 'stdout') {
			this._outputText += message.text;
		} else if (message.name === 'stderr') {
			this._outputError += message.text;
		}
	}

	private _onState(message: ILanguageRuntimeMessageState): void {
		if (message.state === RuntimeOnlineState.Busy) {
			this._state = 'running';
		} else if (message.state === RuntimeOnlineState.Idle) {
			this._state = 'completed';
			// The runtime went idle without emitting a result; settle with an
			// empty result so the caller isn't left waiting.
			if (!this._result.isSettled) {
				this._result.complete({});
			}
		}
	}

	private _onResult(message: ILanguageRuntimeMessageResult): void {
		this._state = 'completed';
		if (!this._result.isSettled) {
			this._result.complete(message.data);
		}
	}

	private _onError(message: ILanguageRuntimeMessageError): void {
		this._state = 'completed';
		if (!this._result.isSettled) {
			// Reject with a plain object (rather than an Error) so the fields
			// survive JSON serialization back to the model.
			this._result.error({
				message: message.message,
				name: message.name,
				stack: message.traceback?.join('\n'),
			});
		}
	}
}
