/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';
import { JupyterKernelSpec, JupyterLanguageRuntimeSession } from './jupyter-adapter';
import { DefaultApi, HttpError, InterruptMode, NewSession } from './kcclient/api';
import { WebSocket } from 'ws';
import { JupyterMessage } from './jupyter/JupyterMessage';
import { JupyterRequest } from './jupyter/JupyterRequest';
import { KernelInfoRequest } from './jupyter/KernelInfoRequest';
import { Barrier } from './async';
import { ExecuteRequest, JupyterExecuteRequest, JupyterExecuteResult } from './jupyter/ExecuteRequest';
import { IsCompleteRequest, JupyterIsCompleteRequest } from './jupyter/IsCompleteRequest';
import { JupyterDisplayData } from './jupyter/JupyterDisplayData';
import { JupyterExecuteInput } from './jupyter/JupyterExecuteInput';
import { JupyterKernelStatus } from './jupyter/JupyterKernelStatus';
import { CommInfoRequest } from './jupyter/CommInfoRequest';
import { JupyterCommOpen } from './jupyter/JupyterCommOpen';
import { CommOpenCommand } from './jupyter/CommOpenCommand';
import { JupyterCommand } from './jupyter/JupyterCommand';
import { CommCloseCommand } from './jupyter/CommCloseCommand';

export class KallichoreSession implements JupyterLanguageRuntimeSession {
	private readonly _messages: vscode.EventEmitter<positron.LanguageRuntimeMessage>;
	private readonly _state: vscode.EventEmitter<positron.RuntimeState>;
	private readonly _exit: vscode.EventEmitter<positron.LanguageRuntimeExit>;
	private readonly _created: Barrier = new Barrier();
	private readonly _connected: Barrier = new Barrier();
	private _ws: WebSocket | undefined;
	private _runtimeState: positron.RuntimeState = positron.RuntimeState.Uninitialized;
	private _pendingRequests: Map<string, JupyterRequest<any, any>> = new Map();
	private _disposables: vscode.Disposable[] = [];

	constructor(readonly metadata: positron.RuntimeSessionMetadata,
		readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
		readonly dynState: positron.LanguageRuntimeDynState,
		private readonly _log: vscode.LogOutputChannel,
		private readonly _api: DefaultApi,
		private _new: boolean
	) {
		// Create emitter for LanguageRuntime messages and state changes
		this._messages = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();
		this._state = new vscode.EventEmitter<positron.RuntimeState>();
		this._exit = new vscode.EventEmitter<positron.LanguageRuntimeExit>();
		this.onDidReceiveRuntimeMessage = this._messages.event;
		this.onDidChangeRuntimeState = this._state.event;
		this.onDidEndSession = this._exit.event;

		// If this is an existing session, release the create barrier
		if (!this._new) {
			this._created.open();
		}
	}

