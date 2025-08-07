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
import { DebugProtocolTransformer } from './debugProtocolTransformer.js';

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

export interface SourceMap {
	runtimeToClientSourcePath(runtimeSourcePath: string): string | undefined;
	clientToRuntimeSourcePath(clientSourcePath: string): string | undefined;
}

export class JupyterRuntimeDebugAdapter implements vscode.DebugAdapter, vscode.Disposable {
	private readonly _disposables = new DisposableStore();
	private readonly _onDidSendMessage = this._disposables.add(new vscode.EventEmitter<vscode.DebugProtocolMessage>());
	private readonly _onDidUpdateSourceMapOptions = this._disposables.add(new vscode.EventEmitter<void>());
	private readonly _pendingRequestIds = new Set<string>();

	private readonly _runtimeToClientTransformer: DebugProtocolTransformer;
	private readonly _clientToRuntimeTransformer: DebugProtocolTransformer;

	private _sourceMap?: SourceMap;

	public sourceMapOptions?: SourceMapOptions;

	/** Event emitted when a debug protocol message is sent to the client. */
	public readonly onDidSendMessage = this._onDidSendMessage.event;

	public readonly onDidUpdateSourceMapOptions = this._onDidUpdateSourceMapOptions.event;

	constructor(
		// TODO: options object
		public readonly log: vscode.LogOutputChannel,
		public readonly debugSession: vscode.DebugSession,
		public readonly runtimeSession: positron.LanguageRuntimeSession,
	) {
		const self = this;
		this._runtimeToClientTransformer = new DebugProtocolTransformer({
			location(location) {
				if (!self._sourceMap) {
					// TODO: Maybe this should error instead
					return location;
				}
				const cellUri = location.source?.path && self._sourceMap.runtimeToClientSourcePath(location.source.path);
				if (!cellUri) {
					return location;
				}
				return {
					...location,
					source: {
						...location.source,
						sourceReference: 0, // Editor should not try to retrieve this source since its a known cell URI.
						path: cellUri,
					},
				};
			}
		});

		this._clientToRuntimeTransformer = new DebugProtocolTransformer({
			location(location) {
				if (!self._sourceMap) {
					// TODO: Maybe this should error instead
					return location;
				}
				const sourcePath = location.source?.path && self._sourceMap.clientToRuntimeSourcePath(location.source.path);
				if (!sourcePath) {
					return location;
				}
				return {
					...location,
					source: {
						...location.source,
						path: sourcePath,
					},
				};
			}
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

	public setSourceMap(sourceMap: SourceMap): void {
		this._sourceMap = sourceMap;
	}

	private async restoreState(): Promise<void> {
		const debugInfo = await this.debugInfo();
		this.sourceMapOptions = {
			hashMethod: debugInfo.hashMethod,
			hashSeed: debugInfo.hashSeed,
			tmpFilePrefix: debugInfo.tmpFilePrefix,
			tmpFileSuffix: debugInfo.tmpFileSuffix,
		};
		// TODO: Maybe this could also call dump cell somehow? Basically reconsider this boundary
		this._onDidUpdateSourceMapOptions.fire();
	}

	private sendMessage(runtimeMessage: DebugProtocol.ProtocolMessage): void {
		this.log.debug(`[runtime] >>> SEND ${formatDebugMessage(runtimeMessage)}`);

		let clientMessage = runtimeMessage;
		try {
			clientMessage = this._runtimeToClientTransformer.transform(runtimeMessage);
		} catch (error) {
			this.log.error(`[adapter] Error transforming message: ${formatDebugMessage(runtimeMessage as DebugProtocol.ProtocolMessage)}`, error);
		}

		this.log.debug(`[adapter] >>> SEND ${formatDebugMessage(clientMessage)}`);
		this._onDidSendMessage.fire(clientMessage);
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

		let runtimeMessage = clientMessage;
		try {
			runtimeMessage = this._clientToRuntimeTransformer.transform(clientMessage);
		} catch (error) {
			this.log.error(`[adapter] Error transforming message: ${formatDebugMessage(clientMessage)}`, error);
		}

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
