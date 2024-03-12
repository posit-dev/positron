/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { randomUUID } from 'crypto';

import path = require('path');
import fs = require('fs');
import { JavaScriptVariables } from './variables';

/**
 * A Positron language runtime for JavaScript.
 */
export class JavaScriptLanguageRuntimeSession implements positron.LanguageRuntimeSession {

	private readonly _onDidReceiveRuntimeMessage = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();

	private readonly _onDidChangeRuntimeState = new vscode.EventEmitter<positron.RuntimeState>();

	private readonly _onDidEndSession = new vscode.EventEmitter<positron.LanguageRuntimeExit>();

	private _env?: JavaScriptVariables;

	/**
	 * A stack of pending RPCs.
	 */
	private readonly _pendingRpcs: Array<string> = [];

	constructor(readonly runtimeMetadata: positron.LanguageRuntimeMetadata,
		readonly metadata: positron.RuntimeSessionMetadata,
		readonly context: vscode.ExtensionContext) {

		this.dynState = {
			inputPrompt: `>`,
			continuationPrompt: '…',
		};
	}

	public dynState: positron.LanguageRuntimeDynState;

	readonly onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>
		= this._onDidReceiveRuntimeMessage.event;

	readonly onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>
		= this._onDidChangeRuntimeState.event;

	readonly onDidEndSession: vscode.Event<positron.LanguageRuntimeExit>
		= this._onDidEndSession.event;

	execute(code: string, id: string, mode: positron.RuntimeCodeExecutionMode, errorBehavior: positron.RuntimeErrorBehavior): void {
		// Echo the input code
		this.emitInput(id, code);

		// Become busy
		this.enterBusyState(id);

		try {
			// Typescript understandably isn't happy with eval.
			const result = eval?.(code); // eslint-disable-line no-eval

			if (result === undefined) {
				// Handle undefined results
				this.emitOutput(id, '<undefined>');
			} else if (result === null) {
				// Handle null results
				this.emitOutput(id, '<null>');
			} else {
				// Convert all other results to strings and emit them
				this.emitOutput(id, result.toString());
			}

		} catch (err) {
			if (err instanceof Error) {
				// If this is a Node.js error, emit the error details.
				const error = err as Error;
				this.emitError(id, error.name, error.message, error.stack?.split('\n') ?? []);
			} else {
				// If this error isn't a Node.js error, just do our best to
				// convert it to a string.
				this.emitError(id, 'Error', (err as any).toString(), []);
			}
		}

		// Scan to see if there are any environment changes caused by
		// executing this code.
		if (this._env) {
			this._env.scanForChanges();
		}

		// Return to the idle state
		this.enterIdleState(id);
	}

	isCodeFragmentComplete(code: string): Thenable<positron.RuntimeCodeFragmentStatus> {
		// Treat all code as complete; without the aid of third-party libraries, it's difficult to
		// test code for completeness in JavaScript without actually executing it.
		return Promise.resolve(positron.RuntimeCodeFragmentStatus.Complete);
	}

	createClient(id: string, type: positron.RuntimeClientType, params: any): Thenable<void> {
		if (type === positron.RuntimeClientType.Variables) {
			// The only client type we support right now is an environment.
			this._env = new JavaScriptVariables(id);
			this.connectClientEmitter(this._env);
		} else {
			throw new Error(`Unknown client type ${type}`);
		}
		return Promise.resolve();
	}

	listClients(type?: positron.RuntimeClientType | undefined): Thenable<Record<string, string>> {
		// The environment is the only client type we support right now, so if a
		// type other than environment is specified, then we can return an empty
		// list.
		if (type !== undefined && type !== positron.RuntimeClientType.Variables) {
			return Promise.resolve({});
		}

		// Return the environment ID if it exists.
		if (this._env) {
			return Promise.resolve({ [positron.RuntimeClientType.Variables]: this._env.id });
		} else {
			return Promise.resolve({});
		}
	}

	removeClient(id: string): void {
		// The environment is the only client type we support right now.
		if (this._env && this._env.id === id) {
			this._env = undefined;
		}
	}

	sendClientMessage(client_id: string, message_id: string, message: any): void {
		if (this._env && this._env.id === client_id) {
			this._pendingRpcs.push(message_id);
			this._env.handleMessage(message_id, message);

		} else {
			throw new Error(`Can't send message; unknown client id ${client_id}`);
		}
	}

	replyToPrompt(id: string, reply: string): void {
		throw new Error('Method not implemented.');
	}

	async start(): Promise<positron.LanguageRuntimeInfo> {
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Initializing);
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Starting);
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Ready);
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Busy);
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Idle);

		const runtimeInfo: positron.LanguageRuntimeInfo = {
			banner: `Welcome to Node.js ${process.version}.`,
			implementation_version: this.runtimeMetadata.runtimeVersion,
			language_version: this.runtimeMetadata.languageVersion,
		};

		return runtimeInfo;
	}

	interrupt(): Thenable<void> {
		// It's not currently possible to interrupt JavaScript code, because the code is executed in
		// the same thread as the extension host.
		//
		// We could address this by using a worker thread.
		return Promise.resolve();
	}

	restart(): Thenable<void> {
		// See notes on `interrupt()`
		return Promise.resolve();
	}

	shutdown(): Thenable<void> {
		// See notes on `interrupt()`
		return Promise.resolve();
	}

	forceQuit(): Thenable<void> {
		// See notes on `interrupt()`
		return Promise.resolve();
	}

	dispose() { }

	private emitOutput(parentId: string, output: string) {
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Output,
			data: {
				'text/plain': output
			} as Record<string, string>,
		} as positron.LanguageRuntimeOutput);
	}

	private enterBusyState(parentId: string) {
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.State,
			state: positron.RuntimeOnlineState.Busy
		} as positron.LanguageRuntimeState);
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Busy);
	}

	private enterIdleState(parentId: string) {
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.State,
			state: positron.RuntimeOnlineState.Idle
		} as positron.LanguageRuntimeState);
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Idle);
	}

	private emitError(parentId: string, name: string, message: string, traceback: string[] = []) {
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Error,
			name,
			message,
			traceback
		} as positron.LanguageRuntimeError);
	}

	private emitInput(parentId: string, code: string) {
		this._onDidReceiveRuntimeMessage.fire({
			id: randomUUID(),
			parent_id: parentId,
			when: new Date().toISOString(),
			type: positron.LanguageRuntimeMessageType.Input,
			state: positron.RuntimeOnlineState.Busy,
			code: code,
			execution_count: 1
		} as positron.LanguageRuntimeInput);
	}

	/**
	 * Proxies messages from a client instance to Positron, by amending the
	 * appropriate metadata.
	 *
	 * @param client The environment or plot to connect
	 */
	private connectClientEmitter(client: JavaScriptVariables) {

		// Listen for data emitted from the environment instance
		client.onDidEmitData(data => {
			// If there's a pending RPC, then presume that this message is a
			// reply to it; otherwise, just use an empty parent ID.
			const parent_id = this._pendingRpcs.length > 0 ?
				this._pendingRpcs.pop() : '';

			// When received, wrap it up in a runtime message and emit it
			this._onDidReceiveRuntimeMessage.fire({
				id: randomUUID(),
				parent_id,
				when: new Date().toISOString(),
				type: positron.LanguageRuntimeMessageType.CommData,
				comm_id: client.id,
				data: data
			} as positron.LanguageRuntimeCommMessage);
		});
	}
}
