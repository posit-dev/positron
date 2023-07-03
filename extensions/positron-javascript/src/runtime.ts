/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { randomUUID } from 'crypto';

import path = require('path');
import fs = require('fs');

export class JavascriptLanguageRuntime implements positron.LanguageRuntime {

	private readonly _onDidReceiveRuntimeMessage = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();

	private readonly _onDidChangeRuntimeState = new vscode.EventEmitter<positron.RuntimeState>();

	constructor(readonly context: vscode.ExtensionContext) {

		const version = process.version;

		const iconSvgPath = path.join(this.context.extensionPath, 'resources', 'javascript-icon.svg');

		this.metadata = {
			runtimePath: process.execPath,
			runtimeId: '13C365D6-099A-43EC-934D-353ADEFD798F',
			languageId: 'javascript',
			languageName: 'Javascript',
			runtimeName: 'Javascript',
			runtimeSource: 'Node.js',
			languageVersion: version,
			base64EncodedIconSvg: fs.readFileSync(iconSvgPath).toString('base64'),
			inputPrompt: `>`,
			continuationPrompt: '…',
			runtimeVersion: '0.0.1',
			startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit
		};
	}

	readonly metadata: positron.LanguageRuntimeMetadata;

	readonly onDidReceiveRuntimeMessage: vscode.Event<positron.LanguageRuntimeMessage>
		= this._onDidReceiveRuntimeMessage.event;

	readonly onDidChangeRuntimeState: vscode.Event<positron.RuntimeState>
		= this._onDidChangeRuntimeState.event;

	execute(code: string, id: string, mode: positron.RuntimeCodeExecutionMode, errorBehavior: positron.RuntimeErrorBehavior): void {
		this.emitInput(id, code);

		this.enterBusyState(id);
		try {
			// Typescript understandably isn't happy with eval.
			const result = eval(code); // eslint-disable-line no-eval

			// If the code evaluated successfully, emit the result.
			this.emitOutput(id, result.toString());
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
		this.enterIdleState(id);
	}

	isCodeFragmentComplete(code: string): Thenable<positron.RuntimeCodeFragmentStatus> {
		// Treat all code as complete.
		return Promise.resolve(positron.RuntimeCodeFragmentStatus.Complete);
	}

	createClient(id: string, type: positron.RuntimeClientType, params: any): Thenable<void> {
		throw new Error('Method not implemented.');
	}

	listClients(type?: positron.RuntimeClientType | undefined): Thenable<Record<string, string>> {
		throw new Error('Method not implemented.');
	}

	removeClient(id: string): void {
		throw new Error('Method not implemented.');
	}

	sendClientMessage(client_id: string, message_id: string, message: any): void {
		throw new Error('Method not implemented.');
	}

	replyToPrompt(id: string, reply: string): void {
		throw new Error('Method not implemented.');
	}

	async start(): Promise<positron.LanguageRuntimeInfo> {
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Initializing);
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Starting);
		this._onDidChangeRuntimeState.fire(positron.RuntimeState.Ready);

		const runtimeInfo: positron.LanguageRuntimeInfo = {
			banner: `Welcome to Node.js ${process.version}.`,
			implementation_version: this.metadata.runtimeVersion,
			language_version: this.metadata.languageVersion,
		};

		return runtimeInfo;
	}

	interrupt(): Thenable<void> {
		// It's not currently possible to interrupt Javascript code, because
		// the code is executed in the same thread as the extension host.
		//
		// We could address this by using a worker thread.
		return Promise.resolve();
	}

	restart(): Thenable<void> {
		return Promise.resolve();
	}

	shutdown(): Thenable<void> {
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
}
