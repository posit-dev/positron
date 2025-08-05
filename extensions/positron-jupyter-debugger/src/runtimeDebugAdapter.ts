/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DebugProtocol } from '@vscode/debugprotocol';
import { randomUUID } from 'crypto';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DebugInfoResponseBody, DumpCellArguments, DumpCellResponseBody } from './jupyterDebugProtocol.js';
import { DisposableStore, formatDebugMessage } from './util.js';

export class JupyterRuntimeDebugAdapter implements vscode.DebugAdapter, vscode.Disposable {
	private readonly _disposables = new DisposableStore();
	private readonly _onDidSendMessage = this._disposables.add(new vscode.EventEmitter<vscode.DebugProtocolMessage>());
	private readonly _onDidCompleteConfiguration = this._disposables.add(new vscode.EventEmitter<void>());
	private readonly _pendingRequestIds = new Set<string>();
	private sequence = 1;

	/** Event emitted when a debug protocol message is sent to the client. */
	public readonly onDidSendMessage = this._onDidSendMessage.event;

	/** Event emitted when the debugger has completed its configuration. */
	public readonly onDidCompleteConfiguration = this._onDidCompleteConfiguration.event;

	constructor(
		public readonly log: vscode.LogOutputChannel,
		public readonly debugSession: vscode.DebugSession,
		public readonly runtimeSession: positron.LanguageRuntimeSession,
	) {
		// Forward debug messages from the runtime to the client.
		this._disposables.add(this.runtimeSession.onDidReceiveRuntimeMessage(async (message) => {
			switch (message.type) {
				case positron.LanguageRuntimeMessageType.DebugEvent:
					this.onDidReceiveDebugEvent(message as positron.LanguageRuntimeDebugEvent);
					break;
				case positron.LanguageRuntimeMessageType.DebugReply:
					this.onDidReceiveDebugReply(message as positron.LanguageRuntimeDebugReply);
					break;
				// TODO: Do we also need to handle debug requests from the runtime?
			}
		}));
	}

	private onDidReceiveDebugEvent(debugEvent: positron.LanguageRuntimeDebugEvent): void {
		this.log.debug(`[runtime] >>> SEND ${formatDebugMessage(debugEvent.content)}`);
		this.sendMessage(debugEvent.content);
	}

	private onDidReceiveDebugReply(debugReply: positron.LanguageRuntimeDebugReply): void {
		if (this._pendingRequestIds.delete(debugReply.parent_id)) {
			this.log.debug(`[runtime] >>> SEND ${formatDebugMessage(debugReply.content)}`);
			this.sendMessage(debugReply.content);
		}
	}

	public handleMessage(message: DebugProtocol.ProtocolMessage): void {
		if (message.type === 'request') {
			this.handleRequest(message as DebugProtocol.Request);
		}
		// TODO: Do we need to handle events and responses too?
	}

	private handleRequest(request: DebugProtocol.Request): void {
		// Generate a unique ID for the request.
		const id = randomUUID();

		// Send the request to the runtime.
		this.runtimeSession.debug(request, id);

		this._pendingRequestIds.add(id);
	}

	public async dumpCell(code: string): Promise<DumpCellResponseBody> {
		const args: DumpCellArguments = { code };
		return await this.debugSession.customRequest('dumpCell', args) as DumpCellResponseBody;
	}

	public async debugInfo(): Promise<DebugInfoResponseBody> {
		return await this.debugSession.customRequest('debugInfo') as DebugInfoResponseBody;
	}

	private sendMessage<P extends DebugProtocol.ProtocolMessage>(message: Omit<P, 'seq'>): void {
		const emittedMessage: DebugProtocol.ProtocolMessage = {
			...message,
			seq: this.sequence,
		};

		if (emittedMessage.type === 'response' &&
			(emittedMessage as DebugProtocol.Response).command === 'configurationDone') {
			this._onDidCompleteConfiguration.fire();
		}

		this.sequence++;
		this.log.debug(`[adapter] >>> SEND ${formatDebugMessage(emittedMessage)}`);
		this._onDidSendMessage.fire(emittedMessage);
	}

	public dispose() {
		this._disposables.dispose();
	}
}