	/**
	 * Create the session in on the Kallichore server.
	 *
	 * @param kernelSpec The Jupyter kernel spec to use for the session
	 */
	public async create(kernelSpec: JupyterKernelSpec) {
		if (!this._new) {
			throw new Error(`Session ${this.metadata.sessionId} already exists`);
		}

		// Forward the environment variables from the kernel spec
		const env = {};
		if (kernelSpec.env) {
			Object.assign(env, kernelSpec.env);
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
		const session: NewSession = {
			argv: kernelSpec.argv,
			sessionId: this.metadata.sessionId,
			language: kernelSpec.language,
			displayName: this.metadata.sessionName,
			env,
			workingDirectory: workingDir,
			username: '',
			interruptMode: InterruptMode.Message
		};
		await this._api.newSession(session);
		this._log.info(`Kallichore session created: ${JSON.stringify(session)}`);
		this._created.open();
	}

	/**
	 * Requests that the kernel start a Language Server Protocol server, and
	 * connect it to the client with the given TCP address.
	 *
	 * Note: This is only useful if the kernel hasn't already started an LSP
	 * server.
	 *
	 * @param clientAddress The client's TCP address, e.g. '127.0.0.1:1234'
	 */
	async startPositronLsp(clientAddress: string) {
		// Create a unique client ID for this instance
		const uniqueId = Math.floor(Math.random() * 0x100000000).toString(16);
		const clientId = `positron-lsp-${this.runtimeMetadata.languageId}-${uniqueId}`;
		this.logInfo(`Starting LSP server ${clientId} for ${clientAddress}`);

		// Notify Positron that we're handling messages from this client
		this._disposables.push(positron.runtime.registerClientInstance(clientId));

		await this.createClient(
			clientId,
			positron.RuntimeClientType.Lsp,
			{ client_address: clientAddress }
		);
	}

	/**
	 * Requests that the kernel start a Debug Adapter Protocol server, and
	 * connect it to the client locally on the given TCP port.
	 *
	 * @param serverPort The port on which to bind locally.
	 * @param debugType Passed as `vscode.DebugConfiguration.type`.
	 * @param debugName Passed as `vscode.DebugConfiguration.name`.
	 */
	async startPositronDap(
		serverPort: number,
		_debugType: string,
		_debugName: string,
	) {
		// NOTE: Ideally we'd connect to any address but the
		// `debugServer` property passed in the configuration below
		// needs to be a port for localhost.
		const serverAddress = `127.0.0.1:${serverPort}`;

		// TODO: Should we query the kernel to see if it can create a DAP
		// (QueryInterface style) instead of just demanding it?
		//
		// The Jupyter kernel spec does not provide a way to query for
		// supported comms; the only way to know is to try to create one.

		// Create a unique client ID for this instance
		const uniqueId = Math.floor(Math.random() * 0x100000000).toString(16);
		const clientId = `positron-dap-${this.runtimeMetadata.languageId}-${uniqueId}`;
		this.logInfo(`Starting DAP server ${clientId} for ${serverAddress}`);

		// Notify Positron that we're handling messages from this client
		this._disposables.push(positron.runtime.registerClientInstance(clientId));

		await this.createClient(
			clientId,
			positron.RuntimeClientType.Dap,
			{ client_address: serverAddress }
		);

		// TODO: Handle events from the DAP (see LanguageRuntimeSessionAdapter)
	}

	emitJupyterLog(message: string): void {
		this._log.info(message);
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

	execute(code: string,
		id: string,
		mode: positron.RuntimeCodeExecutionMode,
		errorBehavior: positron.RuntimeErrorBehavior): void {

		const request: JupyterExecuteRequest = {
			code,
			silent: mode === positron.RuntimeCodeExecutionMode.Silent,
			store_history: mode === positron.RuntimeCodeExecutionMode.Interactive,
			user_expressions: new Map(),
			allow_stdin: true,
			stop_on_error: errorBehavior === positron.RuntimeErrorBehavior.Stop,
		};
		const execute = new ExecuteRequest(id, request);
		this.sendRequest(execute).then((reply) => {
			this.logDebug(`Execution result: ${JSON.stringify(reply)}`);
		});
	}

	async isCodeFragmentComplete(code: string): Promise<positron.RuntimeCodeFragmentStatus> {
		const request: JupyterIsCompleteRequest = {
			code
		};
		const isComplete = new IsCompleteRequest(request);
		const reply = await this.sendRequest(isComplete);
		switch (reply.status) {
			case 'complete':
				return positron.RuntimeCodeFragmentStatus.Complete;
			case 'incomplete':
				return positron.RuntimeCodeFragmentStatus.Incomplete;
			case 'invalid':
				return positron.RuntimeCodeFragmentStatus.Invalid;
			case 'unknown':
				return positron.RuntimeCodeFragmentStatus.Unknown;
		}
	}

	async createClient(id: string, type: positron.RuntimeClientType, params: any, _metadata?: any): Promise<void> {

		// TODO: handle metadata

		// Ensure the type of client we're being asked to create is a known type that supports
		// client-initiated creation
		if (type === positron.RuntimeClientType.Variables ||
			type === positron.RuntimeClientType.Lsp ||
			type === positron.RuntimeClientType.Dap ||
			type === positron.RuntimeClientType.Ui ||
			type === positron.RuntimeClientType.Help ||
			type === positron.RuntimeClientType.IPyWidgetControl) {

			const msg: JupyterCommOpen = {
				target_name: type,  // eslint-disable-line
				comm_id: id,  // eslint-disable-line
				data: params
			};
			const commOpen = new CommOpenCommand(msg);
			await this.sendCommand(commOpen);
		} else {
			this.logError(`Can't create ${type} client for ${this.runtimeMetadata.languageName} (not supported)`);
		}
	}

	async listClients(type?: positron.RuntimeClientType): Promise<Record<string, string>> {
		const request = new CommInfoRequest(type || '');
		const reply = await this.sendRequest(request);
		const result: Record<string, string> = {};
		const comms = reply.comms;
		// Unwrap the comm info and add it to the result
		for (const key in comms) {
			if (comms.hasOwnProperty(key)) {
				result[key] = comms[key].target_name;
			}
		}
		return result;
	}

	removeClient(id: string): void {
		const commOpen = new CommCloseCommand(id);
		this.sendCommand(commOpen);
	}

	sendClientMessage(_client_id: string, _message_id: string, _message: any): void {
		throw new Error('Method not implemented.');
	}
	replyToPrompt(_id: string, _reply: string): void {
		throw new Error('Method not implemented.');
	}

	async start(): Promise<positron.LanguageRuntimeInfo> {
		// If it's a new session, wait for it to be created before connecting
		if (this._new) {

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
		}

		// Connect to the session's websocket
		await this.connect();

		// If it's not a new session, enter the ready state immediately
		// TODO: this should actually wait for the kernel to be ready
		if (!this._new) {
			this._state.fire(positron.RuntimeState.Ready);
		}

		return this.getKernelInfo();
	}

	connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			// Connect to the session's websocket
			const uri = vscode.Uri.parse(this._api.basePath);
			this._ws = new WebSocket(`ws://${uri.authority}/sessions/${this.metadata.sessionId}/channels`);
			this._ws.onopen = () => {
				this.logInfo(`Connected to websocket.`);
				// Open the connected barrier so that we can start sending messages
				this._connected.open();
				resolve();
			};
			this._ws.onerror = (err: any) => {
				this.logInfo(`Error connecting to socket: ${err}`);
				reject(err);

				// TODO: Needs to take kernel down if this happens due to the
				// connection getting closed from the server
			};
			this._ws.onmessage = (msg: any) => {
				this.logDebug(`RECV message: ${msg.data}`);
				try {
					const data = JSON.parse(msg.data.toString());
					this.handleMessage(data);
				} catch (err) {
					this.logError(`Could not parse message: ${err}`);
				}
			};
		});
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
		this._disposables.forEach(d => d.dispose());

