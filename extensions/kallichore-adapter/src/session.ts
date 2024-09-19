/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { JupyterLanguageRuntimeSession } from './jupyter-adapter';
import { DefaultApi, InterruptMode, Session } from './kcclient/api';

export class KallichoreSession implements JupyterLanguageRuntimeSession {
	private readonly _messages: vscode.EventEmitter<positron.LanguageRuntimeMessage>;
	private readonly _state: vscode.EventEmitter<positron.RuntimeState>;
	private readonly _exit: vscode.EventEmitter<positron.LanguageRuntimeExit>;

	constructor(readonly metadata: positron.RuntimeSessionMetadata,
		readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
		readonly dynState: positron.LanguageRuntimeDynState,
		private readonly _log: vscode.LogOutputChannel,
		private readonly _api: DefaultApi,
	) {
		// Create emitter for LanguageRuntime messages and state changes
		this._messages = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();
		this._state = new vscode.EventEmitter<positron.RuntimeState>();
		this._exit = new vscode.EventEmitter<positron.LanguageRuntimeExit>();
		this.onDidReceiveRuntimeMessage = this._messages.event;
		this.onDidChangeRuntimeState = this._state.event;
		this.onDidEndSession = this._exit.event;

		// Create the session in the underlying API
		const session: Session = {
			argv: [runtimeMetadata.runtimePath],
			sessionId: metadata.sessionId,
			env: {},
			workingDirectory: '',
			username: '',
			interruptMode: InterruptMode.Message
		};
		this._api.newSession(session).then(() => {
			this._log.info(`Kallichore session created: ${JSON.stringify(session)}`);
		});
	}
	startPositronLsp(_clientAddress: string): Thenable<void> {
		throw new Error('Method not implemented.');
	}
	startPositronDap(_serverPort: number, _debugType: string, _debugName: string): Thenable<void> {
		throw new Error('Method not implemented.');
	}
	emitJupyterLog(_message: string): void {
		throw new Error('Method not implemented.');
	}
	showOutput(): void {
		throw new Error('Method not implemented.');
	}
	callMethod(_method: string, ..._args: Array<any>): Promise<any> {
		throw new Error('Method not implemented.');
	}
	getKernelLogFile(): string {
		throw new Error('Method not implemented.');
	}
	onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>;
	onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>;
	onDidEndSession: vscode.Event<positron.LanguageRuntimeExit>;
	openResource?(_resource: vscode.Uri | string): Thenable<boolean> {
		throw new Error('Method not implemented.');
	}
	execute(_code: string, _id: string, _mode: positron.RuntimeCodeExecutionMode, _errorBehavior: positron.RuntimeErrorBehavior): void {
		throw new Error('Method not implemented.');
	}
	isCodeFragmentComplete(_code: string): Thenable<positron.RuntimeCodeFragmentStatus> {
		throw new Error('Method not implemented.');
	}
	createClient(_id: string, _type: positron.RuntimeClientType, _params: any, _metadata?: any): Thenable<void> {
		throw new Error('Method not implemented.');
	}
	listClients(_type?: positron.RuntimeClientType): Thenable<Record<string, string>> {
		throw new Error('Method not implemented.');
	}
	removeClient(_id: string): void {
		throw new Error('Method not implemented.');
	}
	sendClientMessage(_client_id: string, _message_id: string, _message: any): void {
		throw new Error('Method not implemented.');
	}
	replyToPrompt(_id: string, _reply: string): void {
		throw new Error('Method not implemented.');
	}
	start(): Thenable<positron.LanguageRuntimeInfo> {
		throw new Error('Method not implemented.');
	}
	interrupt(): Thenable<void> {
		throw new Error('Method not implemented.');
	}
	restart(): Thenable<void> {
		throw new Error('Method not implemented.');
	}
	shutdown(_exitReason: positron.RuntimeExitReason): Thenable<void> {
		throw new Error('Method not implemented.');
	}
	forceQuit(): Thenable<void> {
		throw new Error('Method not implemented.');
	}
	showProfile?(): Thenable<void> {
		throw new Error('Method not implemented.');
	}
	dispose() {
		throw new Error('Method not implemented.');
	}
}
