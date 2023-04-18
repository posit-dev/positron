/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import { ILanguageRuntimeMessageCommOpen } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { Event, EventEmitter } from 'vscode';

export class ExtHostRuntimeClientInstance implements positron.RuntimeClientInstance {
	private readonly _onDidChangeClientState = new EventEmitter<positron.RuntimeClientState>();

	constructor(readonly message: ILanguageRuntimeMessageCommOpen) {
		this.onDidChangeClientState = this._onDidChangeClientState.event;
	}

	onDidChangeClientState: Event<positron.RuntimeClientState>;

	getClientState(): positron.RuntimeClientState {
		throw new Error('Method not implemented.');
	}
	getClientId(): string {
		throw new Error('Method not implemented.');
	}
	getClientType(): positron.RuntimeClientType {
		throw new Error('Method not implemented.');
	}
	dispose() {
		throw new Error('Method not implemented.');
	}
}