		// Close the websocket if it's open
		this._ws?.close();
	}

	handleMessage(data: any) {
		if (!data.kind) {
			this.logError(`Kallichore session ${this.metadata.sessionId} message has no kind: ${data}`);
			return;
		}
		switch (data.kind) {
			case 'kernel':
				this.handleKernelMessage(data);
				break;
			case 'jupyter':
				this.handleJupyterMessage(data);
				break;
		}
	}

	handleKernelMessage(data: any) {
		if (data.status) {
			// Check to see if the status is a valid runtime state
			if (Object.values(positron.RuntimeState).includes(data.status)) {
				this.logInfo(`State: ${this._runtimeState} => ${data.status}`);
				this._runtimeState = data.status;
				this._state.fire(data.status);
			} else {
				this.logError(`Unknown state: ${data.status}`);
			}
		}
	}

	async getKernelInfo(): Promise<positron.LanguageRuntimeInfo> {
		const request = new KernelInfoRequest();
		const reply = await this.sendRequest(request);
		const info: positron.LanguageRuntimeInfo = {
			banner: reply.banner,
			implementation_version: reply.implementation_version,
			language_version: reply.language_info.version,
		};
		return info;
	}

	handleJupyterMessage(data: any) {
		const msg = data as JupyterMessage;

		// Check to see if the message is a reply to a request
		if (msg.parent_header && msg.parent_header.msg_id) {
			const request = this._pendingRequests.get(msg.parent_header.msg_id);
			if (request) {
				if (request.replyType === msg.header.msg_type) {
					request.resolve(msg.content);
					this._pendingRequests.delete(msg.parent_header.msg_id);
				}
			}
		}

		switch (msg.header.msg_type) {
			case 'execute_result':
				this.onExecuteResult(msg, msg.content as JupyterExecuteResult);
				break;
			case 'execute_input':
				this.onExecuteInput(msg, msg.content as JupyterExecuteInput);
				break;
			case 'status':
				this.onKernelStatus(msg, msg.content as JupyterKernelStatus);
				break;
			case 'display_data':
				this.onDisplayData(msg, msg.content as JupyterDisplayData);
				break;
		}
	}

	async sendRequest<T>(request: JupyterRequest<any, T>): Promise<T> {
		await this._connected.wait();
		this._pendingRequests.set(request.msgId, request);
		return request.sendRpc(this.metadata.sessionId, this._ws!);
	}

	async sendCommand<T>(command: JupyterCommand<T>) {
		await this._connected.wait();
		return command.sendCommand(this.metadata.sessionId, this._ws!);
	}

	/**
	 * Converts a Jupyter execute_result message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The execute_result message
	 */
	onExecuteResult(message: JupyterMessage, data: JupyterExecuteResult) {
		this._messages.fire({
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.Result,
			data: data.data as any,
			metadata: message.metadata,
		} as positron.LanguageRuntimeResult);
	}

	/**
	 * Converts a Jupyter display_data message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The display_data message
	 */
	onDisplayData(message: JupyterMessage, data: JupyterDisplayData) {
		this._messages.fire({
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.Output,
			data: data.data as any,
			metadata: message.metadata,
		} as positron.LanguageRuntimeOutput);
	}

	/**
	 * Converts a Jupyter execute_input message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The execute_input message
	 */
	onExecuteInput(message: JupyterMessage, data: JupyterExecuteInput) {
		this._messages.fire({
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.Input,
			code: data.code,
			execution_count: data.execution_count,
			metadata: message.metadata,
		} as positron.LanguageRuntimeInput);
	}

	/**
	 * Converts a Jupyter status message to a LanguageRuntimeMessage and emits
	 * it.
	 *
	 * @param message The message packet
	 * @param data The kernel status message
	 */
	onKernelStatus(message: JupyterMessage, data: JupyterKernelStatus) {
		this._messages.fire({
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.State,
			state: data.execution_state,
			metadata: message.metadata,
		} as positron.LanguageRuntimeState);
	}

	logDebug(what: string) {
		this._log.debug(`${this.logPrefix()} ${what}`);
	}

	logInfo(what: string) {
		this._log.info(`${this.logPrefix()} ${what}`);
	}

	logError(err: string) {
		this._log.error(`${this.logPrefix()} ${err}`);
	}

	logPrefix(): string {
		return `[${this.metadata.sessionId}]`;
	}
}
