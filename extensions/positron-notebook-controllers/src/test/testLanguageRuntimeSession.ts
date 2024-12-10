/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as positron from 'positron';
import * as vscode from 'vscode';

export class TestLanguageRuntimeSession implements Partial<positron.LanguageRuntimeSession> {
	private _lastExecutionId?: string;
	private readonly _onDidChangeRuntimeState = new vscode.EventEmitter<positron.RuntimeState>();
	private readonly _onDidReceiveRuntimeMessage = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();
	private readonly _onDidExecute = new vscode.EventEmitter<string>();
	private readonly _onDidEndSession = new vscode.EventEmitter<positron.LanguageRuntimeExit>();

	public readonly onDidChangeRuntimeState = this._onDidChangeRuntimeState.event;
	public readonly onDidReceiveRuntimeMessage = this._onDidReceiveRuntimeMessage.event;
	public readonly onDidExecute = this._onDidExecute.event;
	public readonly onDidEndSession = this._onDidEndSession.event;

	public readonly metadata = {
		sessionId: 'test-session',
	} as positron.RuntimeSessionMetadata;

	public readonly runtimeMetadata = {
		runtimeId: 'test-runtime-10349',
		runtimeName: 'Test Runtime',
		runtimePath: '/path/to/runtime',
		languageId: 'test-language',
	} as positron.LanguageRuntimeMetadata;

	constructor() { }

	execute(_code: string, id: string, _mode: positron.RuntimeCodeExecutionMode, _errorBehavior: positron.RuntimeErrorBehavior) {
		this._lastExecutionId = id;
		this._onDidExecute.fire(id);
	}

	async interrupt(): Promise<void> {
		if (this._lastExecutionId) {
			this.fireErrorMessage(this._lastExecutionId);
		}
	}

	async shutdown(exitReason: positron.RuntimeExitReason): Promise<void> {
		// Complete the shutdown on the next tick, trying to match real runtime behavior.
		setTimeout(() => {
			this._onDidEndSession.fire({
				runtime_name: this.runtimeMetadata.runtimeName,
				exit_code: 0,
				reason: exitReason,
				message: '',
			});
		}, 0);
	}

	dispose() {
		this._onDidReceiveRuntimeMessage.dispose();
	}

	// Test helpers

	public setRuntimeState(state: positron.RuntimeState) {
		this._onDidChangeRuntimeState.fire(state);
	}

	public fireErrorMessage(parent_id: string) {
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			type: positron.LanguageRuntimeMessageType.Error,
			parent_id,
			when: new Date().toISOString(),
			message: 'An error occurred.',
			name: 'Error',
			traceback: ['Traceback line 1', 'Traceback line 2'],
		} as positron.LanguageRuntimeError);
	}

	public fireIdleMessage(parent_id: string) {
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			type: positron.LanguageRuntimeMessageType.State,
			parent_id,
			when: new Date().toISOString(),
			state: positron.RuntimeOnlineState.Idle,
		} as positron.LanguageRuntimeState);
	}
}
