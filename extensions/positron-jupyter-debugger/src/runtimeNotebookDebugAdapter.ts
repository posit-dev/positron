/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { DisposableStore, formatDebugMessage } from './util.js';
import { JupyterRuntimeDebugAdapter } from './runtimeDebugAdapter.js';
import { DebugProtocol } from '@vscode/debugprotocol';
import { murmurhash2_32 } from './murmur.js';

export class JupyterRuntimeNotebookDebugAdapter implements vscode.DebugAdapter, vscode.Disposable {
	private readonly _disposables = new DisposableStore();
	private readonly _onDidSendMessage = this._disposables.add(new vscode.EventEmitter<vscode.DebugProtocolMessage>());
	private readonly _onDidCompleteConfiguration = this._disposables.add(new vscode.EventEmitter<void>());
	private _cellUriByTempFilePath = new Map<string, string>();

	public readonly onDidSendMessage = this._onDidSendMessage.event;
	public readonly onDidCompleteConfiguration = this._onDidCompleteConfiguration.event;

	constructor(
		private readonly _adapter: JupyterRuntimeDebugAdapter,
		private readonly _notebook: vscode.NotebookDocument
	) {
		this._disposables.add(this._adapter.onDidSendMessage((message) => {
			const debugMessage = message as DebugProtocol.ProtocolMessage;
			if (debugMessage.type === 'response') {
				const response = debugMessage as DebugProtocol.Response;
				if (response.command === 'setBreakpoints') {
					const setBreakpointsResponse = response as DebugProtocol.SetBreakpointsResponse;
					// TODO: Do we need this?
					// Map the temp file paths back to cell URIs.
					setBreakpointsResponse.body.breakpoints.forEach((breakpoint) => {
						if (breakpoint.source?.path && this._cellUriByTempFilePath.has(breakpoint.source.path)) {
							breakpoint.source = {
								sourceReference: 0, // Editor should not try to retrieve this source since its a known cell URI.
								path: this._cellUriByTempFilePath.get(breakpoint.source.path)!,
							};
						}
					});
				} else if (response.command === 'stackTrace') {
					const stackTraceResponse = response as DebugProtocol.StackTraceResponse;
					// Map the temp file paths back to cell URIs in stack frames.
					stackTraceResponse.body.stackFrames.forEach((frame) => {
						if (frame.source?.path && this._cellUriByTempFilePath.has(frame.source.path)) {
							frame.source = {
								sourceReference: 0, // Editor should not try to retrieve this source since its a known cell URI.
								path: this._cellUriByTempFilePath.get(frame.source.path)!,
							};
						}
					});
				}
			}

			this._onDidSendMessage.fire(message);
		}));

		this._disposables.add(this._adapter.onDidCompleteConfiguration(() => {
			this._onDidCompleteConfiguration.fire();
		}));

		this._adapter.debugInfo().then((debugInfo) => {
			// TODO: Block debugging until this is done?
			// TODO: Update the map when a cell's source changes.
			for (const cell of this._notebook.getCells()) {
				const code = cell.document.getText();
				const id = this.hashCode(code, debugInfo.hashMethod, debugInfo.hashSeed);
				const tempFilePath = `${debugInfo.tmpFilePrefix}${id}${debugInfo.tmpFileSuffix}`;
				this._cellUriByTempFilePath.set(tempFilePath, cell.document.uri.toString());
			}
		});
	}

	// TODO: Align naming: id, hashCode, tempFilePath, etc.
	private hashCode(code: string, hashMethod: string, hashSeed: number): string {
		switch (hashMethod) {
			case 'murmur2':
				return murmurhash2_32(code, hashSeed).toString();
			default:
				throw new Error(`Unsupported hash method: ${hashMethod}`);
		}
	}

	private get _log(): vscode.LogOutputChannel {
		return this._adapter.log;
	}

	public handleMessage(message: DebugProtocol.ProtocolMessage): void {
		this.handleMessageAsync(message).catch((error) => {
			this._log.error(`[adapter] Error handling message: ${formatDebugMessage(message)}`, error);
			// TODO: should still respond with an error response...
		});
	}

	private async handleMessageAsync(message: DebugProtocol.ProtocolMessage): Promise<void> {
		switch (message.type) {
			case 'request':
				return await this.handleRequest(message as DebugProtocol.Request);
		}
		// TODO: Don't we need to handle events and responses too?
	}

	private async handleRequest(request: DebugProtocol.Request): Promise<void> {
		switch (request.command) {
			case 'setBreakpoints':
				return await this.handleSetBreakpointsRequest(request as DebugProtocol.SetBreakpointsRequest);
			// case 'stackTrace':
			// 	return await this.handleStackTraceRequest(request as DebugProtocol.StackTraceRequest);
		}
		this._adapter.handleMessage(request);
	}

	private async handleSetBreakpointsRequest(request: DebugProtocol.SetBreakpointsRequest): Promise<void> {
		// Intercept setBreakpoint requests from the client,
		// dump the source cell, and replace with the temp file path.
		const cellUri = request.arguments.source.path;
		if (!cellUri) {
			throw new Error('No cell URI provided.');
		}
		const cell = this._notebook.getCells().find((cell) => cell.document.uri.toString() === cellUri);

		// TODO: Abstract source mapping...
		//       i.e. client request.arguments.source.path (cell URI, console history item URI?)
		//            -> kernel temp file path

		if (!cell) {
			// Fall back to the runtime debug adapter.
			// TODO: Raise an error?...
			this._adapter.handleMessage(request);
			return;
		}

		// Dump the cell into a temp file.
		const code = cell.document.getText();
		const dumpCellResponse = await this._adapter.dumpCell(code);

		// Replace the cell URI in the request source path with the temp file path.
		const runtimeRequest = {
			...request,
			arguments: {
				...request.arguments,
				source: {
					...request.arguments.source,
					path: dumpCellResponse.sourcePath,
				},
			},
		};

		// Send the request to the runtime.
		this._adapter.handleMessage(runtimeRequest);
	}

	dispose(): void {
		this._disposables.dispose();
	}
}
