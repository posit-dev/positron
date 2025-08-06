/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { DebugProtocol } from '@vscode/debugprotocol';
import * as vscode from 'vscode';
import { DebugProtocolTransformer } from './debugProtocolTransformer.js';
import { JupyterRuntimeDebugAdapter } from './runtimeDebugAdapter.js';
import { DisposableStore, formatDebugMessage } from './util.js';

export class JupyterRuntimeNotebookDebugAdapter implements vscode.DebugAdapter, vscode.Disposable {
	private readonly _disposables = new DisposableStore();
	private readonly _onDidSendMessage = this._disposables.add(new vscode.EventEmitter<vscode.DebugProtocolMessage>());
	private readonly _onDidCompleteConfiguration = this._disposables.add(new vscode.EventEmitter<void>());
	private _cellUriByCodeId = new Map<string, string>();
	private readonly _runtimeToClientTransformer: DebugProtocolTransformer;
	// TODO: Do we also need to transform client back to runtime?

	public readonly onDidSendMessage = this._onDidSendMessage.event;
	public readonly onDidCompleteConfiguration = this._onDidCompleteConfiguration.event;

	constructor(
		private readonly _adapter: JupyterRuntimeDebugAdapter,
		private readonly _notebook: vscode.NotebookDocument
	) {
		const cellUriByCodeId = this._cellUriByCodeId;
		this._runtimeToClientTransformer = new DebugProtocolTransformer({
			location(location) {
				const cellUri = location.source?.path && cellUriByCodeId.get(location.source.path);
				if (!cellUri) {
					return location;
				}
				return {
					...location,
					source: {
						sourceReference: 0, // Editor should not try to retrieve this source since its a known cell URI.
						path: cellUri,
					},
				};
			}
		});

		this._disposables.add(this._adapter.onDidSendMessage(async (message) => {
			const runtimeMessage = message as DebugProtocol.ProtocolMessage;

			let clientMessage = runtimeMessage;
			try {
				clientMessage = this._runtimeToClientTransformer.transform(runtimeMessage);
			} catch (error) {
				this._adapter.log.error(`[notebook] Error transforming message: ${formatDebugMessage(message as DebugProtocol.ProtocolMessage)}`, error);
			}
			this._log.debug(`[notebook] >>> SEND ${formatDebugMessage(clientMessage)}`);
			this._onDidSendMessage.fire(clientMessage);

			if (runtimeMessage.type === 'response' &&
				(runtimeMessage as DebugProtocol.Response).command === 'configurationDone') {
				this._onDidCompleteConfiguration.fire();
			}
		}));

		this._disposables.add(this._adapter.onDidUpdateCodeIdOptions(() => {
			// TODO: Block debugging until this is done?
			// TODO: Update the map when a cell's source changes.
			for (const cell of this._notebook.getCells()) {
				const code = cell.document.getText();
				const codeId = this._adapter.getCodeId(code);
				this._cellUriByCodeId.set(codeId, cell.document.uri.toString());
			}
		}));
	}

	private get _log(): vscode.LogOutputChannel {
		return this._adapter.log;
	}

	public handleMessage(message: DebugProtocol.ProtocolMessage): void {
		this._log.debug(`[notebook] <<< RECV ${formatDebugMessage(message)}`);
		this.handleMessageAsync(message).catch((error) => {
			this._log.error(`[notebook] Error handling message: ${formatDebugMessage(message)}`, error);
		});
	}

	private async handleMessageAsync(message: DebugProtocol.ProtocolMessage): Promise<void> {
		let runtimeMessage = message;
		if (message.type === 'request') {
			const request = message as DebugProtocol.Request;
			if (request.command === 'setBreakpoints') {
				const setBreakpointsRequest = request as DebugProtocol.SetBreakpointsRequest;
				const transformedRequest = await this.transformSetBreakpointsRequest(setBreakpointsRequest);
				if (transformedRequest) {
					runtimeMessage = transformedRequest;
				}
			}
		}

		// Send the message to the runtime.
		this._adapter.handleMessage(runtimeMessage);
	}

	private async transformSetBreakpointsRequest(request: DebugProtocol.SetBreakpointsRequest): Promise<DebugProtocol.SetBreakpointsRequest | undefined> {
		// Intercept setBreakpoint requests from the client,
		// dump the source cell, and replace with the temp file path.
		const cellUri = request.arguments.source.path;
		if (!cellUri) {
			throw new Error('No cell URI provided.');
		}
		const cell = this._notebook.getCells().find((cell) => cell.document.uri.toString() === cellUri);
		if (!cell) {
			throw new Error(`Cell not found: ${cellUri}`);
		}

		// Dump the cell into a temp file.
		const code = cell.document.getText();
		const dumpCellResponse = await this._adapter.dumpCell(code);

		// Replace the cell URI in the request source path with the temp file path.
		return {
			...request,
			arguments: {
				...request.arguments,
				source: {
					...request.arguments.source,
					path: dumpCellResponse.sourcePath,
				},
			},
		};
	}

	dispose(): void {
		this._disposables.dispose();
	}
}
