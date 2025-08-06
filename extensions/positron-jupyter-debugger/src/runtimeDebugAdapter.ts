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

export interface SourceMapOptions {
	/* The hash method used for code cells. Default is 'Murmur2'. */
	hashMethod: string;

	/* The seed for hashing code cells. */
	hashSeed: number;

	/* Prefix for temporary file names. */
	tmpFilePrefix: string;

	/* Suffix for temporary file names. */
	tmpFileSuffix: string;
}

export class JupyterRuntimeDebugAdapter implements vscode.DebugAdapter, vscode.Disposable {
	private readonly _disposables = new DisposableStore();
	private readonly _onDidSendMessage = this._disposables.add(new vscode.EventEmitter<vscode.DebugProtocolMessage>());
	private readonly _onDidUpdateSourceMapOptions = this._disposables.add(new vscode.EventEmitter<void>());
	private readonly _pendingRequestIds = new Set<string>();

	public sourceMapOptions?: SourceMapOptions;

	/** Event emitted when a debug protocol message is sent to the client. */
	public readonly onDidSendMessage = this._onDidSendMessage.event;

	public readonly onDidUpdateSourceMapOptions = this._onDidUpdateSourceMapOptions.event;

	constructor(
		public readonly log: vscode.LogOutputChannel,
		public readonly debugSession: vscode.DebugSession,
		public readonly runtimeSession: positron.LanguageRuntimeSession,
	) {
		// Forward debug messages from the runtime to the client.
		this._disposables.add(this.runtimeSession.onDidReceiveRuntimeMessage(async (message) => {
			switch (message.type) {
				case positron.LanguageRuntimeMessageType.DebugEvent:
					this.handleRuntimeDebugEvent(message as positron.LanguageRuntimeDebugEvent);
					break;
				case positron.LanguageRuntimeMessageType.DebugReply:
					this.handleRuntimeDebugReply(message as positron.LanguageRuntimeDebugReply);
					break;
				// TODO: Do we also need to handle debug requests from the runtime?
			}
		}));

		this.restoreState().catch((error) => {
			this.log.error('[runtime] Error restoring debug state', error);
		});
	}

	private async restoreState(): Promise<void> {
		const debugInfo = await this.debugInfo();
		this.sourceMapOptions = {
			hashMethod: debugInfo.hashMethod,
			hashSeed: debugInfo.hashSeed,
			tmpFilePrefix: debugInfo.tmpFilePrefix,
			tmpFileSuffix: debugInfo.tmpFileSuffix,
		};
		this._onDidUpdateSourceMapOptions.fire();
	}

	private handleRuntimeDebugEvent(event: positron.LanguageRuntimeDebugEvent): void {
		this.log.debug(`[runtime] >>> SEND ${formatDebugMessage(event.content)}`);
		this._onDidSendMessage.fire(event.content);
	}

	private handleRuntimeDebugReply(reply: positron.LanguageRuntimeDebugReply): void {
		if (!this._pendingRequestIds.delete(reply.parent_id)) {
			return;
		}
		this.log.debug(`[runtime] >>> SEND ${formatDebugMessage(reply.content)}`);
		this._onDidSendMessage.fire(reply.content);
	}

	public handleMessage(message: DebugProtocol.ProtocolMessage): void {
		this.log.debug(`[runtime] <<< RECV ${formatDebugMessage(message)}`);

		// The Jupyter debug protocol can currently only receive request messages.
		if (message.type !== 'request') {
			return;
		}

		// Send the request to the runtime.
		const request = message as DebugProtocol.Request;
		const id = randomUUID();
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

	private hash(code: string): string {
		if (!this.sourceMapOptions) {
			throw new Error('Cannot hash code before debug options are initialized');
		}

		switch (this.sourceMapOptions.hashMethod) {
			case 'Murmur2':
				return murmurhash2_32(code, this.sourceMapOptions.hashSeed).toString();
			default:
				throw new Error(`Unsupported hash method: ${this.sourceMapOptions.hashMethod}`);
		}
	}

	public getRuntimeSourcePath(code: string): string {
		if (!this.sourceMapOptions) {
			throw new Error('Cannot get code ID before debug options are initialized');
		}

		const hashed = this.hash(code);
		return `${this.sourceMapOptions.tmpFilePrefix}${hashed}${this.sourceMapOptions.tmpFileSuffix}`;
	}

	public dispose() {
		this._disposables.dispose();
	}
}
