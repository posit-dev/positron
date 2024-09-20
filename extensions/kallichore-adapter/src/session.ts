/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';
import { JupyterKernelSpec, JupyterLanguageRuntimeSession } from './jupyter-adapter';
import { DefaultApi, HttpError, InterruptMode, Session } from './kcclient/api';
import { Barrier } from './barrier';
import { WebSocket } from 'ws';

export class KallichoreSession implements JupyterLanguageRuntimeSession {
	private readonly _messages: vscode.EventEmitter<positron.LanguageRuntimeMessage>;
	private readonly _state: vscode.EventEmitter<positron.RuntimeState>;
	private readonly _exit: vscode.EventEmitter<positron.LanguageRuntimeExit>;
	private readonly _created: Barrier = new Barrier();
	private readonly _connected: Barrier = new Barrier();
	private _ws: WebSocket | undefined;

	constructor(readonly metadata: positron.RuntimeSessionMetadata,
		readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
		readonly dynState: positron.LanguageRuntimeDynState,
		readonly kernelSpec: JupyterKernelSpec,
		private readonly _context: vscode.ExtensionContext,
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

		// Forward the environment variables from the kernel spec
		const env = {};
		if (this.kernelSpec.env) {
			Object.assign(env, this.kernelSpec.env);
		}

		// Prepare the working directory; use the workspace root if available,
		// otherwise the home directory
		let workingDir = vscode.workspace.workspaceFolders?.[0].uri.fsPath || os.homedir();

		// If we have a notebook URI, use its directory as the working directory
		// instead
		if (this.metadata.notebookUri?.fsPath) {
			workingDir = this.metadata.notebookUri.fsPath;
		}

		// Create the session in the underlying API
		const session: Session = {
			argv: this.kernelSpec.argv,
			sessionId: metadata.sessionId,
			env,
			workingDirectory: workingDir,
			username: '',
			interruptMode: InterruptMode.Message
		};
		this._api.newSession(session).then(() => {
			this._log.info(`Kallichore session created: ${JSON.stringify(session)}`);
			this._created.open();
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
	async start(): Promise<positron.LanguageRuntimeInfo> {
		// Wait for the session to be created
		await this._created.wait();

		// Wait for the session to start
		try {
			await this._api.startSession(this.metadata.sessionId);
		} catch (err) {
			if (err instanceof HttpError) {
				throw new Error(err.body.message);
			} else {
				// Rethrow the error as-is if it's not an HTTP error
				throw err;
			}
		}

		// Connect to the session's websocket
		const uri = vscode.Uri.parse(this._api.basePath);
		this._ws = new WebSocket(`ws://${uri.authority}/sessions/${this.metadata.sessionId}/channels`);
		this._ws.onopen = () => {
			this._log.info(`Kallichore session ${this.metadata.sessionId} connected`);
			this._connected.open();
		};
		this._ws.onerror = (err) => {
			this._log.error(`Kallichore session ${this.metadata.sessionId} error: ${err}`);
		};
		this._ws.onmessage = (msg) => {
			this._log.debug(`Kallichore session ${this.metadata.sessionId} message: ${msg.data}`);
		};

		const info: positron.LanguageRuntimeInfo = {
			banner: 'Kallichore session',
			implementation_version: '1.0',
			language_version: this.runtimeMetadata.runtimeVersion,
		};
		return info;
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
