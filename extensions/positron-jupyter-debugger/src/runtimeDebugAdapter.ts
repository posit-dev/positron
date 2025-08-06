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
import { murmurhash2_32 } from './murmur.js';

// TODO: Clean this up
export interface CodeIdOptions {
	/* Indicates whether the debugger is started. */
	// isStarted: boolean;

	/* The hash method used for code cells. Default is 'Murmur2'. */
	hashMethod: string;

	/* The seed for hashing code cells. */
	hashSeed: number;

	/* Prefix for temporary file names. */
	tmpFilePrefix: string;

	/* Suffix for temporary file names. */
	tmpFileSuffix: string;

	/* Breakpoints currently registered in the debugger. */
	// breakpoints: {
	// 	/* Source file. */
	// 	source: string;

	// 	/* List of breakpoints for that source file. */
	// 	breakpoints: DebugProtocol.Breakpoint[];
	// }[];

	/* Threads in which the debugger is currently in a stopped state. */
	// stoppedThreads: number[];

	/* Whether the debugger supports rich rendering of variables. */
	// richRendering: boolean;

	/* Exception names used to match leaves or nodes in a tree of exception. */
	// exceptionPaths: string[];
}

export class JupyterRuntimeDebugAdapter implements vscode.DebugAdapter, vscode.Disposable {
	private readonly _disposables = new DisposableStore();
	private readonly _onDidSendMessage = this._disposables.add(new vscode.EventEmitter<vscode.DebugProtocolMessage>());
	private readonly _onDidUpdateCodeIdOptions = this._disposables.add(new vscode.EventEmitter<void>());
	private readonly _pendingRequestIds = new Set<string>();
	private sequence = 1;

	public codeIdOptions?: CodeIdOptions;

	/** Event emitted when a debug protocol message is sent to the client. */
	public readonly onDidSendMessage = this._onDidSendMessage.event;

	public readonly onDidUpdateCodeIdOptions = this._onDidUpdateCodeIdOptions.event;

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

		this.restoreState().catch((error) => {
			this.log.error('[runtime] Error restoring debug state', error);
		});
	}

	private async restoreState(): Promise<void> {
		// TODO: Might need a way to synchronize with this method in subclasses.
		const debugInfo = await this.debugInfo();
		this.codeIdOptions = {
			hashMethod: debugInfo.hashMethod,
			hashSeed: debugInfo.hashSeed,
			tmpFilePrefix: debugInfo.tmpFilePrefix,
			tmpFileSuffix: debugInfo.tmpFileSuffix,
		};
		this._onDidUpdateCodeIdOptions.fire();
	}

	private onDidReceiveDebugEvent(debugEvent: positron.LanguageRuntimeDebugEvent): void {
		this.sendMessage(debugEvent.content);
	}

	private onDidReceiveDebugReply(debugReply: positron.LanguageRuntimeDebugReply): void {
		if (this._pendingRequestIds.delete(debugReply.parent_id)) {
			this.sendMessage(debugReply.content);
		}
	}

	public handleMessage(message: DebugProtocol.ProtocolMessage): void {
		this.log.debug(`[runtime] <<< RECV ${formatDebugMessage(message)}`);
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

	private async debugInfo(): Promise<DebugInfoResponseBody> {
		return await this.debugSession.customRequest('debugInfo') as DebugInfoResponseBody;
	}

	private hash(code: string): string {
		if (!this.codeIdOptions) {
			throw new Error('Cannot hash code before debug options are initialized');
		}

		switch (this.codeIdOptions.hashMethod) {
			case 'Murmur2':
				return murmurhash2_32(code, this.codeIdOptions.hashSeed).toString();
			default:
				throw new Error(`Unsupported hash method: ${this.codeIdOptions.hashMethod}`);
		}
	}

	public getCodeId(code: string): string {
		if (!this.codeIdOptions) {
			throw new Error('Cannot get code ID before debug options are initialized');
		}

		const hashed = this.hash(code);
		return `${this.codeIdOptions.tmpFilePrefix}${hashed}${this.codeIdOptions.tmpFileSuffix}`;
	}

	private sendMessage<P extends DebugProtocol.ProtocolMessage>(message: Omit<P, 'seq'>): void {
		// TODO: Do we need to maintain sequence number?
		const emittedMessage: DebugProtocol.ProtocolMessage = {
			...message,
			seq: this.sequence,
		};

		this.sequence++;
		this.log.debug(`[runtime] >>> SEND ${formatDebugMessage(emittedMessage)}`);
		this._onDidSendMessage.fire(emittedMessage);
	}

	public dispose() {
		this._disposables.dispose();
	}
}
