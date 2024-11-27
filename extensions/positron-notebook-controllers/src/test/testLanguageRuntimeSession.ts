/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as positron from 'positron';
import * as vscode from 'vscode';

export class TestLanguageRuntimeSession implements Partial<positron.LanguageRuntimeSession> {
	private _state = positron.RuntimeState.Uninitialized;
	private _lastExecutionId?: string;
	private readonly _onDidReceiveRuntimeMessage = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();
	private readonly _onDidExecute = new vscode.EventEmitter<string>();

	public readonly onDidReceiveRuntimeMessage = this._onDidReceiveRuntimeMessage.event;
	public readonly onDidExecute = this._onDidExecute.event;

	public readonly metadata = {
		sessionId: 'test-session',
	} as positron.RuntimeSessionMetadata;

	get state(): positron.RuntimeState {
		return this._state;
	}

	execute(_code: string, id: string, _mode: positron.RuntimeCodeExecutionMode, _errorBehavior: positron.RuntimeErrorBehavior) {
		this._lastExecutionId = id;
		this._onDidExecute.fire(id);
	}

	async interrupt(): Promise<void> {
		if (this._lastExecutionId) {
			this.fireErrorMessage(this._lastExecutionId);
		}
	}

	dispose() {
		this._onDidReceiveRuntimeMessage.dispose();
	}

	// Test helpers

	public setRuntimeState(state: positron.RuntimeState) {
		this._state = state;
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
