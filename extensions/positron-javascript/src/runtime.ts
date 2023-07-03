/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

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
		throw new Error('Method not implemented.');
	}
	isCodeFragmentComplete(code: string): Thenable<positron.RuntimeCodeFragmentStatus> {
		throw new Error('Method not implemented.');
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
	start(): Thenable<positron.LanguageRuntimeInfo> {
		throw new Error('Method not implemented.');
	}
	interrupt(): Thenable<void> {
		throw new Error('Method not implemented.');
	}
	restart(): Thenable<void> {
		throw new Error('Method not implemented.');
	}
	shutdown(): Thenable<void> {
		throw new Error('Method not implemented.');
	}
	dispose() {
		throw new Error('Method not implemented.');
	}
}
