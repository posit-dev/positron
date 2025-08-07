/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DebugProtocol } from '@vscode/debugprotocol';
import { randomUUID } from 'crypto';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { DebugInfoArguments, DebugInfoResponseBody, DumpCellArguments, DumpCellResponseBody } from './jupyterDebugProtocol.js';
import { DisposableStore, formatDebugMessage } from './util.js';
import { DebugLocation, DebugProtocolTransformer } from './debugProtocolTransformer.js';

export interface SourceMap {
	toClientLocation<T extends DebugLocation>(location: T): T;
	toRuntimeLocation<T extends DebugLocation>(location: T): T;
}

export class JupyterRuntimeDebugAdapter implements vscode.DebugAdapter, vscode.Disposable {
	private readonly _disposables = new DisposableStore();
	private readonly _onDidSendMessage = this._disposables.add(new vscode.EventEmitter<vscode.DebugProtocolMessage>());
	private readonly _onDidRefreshState = this._disposables.add(new vscode.EventEmitter<DebugInfoResponseBody>());
	private readonly _pendingRequestIds = new Set<string>();

	private readonly _runtimeToClientTransformer: DebugProtocolTransformer;
	private readonly _clientToRuntimeTransformer: DebugProtocolTransformer;

	/** Event emitted when a debug protocol message is sent to the client. */
	public readonly onDidSendMessage = this._onDidSendMessage.event;

	public readonly onDidRefreshState = this._onDidRefreshState.event;

	constructor(
		// TODO: options object
		private readonly _sourceMap: SourceMap,
		public readonly log: vscode.LogOutputChannel,
		public readonly debugSession: vscode.DebugSession,
		public readonly runtimeSession: positron.LanguageRuntimeSession,
	) {
		this._runtimeToClientTransformer = new DebugProtocolTransformer({
			location: this._sourceMap.toClientLocation.bind(this._sourceMap)
		});

		this._clientToRuntimeTransformer = new DebugProtocolTransformer({
			location: this._sourceMap.toRuntimeLocation.bind(this._sourceMap),
		});

		// Forward debug messages from the runtime to the client.
		this._disposables.add(this.runtimeSession.onDidReceiveRuntimeMessage(async (runtimeMessage) => {
			switch (runtimeMessage.type) {
				// Note that language runtimes currently do not support receiving debug request messages.
				case positron.LanguageRuntimeMessageType.DebugEvent:
					this.sendMessage((runtimeMessage as positron.LanguageRuntimeDebugEvent).content);
					break;
				case positron.LanguageRuntimeMessageType.DebugReply:
					if (this._pendingRequestIds.delete(runtimeMessage.parent_id)) {
						this.sendMessage((runtimeMessage as positron.LanguageRuntimeDebugReply).content);
					}
					break;
			}
		}));

		this.restoreState().catch((error) => {
			this.log.error('[runtime] Error restoring debug state', error);
		});
	}

	private async restoreState(): Promise<void> {
		const debugInfo = await this.debugInfo();

		// TODO: We don't yet do anything here. But this should update the UI when reconnecting to a runtime
		//       that is already debugging.

		this._onDidRefreshState.fire(debugInfo);
	}

	private sendMessage(runtimeMessage: DebugProtocol.ProtocolMessage): void {
		this.log.debug(`[runtime] >>> SEND ${formatDebugMessage(runtimeMessage)}`);
		const clientMessage = this.toClientMessage(runtimeMessage);
		this.log.debug(`[adapter] >>> SEND ${formatDebugMessage(clientMessage)}`);
		this._onDidSendMessage.fire(clientMessage);
	}

	private toClientMessage(runtimeMessage: DebugProtocol.ProtocolMessage): DebugProtocol.ProtocolMessage {
		try {
			return this._runtimeToClientTransformer.transform(runtimeMessage);
		} catch (error) {
			this.log.error(`[adapter] Error transforming message: ${formatDebugMessage(runtimeMessage as DebugProtocol.ProtocolMessage)}`, error);
		}
		return runtimeMessage;
	}

	private toRuntimeMessage(clientMessage: DebugProtocol.ProtocolMessage): DebugProtocol.ProtocolMessage {
		try {
			return this._clientToRuntimeTransformer.transform(clientMessage);
		} catch (error) {
			this.log.error(`[adapter] Error transforming message: ${formatDebugMessage(clientMessage)}`, error);
		}
		return clientMessage;
	}

	public handleMessage(clientMessage: DebugProtocol.ProtocolMessage): void {
		this.log.debug(`[adapter] <<< RECV ${formatDebugMessage(clientMessage)}`);
		this.handleMessageAsync(clientMessage).catch((error) => {
			this.log.error(`[adapter] Error handling message: ${formatDebugMessage(clientMessage)}`, error);
		});
	}

	private async handleMessageAsync(clientMessage: DebugProtocol.ProtocolMessage): Promise<void> {
		// The Jupyter debug protocol can currently only receive request messages.
		if (clientMessage.type !== 'request') {
			return;
		}

		try {
			// TODO: Better terminology than dumpCell?
			await this.maybeDumpCell(clientMessage);
		} catch (error) {
			this.log.error(`[adapter] Error dumping source for request: ${formatDebugMessage(clientMessage)}`, error);
		}

		const runtimeMessage = this.toRuntimeMessage(clientMessage);
		this.log.debug(`[runtime] <<< RECV ${formatDebugMessage(runtimeMessage)}`);
		// Send the request to the runtime.
		const id = randomUUID();
		// TODO: Better typing
		this.runtimeSession.debug(runtimeMessage as DebugProtocol.Request, id);
		this._pendingRequestIds.add(id);
	}

	private async maybeDumpCell(clientMessage: DebugProtocol.ProtocolMessage): Promise<void> {
		// Intercept setBreakpoint requests from the client,
		// dump the source cell, and replace with the temp file path.
		if (clientMessage.type !== 'request') {
			return;
		}

		const request = clientMessage as DebugProtocol.Request;
		if (request.command !== 'setBreakpoints') {
			return;
		}

		const setBreakpointsRequest = request as DebugProtocol.SetBreakpointsRequest;
		const clientSourcePath = setBreakpointsRequest.arguments.source.path;
		if (!clientSourcePath) {
			return;
		}

		// TODO: Get the code that we send to dumpCell
		//       Would this apply to other debuggers than debugpy?...
		// TODO: Or maybe we can always use vscode's document capabilities for this?
		// TODO: Probably not a bad assumption that everywhere we can put a breakpoint is backed by a text document?
		const clientSourceUri = vscode.Uri.parse(clientSourcePath, true);
		const document = await vscode.workspace.openTextDocument(clientSourceUri);
		const code = document.getText();

		await this.dumpCell(code);
	}

	private async dumpCell(code: string): Promise<DumpCellResponseBody> {
		return await this.debugSession.customRequest('dumpCell', { code } satisfies DumpCellArguments);
	}

	private async debugInfo(): Promise<DebugInfoResponseBody> {
		return await this.debugSession.customRequest('debugInfo', {} satisfies DebugInfoArguments);
	}

	public dispose() {
		this._disposables.dispose();
	}
}
