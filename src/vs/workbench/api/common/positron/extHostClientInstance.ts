/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { ILanguageRuntimeMessageCommData, ILanguageRuntimeMessageCommOpen } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { Event, EventEmitter } from 'vscode';

export class ExtHostRuntimeClientInstance implements positron.RuntimeClientInstance {
	private readonly _onDidChangeClientState = new EventEmitter<positron.RuntimeClientState>();
	private readonly _onDidEmitData = new EventEmitter<object>();
	private _state: positron.RuntimeClientState;

	constructor(readonly message: ILanguageRuntimeMessageCommOpen) {
		this.onDidChangeClientState = this._onDidChangeClientState.event;
		this.onDidEmitEvent = this._onDidEmitData.event;
		this._state = positron.RuntimeClientState.Connected;
		this.onDidChangeClientState((e) => {
			this._state = e;
		});
	}

	emitMessage(message: ILanguageRuntimeMessageCommData): void {
		this._onDidEmitData.fire(message.data);
	}

	onDidChangeClientState: Event<positron.RuntimeClientState>;

	onDidEmitEvent: Event<object>;

	getClientState(): positron.RuntimeClientState {
		return this._state;
	}

	getClientId(): string {
		return this.message.comm_id;
	}

	getClientType(): positron.RuntimeClientType {
		throw new Error('Method not implemented.');
	}

	dispose() {
		throw new Error('Method not implemented.');
	}
}
